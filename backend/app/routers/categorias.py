from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user
from app.core.db import get_db

router = APIRouter()


@router.get("")
def listar_categorias(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Predefinidas (empresa_id NULL) + propias de la empresa. Sin WHERE por empresa:
    lo filtra RLS (seguridad.politica_categorias, 0007_rls.sql).
    """
    rows = db.execute(
        text(
            """
            SELECT id, nombre, tipo, color, CASE WHEN empresa_id IS NULL THEN 1 ELSE 0 END AS predefinida
            FROM dbo.categorias
            ORDER BY tipo DESC, predefinida DESC, nombre
            """
        )
    ).mappings().all()
    return [{**r, "id": str(r["id"]), "predefinida": bool(r["predefinida"])} for r in rows]
