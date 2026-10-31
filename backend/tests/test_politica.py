"""
Consentimiento de la política de privacidad para cuentas que ya existían (o que aceptaron una
versión anterior): get_current_user responde "politica_pendiente" hasta aceptar la vigente.
La versión vigente sale de politica.json en la raíz del repo.
"""

import pytest

from tests.utils import ACEPTA, POLITICA_VERSION, agregar_miembro, auth, crear_token, registrar_empresa, usuario_id_de


def _dejar_sin_aceptar(sql, oid, version=None):
    cur = sql.cursor()
    cur.execute("UPDATE dbo.usuarios SET politica_version = ?, politica_aceptada_en = NULL WHERE entra_oid = ?", version, oid)
    cur.close()


@pytest.mark.parametrize("version", [None, "0.9"])
def test_cuenta_sin_la_version_vigente_queda_pendiente(client, sql, version):
    admin = registrar_empresa(client)
    _dejar_sin_aceptar(sql, admin["oid"], version)
    for ruta in ("/auth/me", "/movimientos", "/categorias"):
        r = client.get(ruta, headers=auth(admin["token"]))
        assert r.status_code == 403, ruta
        assert r.json()["detail"]["codigo"] == "politica_pendiente"


def test_aceptar_la_politica_deja_entrar_y_guarda_version_y_fecha(client, sql):
    admin = registrar_empresa(client)
    _dejar_sin_aceptar(sql, admin["oid"])
    r = client.post("/auth/politica", json=ACEPTA, headers=auth(admin["token"]))
    assert r.status_code == 200, r.text
    assert client.get("/auth/me", headers=auth(admin["token"])).status_code == 200
    fila = sql.cursor().execute(
        "SELECT politica_version, politica_aceptada_en FROM dbo.usuarios WHERE id = ?", usuario_id_de(sql, admin["oid"])
    ).fetchone()
    assert fila.politica_version == POLITICA_VERSION and fila.politica_aceptada_en is not None


@pytest.mark.parametrize("cuerpo", [{}, {**ACEPTA, "acepta_politica": False}, {**ACEPTA, "politica_version": "0.9"}])
def test_aceptar_exige_casilla_y_version_vigente(client, sql, cuerpo):
    admin = registrar_empresa(client)
    _dejar_sin_aceptar(sql, admin["oid"])
    assert client.post("/auth/politica", json=cuerpo, headers=auth(admin["token"])).status_code == 422
    assert client.get("/auth/me", headers=auth(admin["token"])).json()["detail"]["codigo"] == "politica_pendiente"


def test_sin_empresa_no_acepta_por_aqui(client):
    r = client.post("/auth/politica", json=ACEPTA, headers=auth(crear_token()))
    assert r.status_code == 403 and r.json()["detail"]["codigo"] == "sin_empresa"


def test_sin_sesion_no_acepta(client):
    assert client.post("/auth/politica", json=ACEPTA).status_code == 401


def test_desactivado_ve_su_aviso_antes_que_la_politica(client, sql):
    admin = registrar_empresa(client)
    empleado = agregar_miembro(sql, admin["empresa"]["id"], "empleado", activo=False)
    _dejar_sin_aceptar(sql, empleado["oid"])
    r = client.get("/auth/me", headers=auth(empleado["token"]))
    assert r.json()["detail"]["codigo"] == "usuario_desactivado"
