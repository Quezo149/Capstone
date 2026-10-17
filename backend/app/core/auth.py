import json
import threading
import time
import urllib.request
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db, set_session_context

# auto_error=False: sin token respondemos 401 nosotros, con el mismo formato que un token inválido.
bearer_scheme = HTTPBearer(auto_error=False)

# Cada cuánto se renuevan las claves de Entra aunque no aparezca un kid desconocido,
# y cuánto esperar como mínimo entre dos descargas forzadas por un kid desconocido
# (para que tokens inventados con kid al azar no hagan que pidamos el JWKS en cada request).
_JWKS_TTL = 24 * 3600
_JWKS_REINTENTO_MIN = 300


@dataclass
class Identidad:
    """Quién es la persona según Entra External ID (token ya validado)."""

    entra_oid: str
    email: str | None
    nombre: str | None


@dataclass
class CurrentUser:
    usuario_id: str
    empresa_id: str
    rol: str  # 'admin' | 'contador' | 'empleado'
    email: str


def _error(status_code: int, codigo: str, mensaje: str) -> HTTPException:
    headers = {"WWW-Authenticate": "Bearer"} if status_code == status.HTTP_401_UNAUTHORIZED else None
    return HTTPException(status_code=status_code, detail={"codigo": codigo, "mensaje": mensaje}, headers=headers)


def _descargar_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as resp:  # noqa: S310 — URL fija de la configuración
        return json.load(resp)


