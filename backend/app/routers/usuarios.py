from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_permiso
from app.core.db import get_db

router = APIRouter()


class CambioRol(BaseModel):
    rol: Literal["admin", "contador", "empleado"]


class CambioActivo(BaseModel):
    activo: bool


def _error(status_code: int, codigo: str, mensaje: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"codigo": codigo, "mensaje": mensaje})


# usuarios_empresa no tiene RLS (get_current_user la lee antes de conocer la empresa),
# por eso en este router el filtro por empresa va siempre explícito y sale del token.
_SELECT = """
    SELECT u.id, u.email, u.nombre, ue.rol, ue.activo, ue.creado_en
    FROM dbo.usuarios_empresa ue
    JOIN dbo.usuarios u ON u.id = ue.usuario_id
    WHERE ue.empresa_id = :empresa_id
"""


def _json(r) -> dict:
    return {"id": str(r.id), "email": r.email, "nombre": r.nombre, "rol": r.rol, "activo": bool(r.activo)}


@router.get("")
def listar_usuarios(user: CurrentUser = Depends(require_permiso("usuarios.ver")), db: Session = Depends(get_db)):
    """Miembros de la empresa: pantalla Equipo (HU02) y filtro por usuario (HU07)."""
    rows = db.execute(text(f"{_SELECT} ORDER BY ue.activo DESC, ue.creado_en"), {"empresa_id": user.empresa_id}).all()
    return [_json(r) for r in rows]


def _miembro(db: Session, empresa_id: str, usuario_id: str):
    """
    La membresía a modificar, bloqueada hasta el commit (UPDLOCK). 404 si no es de esta empresa.
    """
    row = db.execute(
        text(
            """
            SELECT ue.id, ue.rol, ue.activo FROM dbo.usuarios_empresa ue WITH (UPDLOCK, HOLDLOCK)
            WHERE ue.empresa_id = :empresa_id AND ue.usuario_id = TRY_CAST(:usuario_id AS UNIQUEIDENTIFIER)
            """
        ),
        {"empresa_id": empresa_id, "usuario_id": usuario_id},
    ).first()
    if row is None:
        raise _error(status.HTTP_404_NOT_FOUND, "no_encontrado", "Usuario no encontrado en tu empresa.")
    return row


def _proteger_ultimo_admin(db: Session, empresa_id: str, miembro) -> None:
    """
    KONTADORIA-41. Si el cambio deja a la empresa sin administradores activos, se rechaza.
    UPDLOCK + HOLDLOCK sobre los admins activos: dos admins que se quitan el rol a la vez no
    pueden ver los dos "queda otro"; el segundo espera al primero y recién entonces cuenta.
    """
    if miembro.rol != "admin" or not miembro.activo:
        return
    admins = db.execute(
        text(
            """
            SELECT COUNT(*) FROM dbo.usuarios_empresa WITH (UPDLOCK, HOLDLOCK)
            WHERE empresa_id = :empresa_id AND rol = 'admin' AND activo = 1
            """
        ),
        {"empresa_id": empresa_id},
    ).scalar_one()
    if admins <= 1:
        raise _error(
            status.HTTP_409_CONFLICT,
            "ultimo_admin",
            "Es el único administrador. Primero asigna a otra persona como administrador.",
        )


def _leer(db: Session, empresa_id: str, usuario_id: str) -> dict:
    return _json(
        db.execute(text(f"{_SELECT} AND u.id = :usuario_id"), {"empresa_id": empresa_id, "usuario_id": usuario_id}).one()
    )


@router.put("/{usuario_id}/rol")
def cambiar_rol(
    usuario_id: str,
    datos: CambioRol,
    user: CurrentUser = Depends(require_permiso("usuarios.gestionar")),
    db: Session = Depends(get_db),
):
    """KONTADORIA-41. Rige desde el siguiente request del usuario (el rol se lee de la base en cada uno)."""
    miembro = _miembro(db, user.empresa_id, usuario_id)
    if datos.rol != "admin":
        _proteger_ultimo_admin(db, user.empresa_id, miembro)
    db.execute(text("UPDATE dbo.usuarios_empresa SET rol = :rol WHERE id = :id"), {"rol": datos.rol, "id": miembro.id})
    db.commit()
    return _leer(db, user.empresa_id, usuario_id)


@router.put("/{usuario_id}/activo")
def cambiar_activo(
    usuario_id: str,
    datos: CambioActivo,
    user: CurrentUser = Depends(require_permiso("usuarios.gestionar")),
    db: Session = Depends(get_db),
):
    """
    KONTADORIA-41. Desactivado no entra (get_current_user → 403 usuario_desactivado) y su
    historial de movimientos se conserva. Se puede reactivar.
    """
    miembro = _miembro(db, user.empresa_id, usuario_id)
    if not datos.activo:
        _proteger_ultimo_admin(db, user.empresa_id, miembro)
    db.execute(
        text("UPDATE dbo.usuarios_empresa SET activo = :activo WHERE id = :id"), {"activo": int(datos.activo), "id": miembro.id}
    )
    db.commit()
    return _leer(db, user.empresa_id, usuario_id)
