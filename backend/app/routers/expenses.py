from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user
from app.core.db import get_db

router = APIRouter()

_COLUMNAS = """
    id, empresa_id, usuario_id, categoria_id, tipo, fecha, monto, proveedor,
    descripcion, tipo_documento, origen, creado_en
"""


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
    rows = db.execute(text(f"SELECT {_COLUMNAS} FROM dbo.movimientos ORDER BY fecha DESC, creado_en DESC")).mappings().all()
    return list(rows)


@router.get("/{movimiento_id}")
def ver_movimiento(
    movimiento_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Un movimiento de otra empresa (o de otro empleado, si el rol es empleado) responde
    404 igual que uno inexistente: RLS lo oculta y así no se revela que existe (HU05).
    """
    row = db.execute(
        text(f"SELECT {_COLUMNAS} FROM dbo.movimientos WHERE id = TRY_CAST(:id AS UNIQUEIDENTIFIER)"),
        {"id": movimiento_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"codigo": "no_encontrado", "mensaje": "Movimiento no encontrado."})
    return row


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
