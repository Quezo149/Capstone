"""
Validación de RUT chileno (HU04 — KONTADORIA-29).

Se acepta como lo escriba la persona (12.345.678-5, 12345678-5, 123456785, con k minúscula)
y se guarda normalizado: sin puntos, con guion y K mayúscula → "12345678-5".
"""

import re

_SOLO_RUT = re.compile(r"^(\d{1,8})([0-9K])$")


def digito_verificador(cuerpo: int) -> str:
    """Módulo 11: multiplica los dígitos de derecha a izquierda por 2, 3, 4, 5, 6, 7, 2, 3…"""
    suma, factor = 0, 2
    while cuerpo > 0:
        suma += (cuerpo % 10) * factor
        cuerpo //= 10
        factor = 2 if factor == 7 else factor + 1
    resto = 11 - (suma % 11)
    return {11: "0", 10: "K"}.get(resto, str(resto))


def normalizar_rut(valor: str) -> str:
    """
    Devuelve el RUT normalizado o lanza ValueError con un mensaje para mostrar al usuario.
    """
    limpio = re.sub(r"[.\s-]", "", valor or "").upper()
    m = _SOLO_RUT.match(limpio)
    if not m:
        raise ValueError("El RUT no tiene un formato válido (ej.: 12.345.678-5).")
    cuerpo, dv = m.groups()
    if int(cuerpo) == 0:
        raise ValueError("El RUT no tiene un formato válido (ej.: 12.345.678-5).")
    if digito_verificador(int(cuerpo)) != dv:
        raise ValueError("El dígito verificador del RUT no es correcto.")
    return f"{int(cuerpo)}-{dv}"


def formatear_rut(normalizado: str) -> str:
    """12345678-5 → 12.345.678-5 (para mostrar)."""
    cuerpo, dv = normalizado.split("-")
    return f"{int(cuerpo):,}".replace(",", ".") + f"-{dv}"
