"""
Presupuestos de gasto por categoría y mes (HU15 — KONTADORIA-77). Tabla: 0015_presupuestos.sql.

- Solo el admin crea, edita y elimina (presupuestos.gestionar); admin y contador consultan.
- Un solo presupuesto por categoría y mes: el segundo responde 409.
- La categoría debe ser de gasto y visible para la empresa (predefinida o propia). Se busca con
  RLS activo: una categoría propia de otra empresa no aparece y responde lo mismo que una que no
  existe. La FK de la tabla sola no lo garantiza (SQL Server valida las FK sin RLS).
- Se edita solo el monto: cambiar la categoría o el mes es otro presupuesto.
- La lista trae lo gastado en el mes en cada categoría (movimientos vigentes de gasto), para que
  la pantalla muestre el avance contra el límite. Las alertas automáticas quedan fuera de v1.
"""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_permiso
from app.core.db import get_db

router = APIRouter()

# AAAA-MM, igual que el selector de mes del dashboard (/movimientos/resumen)
Mes = Annotated[str, StringConstraints(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]
# Pesos chilenos, entero; mismo tope que movimientos y que ck_presupuestos_monto
Monto = Annotated[int, Field(gt=0, le=999_999_999_999)]


class NuevoPresupuesto(BaseModel):
    categoria_id: str
    mes: Mes
    monto: Monto


class CambiosPresupuesto(BaseModel):
    monto: Monto


def _error(status_code: int, codigo: str, mensaje: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"codigo": codigo, "mensaje": mensaje})


def _primer_dia(mes: str) -> dt.date:
    return dt.date(int(mes[:4]), int(mes[5:7]), 1)


def _sumar_mes(dia: dt.date, n: int) -> dt.date:
    total = dia.year * 12 + dia.month - 1 + n
    return dt.date(total // 12, total % 12 + 1, 1)


_REPETIDO = (status.HTTP_409_CONFLICT, "presupuesto_repetido", "Ya hay un presupuesto para esa categoría en ese mes.")

# Lo gastado en la categoría durante el mes del presupuesto: movimientos vigentes de gasto.
# RLS decide qué movimientos cuentan; admin y contador (los únicos con acceso) ven todos los de su empresa.
_SELECT = """
    SELECT p.id, p.categoria_id, c.nombre AS categoria, c.color, p.mes, p.monto,
           COALESCE((SELECT SUM(m.monto) FROM dbo.movimientos m
                     WHERE m.categoria_id = p.categoria_id AND m.tipo = 'gasto' AND m.eliminado_en IS NULL
                       AND m.fecha >= p.mes AND m.fecha < DATEADD(MONTH, 1, p.mes)), 0) AS gastado
    FROM dbo.presupuestos p JOIN dbo.categorias c ON c.id = p.categoria_id
"""


def _json(row) -> dict:
    return {
        "id": str(row.id),
        "categoria_id": str(row.categoria_id),
        "categoria": row.categoria,
        "color": row.color,
        "mes": row.mes.strftime("%Y-%m"),
        "monto": int(row.monto),
        "gastado": int(row.gastado),
    }


def _leer(db: Session, presupuesto_id: str):
    row = db.execute(text(f"{_SELECT} WHERE p.id = TRY_CAST(:id AS UNIQUEIDENTIFIER)"), {"id": presupuesto_id}).first()
    if row is None:  # no existe o es de otra empresa (RLS): misma respuesta
        raise _error(status.HTTP_404_NOT_FOUND, "no_encontrado", "Presupuesto no encontrado.")
    return row


@router.get("")
def listar_presupuestos(
    mes: Annotated[Mes | None, Query()] = None,
    user: CurrentUser = Depends(require_permiso("presupuestos.ver")),
    db: Session = Depends(get_db),
):
    """
    Presupuestos de la empresa (RLS, sin WHERE por empresa). Con `mes` (AAAA-MM), solo los de
    ese mes; sin él, todos, del mes más reciente al más antiguo.
    """
    if mes:
        desde = _primer_dia(mes)
        rows = db.execute(
            text(f"{_SELECT} WHERE p.mes = :mes ORDER BY c.nombre"), {"mes": desde}
        ).all()
    else:
        rows = db.execute(text(f"{_SELECT} ORDER BY p.mes DESC, c.nombre")).all()
    return [_json(r) for r in rows]


@router.get("/{presupuesto_id}")
def ver_presupuesto(
    presupuesto_id: str,
    user: CurrentUser = Depends(require_permiso("presupuestos.ver")),
    db: Session = Depends(get_db),
):
    return _json(_leer(db, presupuesto_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def crear_presupuesto(
    datos: NuevoPresupuesto,
    user: CurrentUser = Depends(require_permiso("presupuestos.gestionar")),
    db: Session = Depends(get_db),
):
    """La empresa sale del usuario autenticado, nunca del body."""
    categoria = db.execute(
        text("SELECT id, tipo FROM dbo.categorias WHERE id = TRY_CAST(:id AS UNIQUEIDENTIFIER)"),
        {"id": datos.categoria_id},
    ).first()
    if categoria is None:
        raise _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "categoria_invalida", "La categoría no existe.")
    if categoria.tipo != "gasto":
        raise _error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "categoria_no_gasto", "Los presupuestos son solo para categorías de gasto."
        )
    try:
        nuevo_id = db.execute(
            text(
                """
                INSERT INTO dbo.presupuestos (empresa_id, categoria_id, mes, monto, creado_por)
                OUTPUT inserted.id
                VALUES (:empresa_id, :categoria_id, :mes, :monto, :usuario_id)
                """
            ),
            {
                "empresa_id": user.empresa_id,
                "categoria_id": str(categoria.id),
                "mes": _primer_dia(datos.mes),
                "monto": datos.monto,
                "usuario_id": user.usuario_id,
            },
        ).scalar_one()
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if "uq_presupuestos_categoria_mes" in str(exc.orig):
            raise _error(*_REPETIDO) from exc
        raise
    return _json(_leer(db, str(nuevo_id)))


@router.put("/{presupuesto_id}")
def editar_presupuesto(
    presupuesto_id: str,
    datos: CambiosPresupuesto,
    user: CurrentUser = Depends(require_permiso("presupuestos.gestionar")),
    db: Session = Depends(get_db),
):
    actual = _leer(db, presupuesto_id)
    db.execute(
        text(
            "UPDATE dbo.presupuestos SET monto = :monto, actualizado_por = :usuario_id,"
            " actualizado_en = SYSUTCDATETIME() WHERE id = :id"
        ),
        {"monto": datos.monto, "usuario_id": user.usuario_id, "id": actual.id},
    )
    db.commit()
    return _json(_leer(db, presupuesto_id))


@router.delete("/{presupuesto_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_presupuesto(
    presupuesto_id: str,
    user: CurrentUser = Depends(require_permiso("presupuestos.gestionar")),
    db: Session = Depends(get_db),
):
    actual = _leer(db, presupuesto_id)
    db.execute(text("DELETE FROM dbo.presupuestos WHERE id = :id"), {"id": actual.id})
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
