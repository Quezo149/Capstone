from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db, set_session_context

bearer_scheme = HTTPBearer()


@dataclass
class CurrentUser:
    usuario_id: str
    empresa_id: str
    rol: str  # 'admin' | 'contador' | 'empleado'
    email: str


def _decode_token(token: str) -> dict:
    """
    TODO: cachear el JWKS de Entra (no pedirlo en cada request) y validar
    audience/issuer/firma contra las claves publicadas en
    {entra_issuer}/.well-known/openid-configuration.
    Placeholder deliberado — no usar en producción sin completar esto.
    """
    settings = get_settings()
    try:
        return jwt.get_unverified_claims(token)  # reemplazar por jwt.decode() verificando firma
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido") from exc


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> CurrentUser:
    """
    1. Valida el token que llega del frontend (Entra External ID / MSAL).
    2. Resuelve rol y empresa desde usuarios_empresa (NO desde el token —
       ver 07 Autenticación y Multi-tenancy.md: el rol no vive en Entra).
    3. Fija SESSION_CONTEXT para que las políticas de RLS apliquen en
       cualquier query que este mismo `db` haga después.
    """
    claims = _decode_token(credentials.credentials)
    entra_oid = claims.get("oid") or claims.get("sub")
    email = claims.get("email") or claims.get("preferred_username")

    if not entra_oid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token sin identificador de usuario")

    row = db.execute(
        text(
            """
            SELECT usuario_id, empresa_id, rol
            FROM usuarios_empresa
            WHERE entra_oid = :entra_oid AND activo = 1
            """
        ),
        {"entra_oid": entra_oid},
    ).first()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario autenticado pero sin acceso a ninguna empresa registrada",
        )

    usuario_id, empresa_id, rol = row

    set_session_context(db, empresa_id=str(empresa_id), usuario_id=str(usuario_id), rol=rol)

    return CurrentUser(usuario_id=str(usuario_id), empresa_id=str(empresa_id), rol=rol, email=email or "")


def require_roles(*roles_permitidos: str):
    """
    Uso: @router.get(...) def x(user: CurrentUser = Depends(require_roles("admin", "contador"))): ...
    La validación real de permisos SIEMPRE debe respaldarse además en RLS —
    esto es una barrera adicional a nivel de endpoint, no un sustituto.
    """

    def _checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.rol not in roles_permitidos:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Rol sin permiso para esta acción")
        return user

    return _checker
