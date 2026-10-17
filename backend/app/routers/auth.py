from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user, require_roles
from app.core.db import get_db

router = APIRouter()


@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Lo primero que llama la app después de iniciar sesión. Si responde 403 con
    codigo "sin_empresa" la app muestra el registro de la empresa (HU17); con
    "usuario_desactivado", el aviso de acceso desactivado (HU01).
    """
    empresa = db.execute(text("SELECT nombre FROM dbo.empresas WHERE id = :id"), {"id": user.empresa_id}).one()
    return {
        "usuario_id": user.usuario_id,
        "empresa_id": user.empresa_id,
        "empresa_nombre": empresa.nombre,
        "rol": user.rol,
        "email": user.email,
    }


@router.post("/invitaciones")
def crear_invitacion(user: CurrentUser = Depends(require_roles("admin"))):
    """
    TODO: recibir correo + rol del invitado (body), generar token (UUID v4),
    guardar token_hash + email_invitado + expiración (72h) en `invitaciones`,
    devolver el link para que el admin lo copie — ver 07 Autenticación y
    Multi-tenancy.md, sección "Flujo de redención".
    """
    raise NotImplementedError
