from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, StringConstraints, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, Identidad, get_identidad, require_permiso
from app.core.cuentas import asegurar_usuario, pertenece_a_una_empresa
from app.core.db import get_db, set_contexto_invitacion
from app.core.politica import ConPolitica, registrar_aceptacion
from app.core.rut import formatear_rut, normalizar_rut

router = APIRouter()

Texto = Annotated[str, StringConstraints(strip_whitespace=True)]


class DatosEmpresa(BaseModel):
    """Mismos largos que dbo.empresas (db/migrations/0004_empresas_usuarios.sql)."""

    nombre: Annotated[Texto, Field(min_length=1, max_length=150)]
    rut: Annotated[Texto, Field(max_length=15)]
    giro: Annotated[Texto, Field(max_length=150)] | None = None

    @field_validator("rut")
    @classmethod
    def _rut_valido(cls, v: str) -> str:
        return normalizar_rut(v)  # ValueError → 422 con el mensaje

    @field_validator("giro")
    @classmethod
    def _giro_vacio_es_nulo(cls, v: str | None) -> str | None:
        return v or None


class RegistroEmpresa(DatosEmpresa, ConPolitica):
    """Registro (HU17): los datos de la empresa más la aceptación de la política de privacidad."""


def _error(status_code: int, codigo: str, mensaje: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"codigo": codigo, "mensaje": mensaje})


def _empresa_json(row) -> dict:
    return {
        "id": str(row.id),
        "nombre": row.nombre,
        "rut": formatear_rut(row.rut),
        "giro": row.giro,
    }


def _leer_empresa(db: Session, empresa_id: str):
    return db.execute(
        text("SELECT id, nombre, rut, giro FROM dbo.empresas WHERE id = :id"), {"id": empresa_id}
    ).one()


@router.post("", status_code=status.HTTP_201_CREATED)
def registrar_empresa(
    datos: RegistroEmpresa,
    identidad: Identidad = Depends(get_identidad),
    db: Session = Depends(get_db),
):
    """
    HU17 — KONTADORIA-25. Primer inicio de sesión de un dueño: crea su usuario, su empresa
    y lo deja como administrador, todo en una transacción.

    Quien ya pertenece a una empresa (por ejemplo, porque llegó con una invitación, HU02)
    no puede crear otra: se une a la que lo invitó, con el rol asignado. Tampoco quien tiene
    una invitación pendiente: lo más probable es que se haya saltado el link y crearía una
    empresa vacía por error.

    Las categorías predefinidas no se copian: son filas con empresa_id NULL que RLS deja
    ver a todas las empresas (0005_categorias.sql).
    """
    if not identidad.email:
        # Falta el claim opcional "email" en el access token (Entra → Token configuration).
        raise _error(status.HTTP_400_BAD_REQUEST, "token_sin_email", "No pudimos leer tu correo desde la sesión.")

    if pertenece_a_una_empresa(db, identidad.entra_oid):
        raise _error(status.HTTP_409_CONFLICT, "ya_tiene_empresa", "Tu cuenta ya pertenece a una empresa.")

    # Con el correo verificado de la sesión, RLS deja ver solo las invitaciones dirigidas a él
    set_contexto_invitacion(db, email=identidad.email)
    invitacion = db.execute(
        text(
            """
            SELECT TOP 1 e.nombre FROM dbo.invitaciones i JOIN dbo.empresas e ON e.id = i.empresa_id
            WHERE i.email_invitado = :email AND i.aceptada_en IS NULL AND i.revocada_en IS NULL
              AND i.expira_en > SYSUTCDATETIME()
            ORDER BY i.creado_en DESC
            """
        ),
        {"email": identidad.email},
    ).first()
    if invitacion:
        raise _error(
            status.HTTP_409_CONFLICT,
            "tiene_invitacion",
            f"{invitacion.nombre} te invitó a su equipo. Abre el link que te enviaron para unirte.",
        )

    try:
        usuario_id = asegurar_usuario(db, identidad)
        registrar_aceptacion(db, usuario_id)
        empresa = db.execute(
            text(
                """
                INSERT INTO dbo.empresas (nombre, rut, giro)
                OUTPUT inserted.id, inserted.nombre, inserted.rut, inserted.giro
                VALUES (:nombre, :rut, :giro)
                """
            ),
            datos.model_dump(include={"nombre", "rut", "giro"}),
        ).one()
        db.execute(
            text("INSERT INTO dbo.usuarios_empresa (usuario_id, empresa_id, rol) VALUES (:u, :e, 'admin')"),
            {"u": usuario_id, "e": empresa.id},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if "uq_empresas_rut" in str(exc.orig):
            raise _error(status.HTTP_409_CONFLICT, "rut_registrado", "Ya existe una empresa registrada con ese RUT.") from exc
        raise

    return {"empresa": _empresa_json(empresa), "rol": "admin"}


@router.get("/actual")
def ver_empresa(user: CurrentUser = Depends(require_permiso("empresa.ver")), db: Session = Depends(get_db)):
    """HU04 — KONTADORIA-28. Cualquier miembro activo ve los datos de su empresa (la app muestra el nombre)."""
    return {"empresa": _empresa_json(_leer_empresa(db, user.empresa_id)), "rol": user.rol}


@router.put("/actual")
def editar_empresa(
    datos: DatosEmpresa,
    user: CurrentUser = Depends(require_permiso("empresa.editar")),
    db: Session = Depends(get_db),
):
    """
    HU04 — KONTADORIA-28. Solo el administrador modifica nombre, RUT y giro.
    La empresa a editar sale del usuario autenticado, nunca de un id enviado por el cliente.
    """
    try:
        db.execute(
            text("UPDATE dbo.empresas SET nombre = :nombre, rut = :rut, giro = :giro WHERE id = :id"),
            {**datos.model_dump(), "id": user.empresa_id},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if "uq_empresas_rut" in str(exc.orig):
            raise _error(status.HTTP_409_CONFLICT, "rut_registrado", "Ya existe una empresa registrada con ese RUT.") from exc
        raise
    return {"empresa": _empresa_json(_leer_empresa(db, user.empresa_id)), "rol": user.rol}
