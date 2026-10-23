"""
Interpretación de lo que lee Azure AI Document Intelligence en una boleta o factura (HU08/HU09).

Convierte la respuesta de `prebuilt-receipt` en los datos que la pantalla de revisión muestra
prellenados: proveedor, RUT del emisor, fecha, monto, tipo de documento y descripción, cada uno
con su confianza (alta | media), el motivo cuando pide revisar y dónde se leyó en la imagen.

Reglas probadas el 23-10-2026 con fotos reales (backend/scripts/probar_lectura.py):
- El tipo se detecta por el texto que exige el SII ("BOLETA ELECTRÓNICA"), no por el modelo.
- El RUT se valida con dígito verificador: descarta lo que el OCR leyó mal.
- La confianza del modelo no basta: leyó "market" con 99 % en una boleta de XS Market.

No llama a Azure ni a la base de datos: recibe el resultado ya analizado.
"""

import re
import unicodedata

from app.core.rut import normalizar_rut

# Desde aquí un dato se muestra como "Leído por IA"; bajo eso, "Revisa este dato"
UMBRAL_ALTA = 0.85


def normalizar(texto: str) -> str:
    """Mayúsculas, sin tildes y con un solo espacio: el OCR no siempre lee bien las tildes."""
    sin_tildes = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", sin_tildes.upper())


def nivel(confianza: float | None) -> str:
    return "alta" if confianza is not None and confianza >= UMBRAL_ALTA else "media"


# ---------- Tipo de documento (decisión b) ----------

# Los que no son boleta ni factura quedan "otro" para que el usuario decida
_OTROS = re.compile(r"NOTA DE (CREDITO|DEBITO)|GUIA DE DESPACHO|LIQUIDACION FACTURA")
# "BOL." / "FACT." son abreviaturas que imprimen algunas cadenas (Líder: "Bol. Electronica")
_TITULO = re.compile(r"\b(BOL(?:ETA)?|FACT(?:URA)?)\.?( NO AFECTA O EXENTA| EXENTA| DE COMPRA)? ELECTRONICA\b")
# Voucher de máquina POS (Transbank, Getnet) que la propia máquina declara válido como boleta
_VALIDO_COMO = re.compile(r"VALIDO COMO (BOLETA|FACTURA)")
_PALABRA = re.compile(r"\b(BOLETA|FACTURA)\b")
# Comprobante de venta sin la palabra boleta (Pronto Copec): probablemente boleta, a revisar
_COMPROBANTE = re.compile(r"COMPROBANTE DE VENTA")


def detectar_tipo(texto: str) -> tuple[str, str, str | None]:
    """Devuelve (tipo, confianza, evidencia). tipo: boleta | factura | otro."""
    t = normalizar(texto)
    if m := _OTROS.search(t):
        return "otro", "alta", m.group(0)
    if m := _TITULO.search(t):
        return ("boleta" if m.group(1).startswith("BOL") else "factura"), "alta", m.group(0)
    if m := _VALIDO_COMO.search(t):
        return m.group(1).lower(), "alta", m.group(0)
    # Sin el título completo (foto cortada o mal leída): basta la palabra, pero hay que revisarlo
    if m := _PALABRA.search(t):
        return m.group(1).lower(), "media", m.group(0)
    if m := _COMPROBANTE.search(t):
        return "boleta", "media", m.group(0)
    return "otro", "media", None


# ---------- Proveedor ----------

_RUT = re.compile(r"\b(\d{1,2}[.\s]?\d{3}[.\s]?\d{3}\s?-\s?[\dKk])\b")
_ETIQUETA_RUT = re.compile(r"R\.?\s?U\.?\s?T\.?\s*:?\s*$", re.IGNORECASE)


def rut_emisor(texto: str) -> str | None:
    """
    RUT del emisor, normalizado ("76218671-3"). Es la llave del historial de categorías:
    no cambia aunque cada documento escriba el nombre distinto.
    Prioridad: el que va junto a la etiqueta "RUT"; si no, el primero de empresa (≥ 50 millones),
    porque los vouchers también imprimen el RUT de la persona que paga (tarjeta Pluxee).
    """
    candidatos = []
    for m in _RUT.finditer(texto):
        try:
            rut = normalizar_rut(m.group(1))
        except ValueError:
            continue  # mal leído por el OCR o no es un RUT
        etiquetado = bool(_ETIQUETA_RUT.search(texto[max(0, m.start() - 12) : m.start()]))
        candidatos.append((etiquetado, int(rut.split("-")[0]) >= 50_000_000, rut))
    for etiquetado, _, rut in candidatos:
        if etiquetado:
            return rut
    return next((rut for _, empresa, rut in candidatos if empresa), None)


_RAZON_SOCIAL = re.compile(r"R(?:AZON)?\.?\s?SOCIAL\s*:\s*(.+(?:\n(?![A-Z][\w. ]*:).+)?)", re.IGNORECASE)
_DOMINIO = re.compile(r"\bWWW\.([A-Z0-9-]+)\.CL\b", re.IGNORECASE)


def proveedor_respaldo(texto: str) -> str | None:
    """Si el modelo no encuentra el comercio: la razón social impresa, o el dominio web."""
    if m := _RAZON_SOCIAL.search(texto):
        return " ".join(m.group(1).split())
    if m := _DOMINIO.search(texto):
        return m.group(1).capitalize()
    return None


