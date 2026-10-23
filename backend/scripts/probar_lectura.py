"""Prueba manual de lectura con Azure AI Document Intelligence (HU08/HU09).

Manda fotos o PDFs reales a Document Intelligence y muestra lo que el backend propondría en la
pantalla de revisión: cada dato con su confianza y, si pide revisar, el motivo. Las reglas viven
en app/core/lectura.py (las mismas que usará POST /documentos/extraer); este script solo llama a
Azure y las imprime.

Uso (desde backend/):
    .venv/bin/python scripts/probar_lectura.py ~/Downloads/boleta1.jpg ~/Downloads/factura.pdf
    .venv/bin/python scripts/probar_lectura.py --texto boleta1.jpg   # además, todo el texto leído
    .venv/bin/python scripts/probar_lectura.py --json salida.json fotos/*.jpg

Lee el endpoint y la clave de local.settings.json (nunca las imprime). El plan F0 permite
20 lecturas por minuto y 500 páginas al mes, y lee solo las 2 primeras páginas de cada PDF.
Las fotos conviene enviarlas a 1600 px o más: a 1100 px la lectura empeoró.
"""

import argparse
import json
import sys
from pathlib import Path

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
from app.core.lectura import interpretar  # noqa: E402

SETTINGS = BACKEND / "local.settings.json"
ORDEN = ["proveedor", "proveedor_rut", "fecha", "monto", "tipo_documento", "descripcion"]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("archivos", nargs="+", type=Path)
    p.add_argument("--texto", action="store_true", help="muestra el texto completo que leyó")
    p.add_argument("--json", type=Path, help="guarda los resultados interpretados en este archivo")
    args = p.parse_args()

    valores = json.loads(SETTINGS.read_text())["Values"]
    cliente = DocumentIntelligenceClient(
        valores["DOCUMENT_INTELLIGENCE_ENDPOINT"], AzureKeyCredential(valores["DOCUMENT_INTELLIGENCE_KEY"])
    )
    salida = {}
    for ruta in args.archivos:
        print(f"\n=== {ruta.name} ===")
        if not ruta.is_file():
            print("  no existe")
            continue
        try:
            with ruta.open("rb") as fh:
                # es-CL: sin esto "$4.100" se lee como 4,1 (punto decimal en inglés)
                resultado = cliente.begin_analyze_document("prebuilt-receipt", body=fh, locale="es-CL").result()
        except Exception as e:  # noqa: BLE001 - prueba manual: mostrar el error y seguir con el siguiente
            print(f"  Error: {type(e).__name__}: {str(e)[:300]}")
            continue
        r = interpretar(resultado)
        salida[ruta.name] = r
        if not r["ok"]:
            print(f"  No se pudo leer: {r['motivo']}")
        else:
            for c in ORDEN:
                conf = r["confianza"].get("proveedor" if c == "proveedor_rut" else c, "")
                marca = "" if not conf or c == "proveedor_rut" else ("✓" if conf == "alta" else "revisar")
                print(f"  {c:<15}: {str(r['datos'].get(c)):<45} {marca}")
            for c, m in r["motivos"].items():
                print(f"    · {c}: {m}")
        if args.texto:
            print("  --- texto leído ---")
            for linea in (resultado.content or "").splitlines():
                print(f"  | {linea}")
    if args.json:
        args.json.write_text(json.dumps(salida, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
