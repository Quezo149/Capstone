from fastapi import APIRouter, Depends

from app.core.auth import CurrentUser, get_current_user, require_roles

router = APIRouter()


@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user)):
    return {
        "usuario_id": user.usuario_id,
        "empresa_id": user.empresa_id,
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
