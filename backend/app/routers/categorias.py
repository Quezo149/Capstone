from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, StringConstraints, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_permiso
from app.core.db import get_db

router = APIRouter()

Nombre = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
# Mismo formato que ck_categorias_color (0005_categorias.sql): #rrggbb
Color = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, pattern=r"^#[0-9a-fA-F]{6}$")]


# El color se ve sobre fondo blanco (tema claro) y verde casi negro (tema oscuro): uno muy
# oscuro desaparece en el oscuro y uno muy claro en el claro. Se exige luminancia intermedia,
# equivalente a un contraste de ~2,2:1 contra los dos fondos. Misma regla en frontend/src/lib/color.js.
LUMINANCIA_MIN = 0.08
LUMINANCIA_MAX = 0.43


def luminancia(hex_color: str) -> float:
    """Luminancia relativa de WCAG 2.x: 0 = negro, 1 = blanco."""
    canales = []
    for i in (1, 3, 5):
        c = int(hex_color[i : i + 2], 16) / 255
        canales.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    r, g, b = canales
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


class CambiosCategoria(BaseModel):
    nombre: Nombre
    color: Color

    @field_validator("color")
    @classmethod
    def _color_legible(cls, v: str) -> str:
        l = luminancia(v)
        if l < LUMINANCIA_MIN:
            raise ValueError("Ese color es muy oscuro: no se vería en el modo oscuro.")
        if l > LUMINANCIA_MAX:
            raise ValueError("Ese color es muy claro: no se vería en el modo claro.")
        return v


class NuevaCategoria(CambiosCategoria):
    # El tipo no se edita después: los movimientos ya registrados con la categoría
    # quedarían con un tipo distinto al de su categoría.
    tipo: Literal["ingreso", "gasto"]


def _error(status_code: int, codigo: str, mensaje: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"codigo": codigo, "mensaje": mensaje})


# `oculta`: la empresa la ocultó (0011_categorias_ocultas.sql). RLS deja ver solo sus filas.
_OCULTA = "EXISTS (SELECT 1 FROM dbo.categorias_ocultas o WHERE o.categoria_id = c.id)"

_SELECT = f"""
    SELECT c.id, c.nombre, c.tipo, c.color, CASE WHEN c.empresa_id IS NULL THEN 1 ELSE 0 END AS predefinida,
           CASE WHEN {_OCULTA} THEN 1 ELSE 0 END AS oculta
    FROM dbo.categorias c
"""


def _json(row) -> dict:
    return {
        "id": str(row.id),
        "nombre": row.nombre,
        "tipo": row.tipo,
        "color": row.color,
        "predefinida": bool(row.predefinida),
        "oculta": bool(row.oculta),
    }


def _visibles(db: Session, tipo: str) -> int:
    """Categorías de ese tipo que la empresa ve al registrar: predefinidas no ocultas + propias."""
    return db.execute(
        text(f"SELECT COUNT(*) FROM dbo.categorias c WHERE c.tipo = :tipo AND NOT {_OCULTA}"), {"tipo": tipo}
    ).scalar_one()


def _ultima_visible(tipo: str) -> HTTPException:
    # El empleado no crea categorías (D2): sin ninguna visible no podría registrar
    nombre = "gastos" if tipo == "gasto" else "ingresos"
    return _error(status.HTTP_409_CONFLICT, "ultima_visible", f"Debe quedar al menos una categoría de {nombre}.")


def _nombre_repetido(db: Session, tipo: str, nombre: str, excepto: str | None = None) -> bool:
    """
    uq_categorias_nombre no impide que una categoría propia se llame igual que una predefinida
    (empresa_id distinto), y en el formulario se verían dos "Ventas". Se revisa aquí contra
    todas las que la empresa ve (RLS), sin distinguir mayúsculas por la intercalación de la base.
    """
    return (
        db.execute(
            text(
                "SELECT 1 FROM dbo.categorias WHERE tipo = :tipo AND nombre = :nombre"
                " AND (:excepto IS NULL OR id <> TRY_CAST(:excepto AS UNIQUEIDENTIFIER))"
            ),
            {"tipo": tipo, "nombre": nombre, "excepto": excepto},
        ).first()
        is not None
    )


def _propia(db: Session, categoria_id: str):
    """La categoría a modificar: 404 si no existe o es de otra empresa, 403 si es predefinida."""
    row = db.execute(
        text(f"{_SELECT} WHERE c.id = TRY_CAST(:id AS UNIQUEIDENTIFIER)"), {"id": categoria_id}
    ).first()
    if row is None:
        raise _error(status.HTTP_404_NOT_FOUND, "no_encontrada", "Categoría no encontrada.")
    if row.predefinida:
        raise _error(status.HTTP_403_FORBIDDEN, "categoria_predefinida", "Las categorías predefinidas no se pueden modificar.")
    return row


_REPETIDA = (status.HTTP_409_CONFLICT, "categoria_repetida", "Ya existe una categoría de ese tipo con ese nombre.")


