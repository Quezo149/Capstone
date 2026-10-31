"""
HU09 — KONTADORIA-59. Lo que POST /documentos/extraer agrega a la lectura de la IA, usando el
historial de la empresa (decisión a del 23-10-2026: sin un modelo extra).

- Categoría sugerida: la que se usó la última vez con ese proveedor, primero por RUT (no cambia
  aunque cada documento escriba el nombre distinto) y si no por nombre; si el proveedor es nuevo,
  una pista por el tipo de comercio.
- Compra repetida: un gasto con el mismo monto y fecha, y el mismo RUT o nombre de proveedor
  (pasa al subir el voucher de la máquina POS y también la boleta de la misma compra). Si la IA
  no leyó la fecha, cualquier fecha de los últimos 60 días: la misma foto subida dos veces.
  POST /movimientos vuelve a revisar con los datos finales antes de guardar (KONTADORIA-61).

Las consultas corren con el SESSION_CONTEXT del usuario: RLS deja ver solo la propia empresa, y al
empleado solo lo suyo. Los movimientos anulados no cuentan.
"""

import re

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.lectura import normalizar
from app.core.rut import formatear_rut

# Nombres sin distinguir mayúsculas ni tildes ("Líder" = "LIDER")
_MISMO_NOMBRE = "m.proveedor COLLATE Latin1_General_CI_AI = :proveedor"

# Pistas por tipo de comercio → categoría predefinida (db/migrations/0005_categorias.sql).
# Sobre el texto normalizado: mayúsculas y sin tildes.
_PISTAS = (
    (re.compile(r"BENCINA|COMBUSTIBLE|GASOLINA|DIESEL|ESTACION DE SERVICIO|COPEC|SHELL\b|PETROBRAS"), "Transporte"),
    (re.compile(r"SUPERMERCADO|LIDER|MAYORISTA|DISTRIBUIDORA|AVICOLA|CARNICERIA|VERDULERIA|MARKET"), "Insumos"),
    (re.compile(r"ELECTRIC|\bAGUAS?\b|\bGAS\b|INTERNET|TELEFON"), "Servicios básicos"),
    (re.compile(r"FERRETERIA|TECNICO|REPUESTO"), "Mantención"),
    (re.compile(r"IMPRENTA|PUBLICIDAD"), "Marketing"),
)


def _nombre(proveedor: str | None) -> str | None:
    return " ".join(proveedor.split()) if proveedor and proveedor.strip() else None


def _ultima_categoria(db: Session, condicion: str, params: dict) -> dict | None:
    return (
        db.execute(
            text(
                f"""
                SELECT TOP 1 c.id AS categoria_id, c.nombre
                FROM dbo.movimientos m JOIN dbo.categorias c ON c.id = m.categoria_id
                WHERE m.eliminado_en IS NULL AND m.tipo = 'gasto' AND {condicion}
                ORDER BY m.fecha DESC, m.creado_en DESC
                """
            ),
            params,
        )
        .mappings()
        .first()
    )


def sugerir_categoria(db: Session, datos: dict) -> dict | None:
    """{categoria_id, nombre, motivo, fuente: historial | pista} o None si no hay pista."""
    rut, proveedor = datos.get("proveedor_rut"), _nombre(datos.get("proveedor"))

    if rut and (fila := _ultima_categoria(db, "m.proveedor_rut = :rut", {"rut": rut})):
        quien = f"del RUT {formatear_rut(rut)}"
    elif proveedor and (fila := _ultima_categoria(db, _MISMO_NOMBRE, {"proveedor": proveedor})):
        quien = f"de {proveedor}"
    else:
        fila = None
    if fila:
        return {
            "categoria_id": str(fila["categoria_id"]),
            "nombre": fila["nombre"],
            "motivo": f"La última vez que registraste algo {quien} usaste {fila['nombre']}.",
            "fuente": "historial",
        }

    texto = normalizar(f"{proveedor or ''} {datos.get('descripcion') or ''}")
    for patron, categoria in _PISTAS:
        if patron.search(texto):
            categoria_id = db.execute(
                # Una predefinida que la empresa ocultó no se sugiere (0011_categorias_ocultas.sql)
                text(
                    "SELECT c.id FROM dbo.categorias c WHERE c.empresa_id IS NULL AND c.tipo = 'gasto' AND c.nombre = :nombre"
                    " AND NOT EXISTS (SELECT 1 FROM dbo.categorias_ocultas o WHERE o.categoria_id = c.id)"
                ),
                {"nombre": categoria},
            ).scalar()
            if categoria_id:
                return {
                    "categoria_id": str(categoria_id),
                    "nombre": categoria,
                    "motivo": "Por el tipo de comercio que aparece en el documento.",
                    "fuente": "pista",
                }
    return None


def buscar_duplicado(db: Session, datos: dict) -> dict | None:
    """El gasto vigente más reciente de la misma compra, o None."""
    monto, fecha = datos.get("monto"), datos.get("fecha")
    rut, proveedor = datos.get("proveedor_rut"), _nombre(datos.get("proveedor"))
    mismo = []
    if rut:
        mismo.append("m.proveedor_rut = :rut")
    if proveedor:
        mismo.append(_MISMO_NOMBRE)
    if not (monto and mismo):
        return None
    # Sin fecha leída (foto con la fecha borrosa) el formulario propone la de hoy y no se sabría
    # la real: se compara contra los últimos 60 días
    cuando = "m.fecha = :fecha" if fecha else "m.fecha >= DATEADD(day, -60, CAST(SYSDATETIME() AS DATE))"
    fila = (
        db.execute(
            text(
                f"""
                SELECT TOP 1 m.id, m.fecha, m.monto, m.proveedor, m.origen,
                       COALESCE(u.nombre, u.email) AS usuario_nombre
                FROM dbo.movimientos m JOIN dbo.usuarios u ON u.id = m.usuario_id
                WHERE m.eliminado_en IS NULL AND m.tipo = 'gasto' AND m.monto = :monto AND {cuando}
                  AND ({' OR '.join(mismo)})
                ORDER BY m.creado_en DESC
                """
            ),
            {"monto": monto, "fecha": fecha, "rut": rut, "proveedor": proveedor},
        )
        .mappings()
        .first()
    )
    return {**fila, "id": str(fila["id"]), "fecha": fila["fecha"].isoformat()} if fila else None
