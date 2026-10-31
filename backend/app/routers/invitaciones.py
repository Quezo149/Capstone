"""
HU02 — Invitaciones (KONTADORIA-39, 40). Ver "07 Autenticación y Multi-tenancy", flujo de
redención y checklist de seguridad del token, y db/migrations/0009_invitaciones.sql.

1. El admin invita con correo y rol → se genera un token aleatorio, se guarda solo su SHA-256
   y la app arma el link (/#/invitacion/<token>). El link se muestra una sola vez.
2. El invitado abre el link: GET /invitaciones/publica/<token> le dice quién lo invita y con qué rol.
3. Inicia sesión con el correo invitado: POST /invitaciones/aceptar valida correo, vigencia
   (72 h) y un solo uso, y lo deja en usuarios_empresa con el rol guardado en la invitación.
"""

import hashlib
import secrets
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, Identidad, get_identidad, require_permiso
from app.core.cuentas import asegurar_usuario, pertenece_a_una_empresa
from app.core.db import get_db, set_contexto_invitacion
from app.core.politica import ConPolitica, registrar_aceptacion

router = APIRouter()

VIGENCIA_HORAS = 72

Email = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")]


class NuevaInvitacion(BaseModel):
    email: Email
    rol: Literal["admin", "contador", "empleado"]


class Aceptar(ConPolitica):
    token: Annotated[str, Field(min_length=20, max_length=100)]


def _error(status_code: int, codigo: str, mensaje: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"codigo": codigo, "mensaje": mensaje})


