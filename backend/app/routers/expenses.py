import datetime as dt
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, StringConstraints, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_permiso
from app.core.db import get_db
from app.core.permisos import PERMISOS

router = APIRouter()

Texto = Annotated[str, StringConstraints(strip_whitespace=True)]


class DatosMovimiento(BaseModel):
    """Mismos límites que dbo.movimientos (db/migrations/0006_movimientos.sql)."""

    tipo: Literal["ingreso", "gasto"]
    fecha: dt.date
    # Pesos chilenos, entero (BIGINT). El tope evita montos absurdos por un cero de más.
    monto: Annotated[int, Field(gt=0, le=999_999_999_999)]
    categoria_id: uuid.UUID
    proveedor: Annotated[Texto, Field(max_length=150)] | None = None
    descripcion: Annotated[Texto, Field(max_length=500)] | None = None
    tipo_documento: Literal["boleta", "factura", "otro"]

    @field_validator("fecha")
    @classmethod
    def _fecha_razonable(cls, v: dt.date) -> dt.date:
        if v.year < 2000:
            raise ValueError("Revisa la fecha.")
        return v

    @field_validator("proveedor", "descripcion")
    @classmethod
    def _vacio_es_nulo(cls, v: str | None) -> str | None:
        return v or None


class NuevoMovimiento(DatosMovimiento):
    # Lo genera la app al abrir el formulario: el mismo envío repetido (doble clic,
    # reintento con mala conexión) se guarda una sola vez.
    client_request_id: uuid.UUID | None = None


def _error(status_code: int, codigo: str, mensaje: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"codigo": codigo, "mensaje": mensaje})


# Quién lo registró se muestra en el listado y alimenta el filtro por usuario (HU07).
_SELECT = """
    SELECT m.id, m.empresa_id, m.usuario_id, m.categoria_id, m.tipo, m.fecha, m.monto, m.proveedor,
           m.descripcion, m.tipo_documento, m.origen, m.client_request_id, m.creado_en,
           COALESCE(u.nombre, u.email) AS usuario_nombre
    FROM dbo.movimientos m
    JOIN dbo.usuarios u ON u.id = m.usuario_id
"""


# Vigente = no anulado (0008_movimientos_anulacion.sql). Toda lectura parte de aquí.
_VIGENTE = "m.eliminado_en IS NULL"


def _leer(db: Session, movimiento_id, anulados: bool = False) -> dict | None:
    filtro = "" if anulados else f" AND {_VIGENTE}"
    row = db.execute(
        text(f"{_SELECT} WHERE m.id = TRY_CAST(:id AS UNIQUEIDENTIFIER){filtro}"), {"id": str(movimiento_id)}
    ).mappings().first()
    return dict(row) if row else None


def _no_encontrado() -> HTTPException:
    return _error(status.HTTP_404_NOT_FOUND, "no_encontrado", "Movimiento no encontrado.")


def _validar_categoria(db: Session, datos: DatosMovimiento) -> None:
    """La categoría debe ser visible para la empresa (predefinida o propia, RLS) y del mismo tipo."""
    tipo = db.execute(
        text("SELECT tipo FROM dbo.categorias WHERE id = :id"), {"id": str(datos.categoria_id)}
    ).scalar()
    if tipo != datos.tipo:
        raise _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "categoria_invalida", "Elige una categoría del tipo correspondiente.")


@router.get("")
def listar_movimientos(
    tipo: Literal["ingreso", "gasto"] | None = None,
    categoria_id: uuid.UUID | None = None,
    desde: dt.date | None = None,
    hasta: dt.date | None = None,
    usuario_id: uuid.UUID | None = None,
    user: CurrentUser = Depends(require_permiso("movimientos.ver")),
    db: Session = Depends(get_db),
):
    """
    HU07 — KONTADORIA-51. No filtra manualmente por empresa_id/usuario_id en el WHERE — esa
    responsabilidad es de las políticas de RLS de Azure SQL, ya activadas sobre este `db` por
    get_current_user() vía SESSION_CONTEXT. Los filtros solo acotan dentro de lo permitido.
    """
    if usuario_id is not None and user.rol not in PERMISOS["movimientos.filtrar_usuario"]:
        # RLS igual no le mostraría movimientos ajenos, pero el filtro no es para su rol.
        raise _error(status.HTTP_403_FORBIDDEN, "rol_sin_permiso", "Tu rol no puede filtrar por usuario.")

    condiciones, params = [_VIGENTE], {}
    for campo, valor, sql in (
        ("tipo", tipo, "m.tipo = :tipo"),
        ("categoria_id", categoria_id, "m.categoria_id = :categoria_id"),
        ("desde", desde, "m.fecha >= :desde"),
        ("hasta", hasta, "m.fecha <= :hasta"),
        ("usuario_id", usuario_id, "m.usuario_id = :usuario_id"),
    ):
        if valor is not None:
            condiciones.append(sql)
            params[campo] = str(valor) if isinstance(valor, uuid.UUID) else valor
    rows = db.execute(text(f"{_SELECT} WHERE {' AND '.join(condiciones)} ORDER BY m.fecha DESC, m.creado_en DESC"), params).mappings().all()
    return [dict(r) for r in rows]


