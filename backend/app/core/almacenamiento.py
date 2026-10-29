"""
Comprobantes en Azure Blob Storage (HU08/HU09). Contenedor privado: solo el backend accede.

Al subir, el archivo queda en `pendientes/<empresa_id>/<archivo_id>`. Al confirmar el movimiento
se mueve a su ruta definitiva (KONTADORIA-61); al cancelar se borra, y lo que nadie confirma ni
cancela lo borra la regla de ciclo de vida de Azure al día siguiente
(infra/storage/ciclo-de-vida-comprobantes.json).

La app solo conoce el `archivo_id` (<uuid>.<ext>): la empresa de la ruta sale siempre del token,
así nadie puede apuntar a un archivo de otra empresa cambiando el id.
"""

import datetime as dt
import re
import uuid
from functools import lru_cache

from azure.core.exceptions import ResourceNotFoundError
from azure.storage.blob import BlobSasPermissions, ContainerClient, ContentSettings, generate_blob_sas

from app.core.config import get_settings

PENDIENTES = "pendientes"
_ARCHIVO_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|pdf)$")


@lru_cache
def _contenedor() -> ContainerClient:
    s = get_settings()
    return ContainerClient(
        f"https://{s.storage_account_name}.blob.core.windows.net",
        s.storage_container_comprobantes,
        credential={"account_name": s.storage_account_name, "account_key": s.storage_account_key},
    )


def es_archivo_id(valor: str) -> bool:
    return bool(_ARCHIVO_ID.match(valor))


def ruta_pendiente(empresa_id: str, archivo_id: str) -> str:
    return f"{PENDIENTES}/{empresa_id}/{archivo_id}"


def ruta_definitiva(empresa_id: str, archivo_id: str, fecha: dt.date) -> str:
    """Carpeta por mes del movimiento: lo que el contador revisa al cierre de cada mes."""
    return f"{empresa_id}/{fecha:%Y}/{fecha:%m}/{archivo_id}"


def subir_pendiente(empresa_id: str, contenido: bytes, extension: str, content_type: str) -> str:
    """Guarda el archivo en pendientes/ y devuelve su archivo_id."""
    archivo_id = f"{uuid.uuid4()}.{extension}"
    _contenedor().upload_blob(
        ruta_pendiente(empresa_id, archivo_id), contenido, content_settings=ContentSettings(content_type=content_type)
    )
    return archivo_id


def borrar_pendiente(empresa_id: str, archivo_id: str) -> None:
    """Borra un archivo de pendientes/. Si ya no está (borrado antes o por la regla), no pasa nada."""
    try:
        _contenedor().delete_blob(ruta_pendiente(empresa_id, archivo_id))
    except ResourceNotFoundError:
        pass


def confirmar(empresa_id: str, archivo_id: str, fecha: dt.date) -> str:
    """
    Copia el archivo de pendientes/ a su ruta definitiva y la devuelve. El pendiente NO se borra
    aquí: se borra después de guardar el movimiento, así un error al guardar no pierde el archivo.
    ResourceNotFoundError si ya no está en pendientes/ (cancelado o borrado por la regla).
    Se descarga y se vuelve a subir: pesa a lo más 4 MB y evita la copia asíncrona de Azure.
    """
    descarga = _contenedor().download_blob(ruta_pendiente(empresa_id, archivo_id))
    destino = ruta_definitiva(empresa_id, archivo_id, fecha)
    _contenedor().upload_blob(
        destino,
        descarga.readall(),
        overwrite=True,  # un reintento del mismo envío escribe el mismo archivo en la misma ruta
        content_settings=ContentSettings(content_type=descarga.properties.content_settings.content_type),
    )
    return destino


def borrar(ruta: str) -> None:
    """Borra un archivo por su ruta completa (deshace confirmar() si no se pudo guardar el movimiento)."""
    try:
        _contenedor().delete_blob(ruta)
    except ResourceNotFoundError:
        pass


# Cuánto dura el link para ver un comprobante: lo justo para abrirlo; la app pide uno nuevo cada vez
MINUTOS_LINK = 10


def url_lectura(ruta: str, ahora: dt.datetime | None = None) -> str:
    """
    Link temporal de SOLO LECTURA a un comprobante (SAS de un solo archivo). El contenedor sigue
    privado: el link sirve solo para ese archivo y vence a los MINUTOS_LINK minutos. Se firma con
    la clave de la cuenta, sin llamar a Azure.
    """
    s = get_settings()
    ahora = ahora or dt.datetime.now(dt.timezone.utc)
    firma = generate_blob_sas(
        account_name=s.storage_account_name,
        container_name=s.storage_container_comprobantes,
        blob_name=ruta,
        account_key=s.storage_account_key,
        permission=BlobSasPermissions(read=True),
        start=ahora - dt.timedelta(minutes=5),  # el reloj del navegador o de Azure puede ir adelantado
        expiry=ahora + dt.timedelta(minutes=MINUTOS_LINK),
        content_disposition="inline",  # abrir en el navegador, no descargar
    )
    return f"https://{s.storage_account_name}.blob.core.windows.net/{s.storage_container_comprobantes}/{ruta}?{firma}"
