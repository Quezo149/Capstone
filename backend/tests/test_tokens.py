"""
KONTADORIA-19 / KONTADORIA-23 — HU01: el backend rechaza (401) cualquier solicitud sin
token o con un token inválido: firma que no es de Entra, emisor o audiencia distintos,
token vencido. Todas contra GET /auth/me.
"""

import base64
import json

from jose import jwt

from tests.utils import CLIENT_ID, _OTRA_PRIVADA, auth, crear_token, registrar_empresa


def _codigo(r):
    return r.json()["detail"]["codigo"]


def test_sin_token_responde_401(client):
    r = client.get("/auth/me")
    assert r.status_code == 401
    assert _codigo(r) == "sin_token"
    assert r.headers["www-authenticate"] == "Bearer"


def test_token_que_no_es_jwt_responde_401(client):
    r = client.get("/auth/me", headers=auth("esto-no-es-un-token"))
    assert r.status_code == 401
    assert _codigo(r) == "token_invalido"


def test_token_valido_de_usuario_registrado_responde_200(client):
    admin = registrar_empresa(client, "Panadería Token")
    r = client.get("/auth/me", headers=auth(admin["token"]))
    assert r.status_code == 200, r.text
    assert r.json()["rol"] == "admin"
    assert r.json()["empresa_nombre"] == "Panadería Token"


def test_token_alterado_responde_401(client):
    """Se cambia el oid del payload sin volver a firmar: la firma ya no coincide."""
    admin = registrar_empresa(client)
    header, payload, firma = admin["token"].split(".")
    datos = json.loads(base64.urlsafe_b64decode(payload + "=="))
    datos["oid"] = "33333333-3333-3333-3333-333333333333"
    payload_falso = base64.urlsafe_b64encode(json.dumps(datos).encode()).decode().rstrip("=")
    r = client.get("/auth/me", headers=auth(f"{header}.{payload_falso}.{firma}"))
    assert r.status_code == 401


def test_token_firmado_con_otra_clave_responde_401(client):
    """Mismo kid que Entra, pero firmado por alguien que no tiene la clave privada."""
    r = client.get("/auth/me", headers=auth(crear_token(clave=_OTRA_PRIVADA)))
    assert r.status_code == 401


def test_token_con_kid_desconocido_responde_401(client):
    r = client.get("/auth/me", headers=auth(crear_token(kid="kid-que-no-existe")))
    assert r.status_code == 401


def test_token_vencido_responde_401(client):
    r = client.get("/auth/me", headers=auth(crear_token(expira_en=-60)))
    assert r.status_code == 401


def test_token_sin_vencimiento_responde_401(client):
    from tests.utils import _PRIVADA, _pem, ISSUER_TOKEN, KID

    sin_exp = jwt.encode(
        {"oid": "44444444-4444-4444-4444-444444444444", "aud": CLIENT_ID, "iss": ISSUER_TOKEN, "scp": "access_as_user"},
        _pem(_PRIVADA), algorithm="RS256", headers={"kid": KID},
    )
    assert client.get("/auth/me", headers=auth(sin_exp)).status_code == 401


def test_token_de_otra_audiencia_responde_401(client):
    r = client.get("/auth/me", headers=auth(crear_token(aud="99999999-9999-9999-9999-999999999999")))
    assert r.status_code == 401


def test_token_de_otro_emisor_responde_401(client):
    r = client.get("/auth/me", headers=auth(crear_token(iss="https://login.microsoftonline.com/otro-tenant/v2.0")))
    assert r.status_code == 401


def test_id_token_sin_scope_responde_401(client):
    """Un ID token tiene la misma audiencia pero no trae scp: no sirve para llamar a la API."""
    r = client.get("/auth/me", headers=auth(crear_token(scp=None)))
    assert r.status_code == 401


def test_token_alg_none_responde_401(client):
    sin_firma = (
        base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT", "kid": "clave-prueba"}).encode()).decode().rstrip("=")
        + "."
        + base64.urlsafe_b64encode(json.dumps({"oid": "x", "aud": CLIENT_ID}).encode()).decode().rstrip("=")
        + "."
    )
    assert client.get("/auth/me", headers=auth(sin_firma)).status_code == 401


def test_token_hs256_con_clave_publica_responde_401(client):
    """Ataque clásico: firmar con HMAC usando la clave pública como secreto."""
    falso = jwt.encode({"oid": "x", "aud": CLIENT_ID}, "secreto", algorithm="HS256", headers={"kid": "clave-prueba"})
    assert client.get("/auth/me", headers=auth(falso)).status_code == 401


def test_audiencia_con_prefijo_api_es_valida(client):
    """Entra puede emitir la audiencia como api://<client-id>; también es nuestra API."""
    r = client.get("/auth/me", headers=auth(crear_token(aud=f"api://{CLIENT_ID}")))
    assert r.status_code == 403  # token válido; la persona aún no tiene empresa
    assert r.json()["detail"]["codigo"] == "sin_empresa"


def test_jwks_se_descarga_una_vez_y_queda_en_cache(client, entra_falso):
    for _ in range(3):
        client.get("/auth/me", headers=auth(crear_token()))
    assert len(entra_falso) == 2  # metadatos + claves, una sola vez
