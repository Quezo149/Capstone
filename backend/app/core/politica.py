import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session


def _leer_politica() -> dict:
    """
    Versión vigente de la política de privacidad: politica.json en la raíz del repo, el mismo
    archivo que leen la landing y la app (frontend). Para publicar una versión nueva solo se
    cambia ese archivo. En Azure solo se sube backend/, así que el deploy copia el archivo a
    backend/politica.json (deploy-backend.yml); en local se lee directo de la raíz.
    """
    backend = Path(__file__).resolve().parents[2]
    for ruta in (backend / "politica.json", backend.parent / "politica.json"):
        if ruta.exists():
            return json.loads(ruta.read_text(encoding="utf-8"))
    raise RuntimeError("Falta politica.json (raíz del repo o backend/)")


POLITICA_VERSION: str = _leer_politica()["version"]


class ConPolitica(BaseModel):
    """
    Casilla obligatoria, sin marcar por defecto, al registrar la empresa, aceptar una invitación
    o, para cuentas que ya existían, al volver a entrar. Sin aceptar (o con otra versión) es un 422.
    """

    acepta_politica: Literal[True]
    politica_version: Literal[POLITICA_VERSION]  # type: ignore[valid-type]


def registrar_aceptacion(db: Session, usuario_id: str) -> None:
    """Guarda versión y fecha (hora del servidor). No hace commit: va en la transacción de quien llama."""
    db.execute(
        text("UPDATE dbo.usuarios SET politica_version = :v, politica_aceptada_en = SYSUTCDATETIME() WHERE id = :id"),
        {"v": POLITICA_VERSION, "id": usuario_id},
    )
