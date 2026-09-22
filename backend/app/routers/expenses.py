from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user
from app.core.db import get_db

router = APIRouter()


@router.get("")
def listar_movimientos(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    No filtra manualmente por empresa_id/usuario_id en el WHERE — esa
    responsabilidad es de las políticas de RLS de Azure SQL, ya activadas
    sobre este `db` por get_current_user() vía SESSION_CONTEXT. Ver
    06 Modelo de Datos.md y 07 Autenticación y Multi-tenancy.md.
    """
    rows = db.execute(text("SELECT * FROM movimientos ORDER BY fecha DESC")).mappings().all()
    return list(rows)


@router.post("")
def crear_movimiento(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    TODO: recibir el movimiento (body/upload), asociarlo a user.empresa_id
    y user.usuario_id, e invocar Document Intelligence si viene un archivo
    (foto/PDF) en vez de carga manual — ver 05 Flujos de Carga.md.
    """
    raise NotImplementedError
