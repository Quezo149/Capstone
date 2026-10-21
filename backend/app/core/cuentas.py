from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import Identidad


def asegurar_usuario(db: Session, identidad: Identidad) -> str:
    """
    Crea la fila de `usuarios` de quien inició sesión, o actualiza su correo y nombre si ya
    existía (por ejemplo, si lo desvincularon de una empresa). Devuelve usuarios.id.
    Lo usan el registro de empresa (HU17) y la aceptación de una invitación (HU02).
    No hace commit: va dentro de la transacción de quien lo llama.
    """
    return db.execute(
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


def pertenece_a_una_empresa(db: Session, entra_oid: str) -> bool:
    """usuarios_empresa no tiene RLS: se consulta directo, activo o no."""
    return (
        db.execute(
            text(
                """
                SELECT 1 FROM dbo.usuarios u
                JOIN dbo.usuarios_empresa ue ON ue.usuario_id = u.id
                WHERE u.entra_oid = :oid
                """
            ),
            {"oid": entra_oid},
        ).first()
        is not None
    )
