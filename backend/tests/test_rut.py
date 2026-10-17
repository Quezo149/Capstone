"""KONTADORIA-29 — validación de RUT chileno (sin base de datos)."""

import pytest

from app.core.rut import formatear_rut, normalizar_rut


@pytest.mark.parametrize(
    "entrada, esperado",
    [
        ("12.345.678-5", "12345678-5"),
        ("12345678-5", "12345678-5"),
        ("123456785", "12345678-5"),
        (" 10.000.013-k ", "10000013-K"),  # k minúscula y espacios
        ("76.086.428-5", "76086428-5"),
        ("1-9", "1-9"),
        ("11.111.111-1", "11111111-1"),
        ("6-K", "6-K"),
        ("10-8", "10-8"),
        ("4-3", "4-3"),
        ("5000006-0", "5000006-0"),  # dígito 0 (resto 11)
    ],
)
def test_rut_valido_se_normaliza(entrada, esperado):
    assert normalizar_rut(entrada) == esperado


@pytest.mark.parametrize("entrada", ["12.345.678-9", "7775777-1", "1-K"])
def test_rut_con_digito_incorrecto(entrada):
    with pytest.raises(ValueError, match="dígito verificador"):
        normalizar_rut(entrada)


@pytest.mark.parametrize("entrada", ["", "abc", "123456789012-3", "0-0", "12345678-X", "-5"])
def test_rut_con_formato_invalido(entrada):
    with pytest.raises(ValueError, match="formato"):
        normalizar_rut(entrada)


def test_formatear_rut():
    assert formatear_rut("12345678-5") == "12.345.678-5"
    assert formatear_rut("1-9") == "1-9"