def _hash(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def _enmascarar(email: str) -> str:
    """
    fe•••••@gmail.com: el invitado reconoce su correo; quien encuentre un link ajeno, no del todo.
    Siempre 5 puntos, para no revelar el largo del correo.
    """
    local, _, dominio = email.partition("@")
    return f"{local[:2]}•••••@{dominio}"


# El estado se deriva de las fechas (0009_invitaciones.sql)
_ESTADO = """
    CASE WHEN i.aceptada_en IS NOT NULL THEN 'usada'
         WHEN i.revocada_en IS NOT NULL THEN 'revocada'
         WHEN i.expira_en <= SYSUTCDATETIME() THEN 'vencida'
         ELSE 'pendiente' END
"""

_NO_VIGENTE = {
    "usada": (status.HTTP_410_GONE, "invitacion_usada", "Este link ya se usó. Pide uno nuevo a quien te invitó."),
    "revocada": (status.HTTP_410_GONE, "invitacion_revocada", "Esta invitación fue anulada. Pide una nueva a quien te invitó."),
    "vencida": (status.HTTP_410_GONE, "invitacion_vencida", "Este link venció (dura 72 horas). Pide uno nuevo a quien te invitó."),
}


def _invitacion_json(r) -> dict:
    return {
        "id": str(r.id),
        "email": r.email_invitado,
        "rol": r.rol,
        "estado": r.estado,
        # SQL guarda UTC sin zona: con la Z el navegador no la confunde con hora local
        "creado_en": f"{r.creado_en.isoformat()}Z",
        "expira_en": f"{r.expira_en.isoformat()}Z",
        "invitado_por": r.invitado_por_nombre,
    }


_SELECT_ADMIN = f"""
    SELECT i.id, i.email_invitado, i.rol, i.creado_en, i.expira_en, {_ESTADO} AS estado,
           COALESCE(u.nombre, u.email) AS invitado_por_nombre
    FROM dbo.invitaciones i
    JOIN dbo.usuarios_empresa ue ON ue.id = i.invitado_por
    JOIN dbo.usuarios u ON u.id = ue.usuario_id
"""


@router.post("", status_code=status.HTTP_201_CREATED)
def crear_invitacion(
    datos: NuevaInvitacion,
    user: CurrentUser = Depends(require_permiso("usuarios.gestionar")),
    db: Session = Depends(get_db),
):
    """
    KONTADORIA-39. Devuelve el token UNA vez (la app arma el link); en la base queda su hash.
    Si ya había una invitación vigente para ese correo, se revoca: vale solo el link más nuevo.
    """
    ya_es_miembro = db.execute(
        text(
            """
            SELECT 1 FROM dbo.usuarios_empresa ue JOIN dbo.usuarios u ON u.id = ue.usuario_id
            WHERE ue.empresa_id = :empresa_id AND u.email = :email
            """
        ),
        {"empresa_id": user.empresa_id, "email": datos.email},
    ).first()
    if ya_es_miembro:
        raise _error(
            status.HTTP_409_CONFLICT, "ya_es_miembro", "Esa persona ya es parte de tu equipo. Si está desactivada, reactívala."
        )

    # La invitación queda a nombre de la membresía de quien invita (usuarios_empresa.id)
    invitado_por = db.execute(
        text("SELECT id FROM dbo.usuarios_empresa WHERE usuario_id = :u AND empresa_id = :e"),
        {"u": user.usuario_id, "e": user.empresa_id},
    ).scalar_one()

    token = secrets.token_urlsafe(32)  # 32 bytes aleatorios (~43 caracteres)
    db.execute(
        text(
            """
            UPDATE dbo.invitaciones SET revocada_en = SYSUTCDATETIME()
            WHERE email_invitado = :email AND aceptada_en IS NULL AND revocada_en IS NULL
            """
        ),
        {"email": datos.email},
    )
    inv_id = db.execute(
        text(
            f"""
            INSERT INTO dbo.invitaciones (empresa_id, email_invitado, rol, token_hash, expira_en, invitado_por)
            OUTPUT inserted.id
            VALUES (:empresa_id, :email, :rol, :hash, DATEADD(HOUR, {VIGENCIA_HORAS}, SYSUTCDATETIME()), :invitado_por)
            """
        ),
        {**datos.model_dump(), "empresa_id": user.empresa_id, "hash": _hash(token), "invitado_por": invitado_por},
    ).scalar_one()
    db.commit()
    row = db.execute(text(f"{_SELECT_ADMIN} WHERE i.id = :id"), {"id": inv_id}).one()
    return {"invitacion": _invitacion_json(row), "token": token}


@router.get("")
def listar_invitaciones(user: CurrentUser = Depends(require_permiso("usuarios.gestionar")), db: Session = Depends(get_db)):
    """KONTADORIA-39. Las que siguen abiertas (pendientes o vencidas sin revocar). RLS filtra la empresa."""
    rows = db.execute(
        text(f"{_SELECT_ADMIN} WHERE i.aceptada_en IS NULL AND i.revocada_en IS NULL ORDER BY i.creado_en DESC")
    ).all()
    return [_invitacion_json(r) for r in rows]


@router.delete("/{invitacion_id}", status_code=status.HTTP_204_NO_CONTENT)
def revocar_invitacion(
    invitacion_id: str,
    user: CurrentUser = Depends(require_permiso("usuarios.gestionar")),
    db: Session = Depends(get_db),
):
    """Antes de que se use. Una de otra empresa responde 404 (RLS la oculta)."""
    revocadas = db.execute(
        text(
            """
            UPDATE dbo.invitaciones SET revocada_en = SYSUTCDATETIME()
            WHERE id = TRY_CAST(:id AS UNIQUEIDENTIFIER) AND aceptada_en IS NULL AND revocada_en IS NULL
            """
        ),
        {"id": invitacion_id},
    ).rowcount
    db.commit()
    if not revocadas:
        raise _error(status.HTTP_404_NOT_FOUND, "no_encontrada", "Invitación no encontrada.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _por_token(db: Session, token: str):
    """La invitación del link, vista con el contexto de su propio token (RLS, 0009)."""
    set_contexto_invitacion(db, token_hash=_hash(token))
    return db.execute(
        text(
            f"""
            SELECT i.id, i.empresa_id, i.email_invitado, i.rol, {_ESTADO} AS estado, e.nombre AS empresa_nombre
            FROM dbo.invitaciones i JOIN dbo.empresas e ON e.id = i.empresa_id
            WHERE i.token_hash = :hash
            """
        ),
        {"hash": _hash(token)},
    ).first()


_INVALIDA = (status.HTTP_404_NOT_FOUND, "invitacion_invalida", "Este link de invitación no es válido. Revisa que lo copiaste completo.")


@router.get("/publica/{token}")
def ver_invitacion(token: str, db: Session = Depends(get_db)):
    """
    Sin sesión: lo que muestra la pantalla del link antes de iniciar sesión. El correo va
    completo para pre-llenarlo en la página de Microsoft (login_hint): el link es la credencial,
    y quien lo tiene es a quien el admin se lo mandó. A quien entra con otro correo, en cambio,
    se le muestra enmascarado (aceptar_invitacion).
    """
    inv = _por_token(db, token)
    if inv is None:
        raise _error(*_INVALIDA)
    return {"empresa": inv.empresa_nombre, "rol": inv.rol, "email": inv.email_invitado, "estado": inv.estado}


@router.post("/aceptar")
def aceptar_invitacion(datos: Aceptar, identidad: Identidad = Depends(get_identidad), db: Session = Depends(get_db)):
    """
    KONTADORIA-40. Correo de la sesión = correo invitado, vigente (72 h) y un solo uso.
    El rol sale de la invitación, nunca del body.
    """
    inv = _por_token(db, datos.token)
    if inv is None:
        raise _error(*_INVALIDA)
    if inv.estado in _NO_VIGENTE:
        raise _error(*_NO_VIGENTE[inv.estado])
    if not identidad.email:
        raise _error(status.HTTP_400_BAD_REQUEST, "token_sin_email", "No pudimos leer tu correo desde la sesión.")
    if identidad.email != inv.email_invitado:
        raise _error(
            status.HTTP_403_FORBIDDEN,
            "correo_distinto",
            f"Esta invitación es para {_enmascarar(inv.email_invitado)}. Cierra sesión y entra con ese correo.",
        )
    if pertenece_a_una_empresa(db, identidad.entra_oid):
        raise _error(status.HTTP_409_CONFLICT, "ya_tiene_empresa", "Tu cuenta ya pertenece a una empresa.")

    usuario_id = asegurar_usuario(db, identidad)
    registrar_aceptacion(db, usuario_id)
    # Se marca usada primero y con la condición completa: si dos pestañas aceptan a la vez,
    # solo una cambia la fila y la otra sale por aquí.
    usadas = db.execute(
        text(
            """
            UPDATE dbo.invitaciones SET aceptada_en = SYSUTCDATETIME(), aceptada_por = :usuario_id
            WHERE id = :id AND aceptada_en IS NULL AND revocada_en IS NULL AND expira_en > SYSUTCDATETIME()
            """
        ),
        {"id": inv.id, "usuario_id": usuario_id},
    ).rowcount
    if not usadas:
        db.rollback()
        raise _error(*_NO_VIGENTE["usada"])
    db.execute(
        text("INSERT INTO dbo.usuarios_empresa (usuario_id, empresa_id, rol) VALUES (:u, :e, :rol)"),
        {"u": usuario_id, "e": inv.empresa_id, "rol": inv.rol},
    )
    db.commit()
    return {"empresa": inv.empresa_nombre, "rol": inv.rol}
