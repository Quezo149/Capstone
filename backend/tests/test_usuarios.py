"""
KONTADORIA-41, 43 — HU02: gestión de usuarios de la empresa.

- El admin cambia roles y desactiva o reactiva usuarios; los demás roles reciben 403.
- Un desactivado no entra (403 usuario_desactivado) y su historial se conserva.
- No se desactiva ni se le quita el rol al último administrador activo.
- Un admin no toca usuarios de otra empresa.
"""

import pytest

from tests.utils import agregar_miembro, auth, insertar_movimiento, registrar_empresa, usuario_id_de


@pytest.fixture
def empresa(client, sql):
    e = registrar_empresa(client)
    e["usuario_id"] = usuario_id_de(sql, e["oid"])
    e["contador"] = agregar_miembro(sql, e["empresa"]["id"], "contador")
    e["empleado"] = agregar_miembro(sql, e["empresa"]["id"], "empleado")
    return e


def _rol(client, token, usuario_id, rol):
    return client.put(f"/usuarios/{usuario_id}/rol", json={"rol": rol}, headers=auth(token))


def _activo(client, token, usuario_id, activo):
    return client.put(f"/usuarios/{usuario_id}/activo", json={"activo": activo}, headers=auth(token))


def test_admin_cambia_el_rol(client, empresa):
    r = _rol(client, empresa["token"], empresa["empleado"]["usuario_id"], "contador")
    assert r.status_code == 200 and r.json()["rol"] == "contador"
    # Rige desde el siguiente request
    assert client.get("/auth/me", headers=auth(empresa["empleado"]["token"])).json()["rol"] == "contador"


def test_solo_el_admin_gestiona(client, empresa):
    for quien in (empresa["contador"], empresa["empleado"]):
        assert _rol(client, quien["token"], empresa["usuario_id"], "empleado").status_code == 403
        assert _activo(client, quien["token"], empresa["usuario_id"], False).status_code == 403


def test_contador_ve_el_equipo_y_empleado_no(client, empresa):
    assert client.get("/usuarios", headers=auth(empresa["contador"]["token"])).status_code == 200
    assert client.get("/usuarios", headers=auth(empresa["empleado"]["token"])).status_code == 403


def test_desactivado_no_entra_y_su_historial_se_conserva(client, sql, empresa):
    emp = empresa["empleado"]
    mov = insertar_movimiento(sql, empresa["empresa"]["id"], emp["usuario_id"], 7000)
    r = _activo(client, empresa["token"], emp["usuario_id"], False)
    assert r.status_code == 200 and r.json()["activo"] is False
    r = client.get("/movimientos", headers=auth(emp["token"]))
    assert r.status_code == 403 and r.json()["detail"]["codigo"] == "usuario_desactivado"
    # El admin sigue viendo lo que registró
    assert client.get(f"/movimientos/{mov}", headers=auth(empresa["token"])).status_code == 200
    # Y se puede reactivar
    assert _activo(client, empresa["token"], emp["usuario_id"], True).json()["activo"] is True
    assert client.get("/movimientos", headers=auth(emp["token"])).status_code == 200


def test_ultimo_admin_no_se_quita_el_rol_ni_se_desactiva(client, empresa):
    r = _rol(client, empresa["token"], empresa["usuario_id"], "empleado")
    assert r.status_code == 409 and r.json()["detail"]["codigo"] == "ultimo_admin"
    r = _activo(client, empresa["token"], empresa["usuario_id"], False)
    assert r.status_code == 409 and r.json()["detail"]["codigo"] == "ultimo_admin"
    assert client.get("/auth/me", headers=auth(empresa["token"])).json()["rol"] == "admin"


def test_con_otro_admin_si_se_puede(client, empresa):
    _rol(client, empresa["token"], empresa["contador"]["usuario_id"], "admin")
    assert _rol(client, empresa["token"], empresa["usuario_id"], "empleado").status_code == 200
    # Ahora el otro es el último: tampoco puede quitarse el rol
    r = _rol(client, empresa["contador"]["token"], empresa["contador"]["usuario_id"], "contador")
    assert r.status_code == 409


def test_un_admin_desactivado_no_cuenta_como_otro_admin(client, sql, empresa):
    agregar_miembro(sql, empresa["empresa"]["id"], "admin", activo=False)
    assert _rol(client, empresa["token"], empresa["usuario_id"], "empleado").status_code == 409


def test_reasignar_admin_a_admin_no_se_bloquea(client, empresa):
    assert _rol(client, empresa["token"], empresa["usuario_id"], "admin").status_code == 200


def test_usuario_de_otra_empresa(client, sql, empresa):
    otra = registrar_empresa(client, "Otra")
    ajeno = usuario_id_de(sql, otra["oid"])
    assert _rol(client, empresa["token"], ajeno, "empleado").status_code == 404
    assert _activo(client, empresa["token"], ajeno, False).status_code == 404
    assert client.get("/auth/me", headers=auth(otra["token"])).json()["rol"] == "admin"


def test_datos_invalidos(client, empresa):
    assert _rol(client, empresa["token"], empresa["empleado"]["usuario_id"], "jefe").status_code == 422
    assert _rol(client, empresa["token"], "no-es-uuid", "empleado").status_code == 404