class _ClavesEntra:
    """
    Metadatos OIDC y claves públicas (JWKS) del tenant, en caché por instancia de la Function.

    El emisor (`iss`) se toma del documento de descubrimiento y no de la configuración:
    en Entra External ID el dominio con que se descubre (kontadoria.ciamlogin.com) no es el
    mismo que aparece en el token (<tenant-id>.ciamlogin.com).
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._issuer: str | None = None
        self._jwks_uri: str | None = None
        self._claves: dict[str, dict] = {}
        self._descargado_en = 0.0

    def _cargar(self) -> None:
        if self._jwks_uri is None:
            base = get_settings().entra_issuer.rstrip("/")
            meta = _descargar_json(f"{base}/.well-known/openid-configuration")
            self._issuer, self._jwks_uri = meta["issuer"], meta["jwks_uri"]
        jwks = _descargar_json(self._jwks_uri)
        self._claves = {k["kid"]: k for k in jwks.get("keys", []) if "kid" in k}
        self._descargado_en = time.monotonic()

    def obtener(self, kid: str) -> tuple[dict | None, str]:
        with self._lock:
            edad = time.monotonic() - self._descargado_en
            if self._issuer is None or edad > _JWKS_TTL or (kid not in self._claves and edad > _JWKS_REINTENTO_MIN):
                self._cargar()
            assert self._issuer is not None
            return self._claves.get(kid), self._issuer

    def reiniciar(self) -> None:
        """Solo para pruebas."""
        with self._lock:
            self.__init__()


claves_entra = _ClavesEntra()


def _decode_token(token: str) -> dict:
    """
    Valida un access token de Entra External ID (HU01 — KONTADORIA-19):
    firma RS256 con las claves publicadas por el tenant, emisor, audiencia (esta API),
    vencimiento, y que sea un access token con el scope de la API (no un ID token).
    Cualquier falla → 401, sin detallar cuál (no orientar a quien intenta falsificar).
    """
    settings = get_settings()
    invalido = _error(status.HTTP_401_UNAUTHORIZED, "token_invalido", "Tu sesión no es válida. Vuelve a iniciar sesión.")
    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise invalido from exc
    # Solo RS256: evita ataques de "alg: none" o de usar la clave pública como secreto HMAC.
    if header.get("alg") != "RS256" or not header.get("kid"):
        raise invalido

    try:
        clave, issuer = claves_entra.obtener(header["kid"])
    except Exception as exc:  # Entra no respondió: no es culpa del token, pero no podemos validarlo
        raise _error(status.HTTP_503_SERVICE_UNAVAILABLE, "entra_no_disponible", "No pudimos validar tu sesión. Intenta en unos segundos.") from exc
    if clave is None:
        raise invalido

    try:
        claims = jwt.decode(
            token,
            clave,
            algorithms=["RS256"],
            issuer=issuer,
            options={"verify_aud": False, "require_exp": True, "require_iss": True},
        )
    except JWTError as exc:
        raise invalido from exc

    # La audiencia se valida aparte para aceptar las dos formas en que Entra la emite.
    audiencias_validas = {settings.entra_client_id, f"api://{settings.entra_client_id}"}
    aud = claims.get("aud")
    if (aud if isinstance(aud, str) else None) not in audiencias_validas:
        raise invalido
    # El ID token tiene la misma audiencia pero no trae `scp`: no sirve para llamar a la API.
    if settings.entra_api_scope not in str(claims.get("scp", "")).split():
        raise invalido
    if not claims.get("oid"):
        raise invalido
    return claims


def get_identidad(credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)) -> Identidad:
    """Token válido, sin exigir que la persona ya pertenezca a una empresa (onboarding, HU17)."""
    if credentials is None:
        raise _error(status.HTTP_401_UNAUTHORIZED, "sin_token", "Debes iniciar sesión.")
    claims = _decode_token(credentials.credentials)
    email = claims.get("email") or claims.get("preferred_username")
    if not email and isinstance(claims.get("emails"), list) and claims["emails"]:
        email = claims["emails"][0]
    return Identidad(
        entra_oid=str(claims["oid"]),
        email=email.lower() if email else None,
        nombre=claims.get("name"),
    )


def get_current_user(
    identidad: Identidad = Depends(get_identidad),
    db: Session = Depends(get_db),
) -> CurrentUser:
    """
    1. Valida el token que llega del frontend (Entra External ID / MSAL).
    2. Resuelve rol y empresa desde usuarios_empresa (NO desde el token —
       ver 07 Autenticación y Multi-tenancy.md: el rol no vive en Entra).
    3. Fija SESSION_CONTEXT para que las políticas de RLS apliquen en
       cualquier query que este mismo `db` haga después.

    Sprint 1: si la persona pertenece a varias empresas se usa la más antigua en que está
    activa. El selector de empresa llega con el Plan Contador (13 Backlog Futuro).
    """
    rows = db.execute(
        text(
            """
            SELECT u.id AS usuario_id, ue.empresa_id, ue.rol, ue.activo, u.email
            FROM dbo.usuarios u
            JOIN dbo.usuarios_empresa ue ON ue.usuario_id = u.id
            WHERE u.entra_oid = :entra_oid
            ORDER BY ue.activo DESC, ue.creado_en
            """
        ),
        {"entra_oid": identidad.entra_oid},
    ).all()

    if not rows:
        raise _error(status.HTTP_403_FORBIDDEN, "sin_empresa", "Aún no registras tu empresa.")
    usuario_id, empresa_id, rol, activo, email = rows[0]
    if not activo:
        # HU01: un usuario desactivado no entra aunque sus credenciales sean correctas.
        raise _error(status.HTTP_403_FORBIDDEN, "usuario_desactivado", "Tu acceso a esta empresa fue desactivado. Habla con el administrador.")

    set_session_context(db, empresa_id=str(empresa_id), usuario_id=str(usuario_id), rol=rol)

    return CurrentUser(usuario_id=str(usuario_id), empresa_id=str(empresa_id), rol=rol, email=email)


def require_roles(*roles_permitidos: str):
    """
    Uso: @router.get(...) def x(user: CurrentUser = Depends(require_roles("admin", "contador"))): ...
    La validación real de permisos SIEMPRE debe respaldarse además en RLS —
    esto es una barrera adicional a nivel de endpoint, no un sustituto.
    """

    def _checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.rol not in roles_permitidos:
            raise _error(status.HTTP_403_FORBIDDEN, "rol_sin_permiso", "Tu rol no tiene permiso para esta acción.")
        return user

    return _checker