@router.get("")
def listar_categorias(user: CurrentUser = Depends(require_permiso("categorias.ver")), db: Session = Depends(get_db)):
    """
    Predefinidas (empresa_id NULL) + propias de la empresa. Sin WHERE por empresa:
    lo filtra RLS (seguridad.politica_categorias, 0007_rls.sql).
    """
    rows = db.execute(text(f"{_SELECT} ORDER BY c.tipo DESC, predefinida DESC, c.nombre")).all()
    return [_json(r) for r in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def crear_categoria(
    datos: NuevaCategoria,
    user: CurrentUser = Depends(require_permiso("categorias.gestionar")),
    db: Session = Depends(get_db),
):
    """HU14 — KONTADORIA-36. La empresa sale del usuario autenticado, nunca del body."""
    if _nombre_repetido(db, datos.tipo, datos.nombre):
        raise _error(*_REPETIDA)
    try:
        row = db.execute(
            text(
                """
                INSERT INTO dbo.categorias (empresa_id, nombre, tipo, color)
                OUTPUT inserted.id, inserted.nombre, inserted.tipo, inserted.color, 0 AS predefinida, 0 AS oculta
                VALUES (:empresa_id, :nombre, :tipo, :color)
                """
            ),
            {**datos.model_dump(), "empresa_id": user.empresa_id},
        ).one()
        db.commit()
    except IntegrityError as exc:  # dos altas simultáneas con el mismo nombre
        db.rollback()
        if "uq_categorias_nombre" in str(exc.orig):
            raise _error(*_REPETIDA) from exc
        raise
    return _json(row)


@router.put("/{categoria_id}")
def editar_categoria(
    categoria_id: str,
    datos: CambiosCategoria,
    user: CurrentUser = Depends(require_permiso("categorias.gestionar")),
    db: Session = Depends(get_db),
):
    """HU14 — KONTADORIA-36. Nombre y color de una categoría propia; las predefinidas no se tocan."""
    actual = _propia(db, categoria_id)
    if _nombre_repetido(db, actual.tipo, datos.nombre, excepto=categoria_id):
        raise _error(*_REPETIDA)
    try:
        db.execute(
            text("UPDATE dbo.categorias SET nombre = :nombre, color = :color WHERE id = :id"),
            {**datos.model_dump(), "id": actual.id},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if "uq_categorias_nombre" in str(exc.orig):
            raise _error(*_REPETIDA) from exc
        raise
    return {**_json(actual), **datos.model_dump()}


@router.delete("/{categoria_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_categoria(
    categoria_id: str,
    user: CurrentUser = Depends(require_permiso("categorias.gestionar")),
    db: Session = Depends(get_db),
):
    """
    Solo si ningún movimiento la usa, ni siquiera uno anulado: borrarla dejaría movimientos
    (o su historial) sin categoría. Tampoco la última visible de su tipo (ver _ultima_visible).
    """
    actual = _propia(db, categoria_id)
    if _visibles(db, actual.tipo) <= 1:
        raise _ultima_visible(actual.tipo)
    try:
        db.execute(text("DELETE FROM dbo.categorias WHERE id = :id"), {"id": actual.id})
        db.commit()
    except IntegrityError as exc:  # fk_movimientos_categoria
        db.rollback()
        raise _error(
            status.HTTP_409_CONFLICT, "categoria_en_uso", "No se puede eliminar: la categoría está en uso."
        ) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class Visibilidad(BaseModel):
    oculta: bool


@router.put("/{categoria_id}/oculta")
def ocultar_categoria(
    categoria_id: str,
    datos: Visibilidad,
    user: CurrentUser = Depends(require_permiso("categorias.gestionar")),
    db: Session = Depends(get_db),
):
    """
    Mejora a HU14 (28-10-2026): ocultar o volver a mostrar una predefinida en la empresa. No se
    borra ni cambia para las demás empresas; los movimientos que la usan la siguen mostrando.
    Repetir la misma acción no da error.
    """
    row = db.execute(text(f"{_SELECT} WHERE c.id = TRY_CAST(:id AS UNIQUEIDENTIFIER)"), {"id": categoria_id}).first()
    if row is None:
        raise _error(status.HTTP_404_NOT_FOUND, "no_encontrada", "Categoría no encontrada.")
    if not row.predefinida:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "solo_predefinidas", "Las categorías propias se editan o se eliminan."
        )
    if datos.oculta and not row.oculta:
        if _visibles(db, row.tipo) <= 1:
            raise _ultima_visible(row.tipo)
        try:
            db.execute(
                text(
                    "INSERT INTO dbo.categorias_ocultas (empresa_id, categoria_id, ocultada_por)"
                    " VALUES (:empresa_id, :categoria_id, :usuario_id)"
                ),
                {"empresa_id": user.empresa_id, "categoria_id": str(row.id), "usuario_id": user.usuario_id},
            )
            db.commit()
        except IntegrityError:  # otra pestaña la ocultó al mismo tiempo: ya está oculta
            db.rollback()
    elif not datos.oculta and row.oculta:
        # RLS: el DELETE solo alcanza la fila de esta empresa
        db.execute(text("DELETE FROM dbo.categorias_ocultas WHERE categoria_id = :id"), {"id": str(row.id)})
        db.commit()
    return {**_json(row), "oculta": datos.oculta}