@router.get("/{movimiento_id}")
def ver_movimiento(
    movimiento_id: str,
    user: CurrentUser = Depends(require_permiso("movimientos.ver")),
    db: Session = Depends(get_db),
):
    """
    Un movimiento de otra empresa (o de otro empleado, si el rol es empleado) responde
    404 igual que uno inexistente: RLS lo oculta y así no se revela que existe (HU05).
    """
    mov = _leer(db, movimiento_id)
    if mov is None:
        raise _no_encontrado()
    return mov


@router.post("", status_code=status.HTTP_201_CREATED)
def crear_movimiento(
    datos: NuevoMovimiento,
    user: CurrentUser = Depends(require_permiso("movimientos.registrar")),
    db: Session = Depends(get_db),
):
    """
    HU06 — KONTADORIA-48. Registro manual. La empresa y el usuario salen del token, nunca del
    body; el contador recibe 403 (decisión D1). La carga por foto o PDF llega con HU08.
    """
    crid = str(datos.client_request_id) if datos.client_request_id else None
    if crid:
        repetido = db.execute(
            text("SELECT id FROM dbo.movimientos WHERE client_request_id = :crid"), {"crid": crid}
        ).scalar()
        if repetido:
            # anulados=True: si ese mismo envío se guardó y después se anuló, se devuelve tal cual
            return _leer(db, repetido, anulados=True)

    _validar_categoria(db, datos)
    try:
        mov_id = db.execute(
            text(
                """
                INSERT INTO dbo.movimientos (empresa_id, usuario_id, categoria_id, client_request_id, tipo, fecha,
                                             monto, proveedor, descripcion, tipo_documento, origen)
                OUTPUT inserted.id
                VALUES (:empresa_id, :usuario_id, :categoria_id, :crid, :tipo, :fecha,
                        :monto, :proveedor, :descripcion, :tipo_documento, 'manual')
                """
            ),
            {
                **datos.model_dump(exclude={"client_request_id"}),
                "categoria_id": str(datos.categoria_id),
                "crid": crid,
                "empresa_id": user.empresa_id,
                "usuario_id": user.usuario_id,
            },
        ).scalar_one()
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # El mismo envío llegó dos veces al mismo tiempo: el otro ya lo guardó.
        if crid and "uq_movimientos_client_request_id" in str(exc.orig):
            repetido = db.execute(
                text("SELECT id FROM dbo.movimientos WHERE client_request_id = :crid"), {"crid": crid}
            ).scalar()
            if repetido:
                return _leer(db, repetido, anulados=True)
        raise
    return _leer(db, mov_id)


@router.put("/{movimiento_id}")
def editar_movimiento(
    movimiento_id: str,
    datos: DatosMovimiento,
    user: CurrentUser = Depends(require_permiso("movimientos.registrar")),
    db: Session = Depends(get_db),
):
    """
    Corrige un movimiento. El empleado solo alcanza los suyos (RLS → 404 con los ajenos);
    quién lo registró, el origen y la empresa no cambian.
    """
    if _leer(db, movimiento_id) is None:
        raise _no_encontrado()
    _validar_categoria(db, datos)
    db.execute(
        text(
            """
            UPDATE dbo.movimientos
            SET tipo = :tipo, fecha = :fecha, monto = :monto, categoria_id = :categoria_id,
                proveedor = :proveedor, descripcion = :descripcion, tipo_documento = :tipo_documento
            WHERE id = TRY_CAST(:id AS UNIQUEIDENTIFIER) AND eliminado_en IS NULL
            """
        ),
        {**datos.model_dump(), "categoria_id": str(datos.categoria_id), "id": movimiento_id},
    )
    db.commit()
    return _leer(db, movimiento_id)


@router.delete("/{movimiento_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_movimiento(
    movimiento_id: str,
    user: CurrentUser = Depends(require_permiso("movimientos.registrar")),
    db: Session = Depends(get_db),
):
    """
    Anula el movimiento (no lo borra): deja de contar en listados y totales, pero la fila queda
    con quién lo anuló y cuándo (0008_movimientos_anulacion.sql). Mismas reglas que editar:
    el empleado solo alcanza los suyos (RLS → 404 con los ajenos).
    """
    anulados = db.execute(
        text(
            """
            UPDATE dbo.movimientos SET eliminado_en = SYSUTCDATETIME(), eliminado_por = :usuario_id
            WHERE id = TRY_CAST(:id AS UNIQUEIDENTIFIER) AND eliminado_en IS NULL
            """
        ),
        {"id": movimiento_id, "usuario_id": user.usuario_id},
    ).rowcount
    db.commit()
    if not anulados:
        raise _no_encontrado()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{movimiento_id}/restaurar")
def restaurar_movimiento(
    movimiento_id: str,
    user: CurrentUser = Depends(require_permiso("movimientos.registrar")),
    db: Session = Depends(get_db),
):
    """
    "Deshacer" de la app: vuelve a dejar vigente un movimiento anulado, con su mismo id y fecha
    de creación. 404 si no existe, no está anulado o no es alcanzable para el rol (RLS).
    """
    restaurados = db.execute(
        text(
            """
            UPDATE dbo.movimientos SET eliminado_en = NULL, eliminado_por = NULL
            WHERE id = TRY_CAST(:id AS UNIQUEIDENTIFIER) AND eliminado_en IS NOT NULL
            """
        ),
        {"id": movimiento_id},
    ).rowcount
    db.commit()
    if not restaurados:
        raise _no_encontrado()
    return _leer(db, movimiento_id)
