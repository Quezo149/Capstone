from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, Identidad, get_current_user, get_identidad
from app.core.db import get_db
from app.core.permisos import permisos_de
from app.core.politica import ConPolitica, registrar_aceptacion

router = APIRouter()


@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Lo primero que llama la app después de iniciar sesión. Si responde 403 con
    codigo "sin_empresa" la app muestra el registro de la empresa (HU17); con
    "usuario_desactivado", el aviso de acceso desactivado (HU01); con "politica_pendiente",
    la casilla de la política de privacidad (POST /auth/politica).
    """
    empresa = db.execute(text("SELECT nombre FROM dbo.empresas WHERE id = :id"), {"id": user.empresa_id}).one()
    return {
        "usuario_id": user.usuario_id,
        "empresa_id": user.empresa_id,
        "empresa_nombre": empresa.nombre,
        "rol": user.rol,
        "email": user.email,
        # HU03 — KONTADORIA-45: la app muestra u oculta acciones con esta lista,
        # calculada en el servidor a partir del rol guardado en usuarios_empresa.
        "permisos": permisos_de(user.rol),
    }


@router.post("/politica")
def aceptar_politica(datos: ConPolitica, identidad: Identidad = Depends(get_identidad), db: Session = Depends(get_db)):
    """
    Cuentas que ya existían antes de pedir el consentimiento, o que aceptaron una versión
    anterior: get_current_user responde "politica_pendiente" hasta que pasen por aquí.
    Usa get_identidad (no get_current_user) justamente porque este es el paso que falta.
    """
    usuario_id = db.execute(
        text(
            """
            SELECT u.id FROM dbo.usuarios u
            WHERE u.entra_oid = :oid AND EXISTS (SELECT 1 FROM dbo.usuarios_empresa ue WHERE ue.usuario_id = u.id)
            """
        ),
        {"oid": identidad.entra_oid},
    ).scalar()
    if usuario_id is None:
        # Sin empresa la política se acepta al registrarla o al aceptar la invitación
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"codigo": "sin_empresa", "mensaje": "Aún no registras tu empresa."},
        )
    registrar_aceptacion(db, str(usuario_id))
    db.commit()
    return {"politica_version": datos.politica_version}
