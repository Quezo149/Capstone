from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, StringConstraints, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, Identidad, get_current_user, get_identidad, require_roles
from app.core.db import get_db
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
    datos: DatosEmpresa,
    identidad: Identidad = Depends(get_identidad),
    db: Session = Depends(get_db),
):
    """
    HU17 — KONTADORIA-25. Primer inicio de sesión de un dueño: crea su usuario, su empresa
    y lo deja como administrador, todo en una transacción.

    Quien ya pertenece a una empresa (por ejemplo, porque llegó con una invitación, HU02)
    no puede crear otra: se une a la que lo invitó, con el rol asignado.
    TODO (HU02, Sprint 2): rechazar también si el correo tiene una invitación pendiente.

    Las categorías predefinidas no se copian: son filas con empresa_id NULL que RLS deja
    ver a todas las empresas (0005_categorias.sql).
    """
    if not identidad.email:
        # Falta el claim opcional "email" en el access token (Entra → Token configuration).
        raise _error(status.HTTP_400_BAD_REQUEST, "token_sin_email", "No pudimos leer tu correo desde la sesión.")

    ya_es_miembro = db.execute(
        text(
            """
            SELECT 1 FROM dbo.usuarios u
            JOIN dbo.usuarios_empresa ue ON ue.usuario_id = u.id
            WHERE u.entra_oid = :oid
            """
        ),
        {"oid": identidad.entra_oid},
    ).first()
    if ya_es_miembro:
        raise _error(status.HTTP_409_CONFLICT, "ya_tiene_empresa", "Tu cuenta ya pertenece a una empresa.")

    try:
        # MERGE: el usuario puede existir sin empresa (por ejemplo, si lo desvincularon).
        usuario_id = db.execute(
            text(
                """
                MERGE dbo.usuarios WITH (HOLDLOCK) AS t
                USING (SELECT CAST(:oid AS UNIQUEIDENTIFIER) AS entra_oid) AS s ON t.entra_oid = s.entra_oid
                WHEN MATCHED THEN UPDATE SET email = :email, nombre = COALESCE(:nombre, t.nombre)
                WHEN NOT MATCHED THEN INSERT (entra_oid, email, nombre) VALUES (s.entra_oid, :email, :nombre)
                OUTPUT inserted.id;
                """
            ),
            {"oid": identidad.entra_oid, "email": identidad.email, "nombre": identidad.nombre},
        ).scalar_one()
        empresa = db.execute(
            text(
                """
                INSERT INTO dbo.empresas (nombre, rut, giro)
                OUTPUT inserted.id, inserted.nombre, inserted.rut, inserted.giro
                VALUES (:nombre, :rut, :giro)
                """
            ),
            datos.model_dump(),
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
def ver_empresa(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """HU04 — KONTADORIA-28. Cualquier miembro activo ve los datos de su empresa (la app muestra el nombre)."""
    return {"empresa": _empresa_json(_leer_empresa(db, user.empresa_id)), "rol": user.rol}


@router.put("/actual")
def editar_empresa(
    datos: DatosEmpresa,
    user: CurrentUser = Depends(require_roles("admin")),
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
