"""Regresión del formulario piloto de la landing (POST /piloto, público, sin token)."""

import uuid

from app.routers.piloto import POLITICA_VERSION


def _datos(**extra):
    return {
        "nombre": "Persona Piloto",
        "email": f"piloto.{uuid.uuid4().hex[:8]}@prueba.cl",
        "empresa": "Negocio de prueba",
        "equipo": "2-5",
        "hoy": "excel",
        "acepta_politica": True,
        "politica_version": POLITICA_VERSION,
        **extra,
    }


def test_registra_interesado_con_consentimiento(client, sql):
    datos = _datos()
    assert client.post("/piloto", json=datos).status_code == 201
    fila = sql.cursor().execute(
        "SELECT politica_version, consentimiento_en FROM dbo.piloto_interesados WHERE email = ?", datos["email"]
    ).fetchone()
    assert fila.politica_version == POLITICA_VERSION and fila.consentimiento_en is not None


def test_correo_repetido_responde_igual(client):
    datos = _datos()
    assert client.post("/piloto", json=datos).status_code == 201
    assert client.post("/piloto", json=datos).status_code == 201


def test_sin_aceptar_politica_responde_422(client):
    assert client.post("/piloto", json=_datos(acepta_politica=False)).status_code == 422
