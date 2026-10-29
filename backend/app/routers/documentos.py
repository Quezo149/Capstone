"""
HU08 — KONTADORIA-55. Subir una foto o PDF de boleta/factura y leerla con IA.

`POST /documentos/extraer` guarda el archivo en Blob Storage (pendientes/), lo lee con Document
Intelligence y devuelve los datos para la pantalla de revisión (HU09), con la categoría sugerida
y el aviso de compra repetida según el historial (KONTADORIA-59). No escribe nada en la base:
el movimiento se crea recién cuando el usuario confirma (POST /movimientos, KONTADORIA-61).
`DELETE /documentos/pendientes/{archivo_id}` borra el archivo si el usuario cancela.
"""

import logging

from azure.core.exceptions import AzureError
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core import almacenamiento, ia
from app.core.auth import CurrentUser, require_permiso
from app.core.db import get_db
from app.core.lectura import interpretar
from app.core.sugerencias import buscar_duplicado, sugerir_categoria

router = APIRouter()
log = logging.getLogger(__name__)

# Límite del plan F0 de Document Intelligence (S0 acepta hasta 500 MB)
MAX_BYTES = 4 * 1024 * 1024


def _error(status_code: int, codigo: str, mensaje: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"codigo": codigo, "mensaje": mensaje})


@router.post("/extraer")
def extraer(
    archivo: UploadFile = File(...),
    user: CurrentUser = Depends(require_permiso("movimientos.registrar")),
    # El mismo `db` que usó get_current_user: ya tiene el SESSION_CONTEXT (RLS) del usuario
    db: Session = Depends(get_db),
):
    """
    Respuesta: {archivo_id, origen: foto|pdf, ok, motivo?, datos, confianza, motivos, cajas,
    sugerencia, duplicado} (ver app/core/lectura.interpretar y app/core/sugerencias). Con ok = false (no se leyó el total) el archivo se
    conserva igual: la pantalla ofrece registrar a mano con la foto como respaldo.
    """
    contenido = archivo.file.read(MAX_BYTES + 1)
    if len(contenido) > MAX_BYTES:
        raise _error(
            status.HTTP_413_CONTENT_TOO_LARGE, "archivo_muy_grande", "El archivo pesa más de 4 MB. Prueba con una foto más liviana."
        )
    formato = ia.formato(contenido)
    if not formato:
        raise _error(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "formato_no_soportado", "Sube una foto (JPG o PNG) o un PDF."
        )
    try:
        archivo_id = almacenamiento.subir_pendiente(user.empresa_id, contenido, formato.extension, formato.content_type)
    except AzureError:
        log.exception("No se pudo guardar el comprobante en Blob Storage")
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE, "almacenamiento_no_disponible",
            "No pudimos guardar el archivo. Inténtalo de nuevo en un momento.",
        )

    try:
        resultado = ia.analizar(contenido, formato.modelo)
    except AzureError:
        # Incluye el límite de 20 lecturas por minuto del plan F0 (429)
        log.exception("Document Intelligence no respondió")
        almacenamiento.borrar_pendiente(user.empresa_id, archivo_id)
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE, "lectura_no_disponible",
            "No pudimos leer el documento ahora. Inténtalo de nuevo o regístralo a mano.",
        )

    lectura = interpretar(resultado, formato.modelo)
    if lectura["ok"]:
        lectura["sugerencia"] = sugerir_categoria(db, lectura["datos"])
        lectura["duplicado"] = buscar_duplicado(db, lectura["datos"])
    return {"archivo_id": archivo_id, "origen": formato.origen, **lectura}


@router.delete("/pendientes/{archivo_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancelar(
    archivo_id: str,
    user: CurrentUser = Depends(require_permiso("movimientos.registrar")),
):
    """El usuario canceló la revisión: se borra el archivo subido. Repetirlo no da error."""
    if not almacenamiento.es_archivo_id(archivo_id):
        raise _error(status.HTTP_404_NOT_FOUND, "archivo_no_encontrado", "El archivo no existe.")
    almacenamiento.borrar_pendiente(user.empresa_id, archivo_id)