# ---------- Respuesta completa ----------


def _caja(poligono, ancho: float, alto: float) -> list[float] | None:
    """Rectángulo [x, y, ancho, alto] en fracciones de la página: la pantalla lo dibuja en %."""
    if not poligono:
        return None
    xs, ys = poligono[0::2], poligono[1::2]
    return [round(v, 4) for v in (min(xs) / ancho, min(ys) / alto, (max(xs) - min(xs)) / ancho, (max(ys) - min(ys)) / alto)]


def _caja_campo(campo, ancho, alto):
    regiones = getattr(campo, "bounding_regions", None)
    return _caja(regiones[0].polygon, ancho, alto) if regiones else None


def _caja_linea(pagina, patron: str, ancho, alto):
    for linea in getattr(pagina, "lines", None) or []:
        if re.search(patron, normalizar(linea.content)):
            return _caja(linea.polygon, ancho, alto)
    return None


def interpretar(resultado) -> dict:
    """
    Recibe el AnalyzeResult de `prebuilt-receipt` y devuelve:
      { ok, motivo?, datos: {proveedor, proveedor_rut, fecha, monto, tipo_documento, descripcion},
        confianza: {campo: alta|media}, motivos: {campo: texto}, cajas: {campo: [x, y, w, h]} }
    ok = False cuando no hay total: la pantalla ofrece registrar a mano.
    """
    texto = resultado.content or ""
    pagina = resultado.pages[0] if resultado.pages else None
    ancho, alto = (pagina.width, pagina.height) if pagina else (1, 1)
    documento = resultado.documents[0] if resultado.documents else None
    campos = (documento.fields if documento else None) or {}

    total, fecha, comercio = campos.get("Total"), campos.get("TransactionDate"), campos.get("MerchantName")
    if not total or not total.value_currency or total.value_currency.amount is None:
        return {"ok": False, "motivo": "No alcanzamos a leer el total. Prueba con otra foto o regístralo a mano."}

    confianza, motivos, cajas = {}, {}, {}

    datos = {"monto": int(round(total.value_currency.amount))}
    confianza["monto"] = nivel(total.confidence)
    cajas["monto"] = _caja_campo(total, ancho, alto)
    if confianza["monto"] == "media":
        motivos["monto"] = "El total se ve poco claro en la foto."

    datos["fecha"] = fecha.value_date.isoformat() if fecha and fecha.value_date else None
    confianza["fecha"] = nivel(fecha.confidence) if datos["fecha"] else "media"
    cajas["fecha"] = _caja_campo(fecha, ancho, alto)
    if not datos["fecha"]:
        motivos["fecha"] = "No encontramos la fecha en el documento."

    nombre = (comercio.value_string or comercio.content) if comercio else None
    if nombre:
        datos["proveedor"] = " ".join(nombre.split())
        cajas["proveedor"] = _caja_campo(comercio, ancho, alto)
        if len(datos["proveedor"].split()) < 2:
            confianza["proveedor"] = "media"
            motivos["proveedor"] = "El nombre parece incompleto (una sola palabra, a veces es parte del logo)."
        else:
            confianza["proveedor"] = nivel(comercio.confidence)
    else:
        datos["proveedor"] = proveedor_respaldo(texto)
        confianza["proveedor"] = "media"
        if datos["proveedor"]:
            cajas["proveedor"] = _caja_linea(pagina, re.escape(normalizar(datos["proveedor"]).split()[0]), ancho, alto)
            motivos["proveedor"] = "La IA no encontró el nombre del comercio: lo tomamos de la razón social o la web impresa."
        else:
            motivos["proveedor"] = "No encontramos el nombre del comercio."

    datos["proveedor_rut"] = rut_emisor(texto)
    if datos["proveedor_rut"]:
        cuerpo = datos["proveedor_rut"].split("-")[0]
        for linea in getattr(pagina, "lines", None) or []:
            if cuerpo[-3:] in re.sub(r"\D", "", linea.content) and "-" in linea.content:
                cajas["rut"] = _caja(linea.polygon, ancho, alto)
                break

    tipo, conf_tipo, evidencia = detectar_tipo(texto)
    datos["tipo_documento"] = tipo
    confianza["tipo_documento"] = conf_tipo
    if evidencia:
        cajas["tipo_documento"] = _caja_linea(pagina, re.escape(evidencia.split()[0]), ancho, alto)
    if conf_tipo == "media":
        motivos["tipo_documento"] = (
            f'Dice "{evidencia.lower()}" y no "boleta electrónica": confirma que sea una boleta.'
            if evidencia
            else 'No dice "boleta" ni "factura": parece un comprobante de pago. Si tienes la boleta, carga esa.'
        )

    items = campos.get("Items")
    descripciones = []
    for item in (items.value_array or []) if items else []:
        desc = (item.value_object or {}).get("Description")
        if desc and desc.content:
            descripciones.append(" ".join(desc.content.split()))
    datos["descripcion"] = ", ".join(descripciones[:2])[:200]
    if datos["descripcion"]:
        confianza["descripcion"] = "media"
        motivos["descripcion"] = "Armada con los productos de la boleta: suelen venir abreviados."

    return {
        "ok": True,
        "datos": datos,
        "confianza": confianza,
        "motivos": motivos,
        "cajas": {campo: caja for campo, caja in cajas.items() if caja},
    }
