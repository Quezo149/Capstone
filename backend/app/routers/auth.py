from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user
from app.core.db import get_db
from app.core.permisos import permisos_de

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
        # HU03 — KONTADORIA-45: la app muestra u oculta acciones con esta lista,
        # calculada en el servidor a partir del rol guardado en usuarios_empresa.
        "permisos": permisos_de(user.rol),
    }
