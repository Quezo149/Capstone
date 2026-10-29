"""
Llamada a Azure AI Document Intelligence (HU08). Solo envía el archivo y devuelve el AnalyzeResult;
qué significa cada dato lo decide app/core/lectura.py.

Plan F0: 20 lecturas por minuto, 500 páginas al mes, archivos de hasta 4 MB y solo las 2 primeras
páginas de cada PDF.
"""

import io
from functools import lru_cache
from typing import NamedTuple

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential

from app.core.config import get_settings
from app.core.lectura import MODELO_FOTO, MODELO_PDF


class Formato(NamedTuple):
    extension: str
    content_type: str
    origen: str  # valor de movimientos.origen
    modelo: str


# El tipo se decide por los primeros bytes del archivo, no por el nombre ni el Content-Type
# que manda el navegador.
_FIRMAS = (
    (b"\xff\xd8\xff", Formato("jpg", "image/jpeg", "foto", MODELO_FOTO)),
    (b"\x89PNG\r\n\x1a\n", Formato("png", "image/png", "foto", MODELO_FOTO)),
    (b"%PDF-", Formato("pdf", "application/pdf", "pdf", MODELO_PDF)),
)


def formato(contenido: bytes) -> Formato | None:
    """Foto (JPG/PNG) → prebuilt-receipt; PDF → prebuilt-invoice. None si no es ninguno."""
    return next((f for firma, f in _FIRMAS if contenido.startswith(firma)), None)


@lru_cache
def _cliente() -> DocumentIntelligenceClient:
    s = get_settings()
    return DocumentIntelligenceClient(s.document_intelligence_endpoint, AzureKeyCredential(s.document_intelligence_key))


def analizar(contenido: bytes, modelo: str):
    # es-CL: sin esto "$4.100" se lee como 4,1 (punto decimal en inglés)
    return _cliente().begin_analyze_document(modelo, body=io.BytesIO(contenido), locale="es-CL").result()
