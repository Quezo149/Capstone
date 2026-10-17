"""KONTADORIA-28 / KONTADORIA-30 — HU04: ver y editar la empresa actual (solo admin edita)."""

from tests.utils import agregar_miembro, auth, registrar_empresa, rut_valido


def test_admin_ve_su_empresa(client):
    admin = registrar_empresa(client, "Manti")
    r = client.get("/empresas/actual", headers=auth(admin["token"]))
    assert r.status_code == 200
    assert r.json()["empresa"]["nombre"] == "Manti"
    assert r.json()["rol"] == "admin"


def test_admin_edita_su_empresa(client):
    admin = registrar_empresa(client)
    r = client.put(
        "/empresas/actual",
        json={"nombre": "Manti Construcción", "rut": "11.111.111-1", "giro": "Mantención y construcción"},
        headers=auth(admin["token"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["empresa"] == {
        "id": admin["empresa"]["id"], "nombre": "Manti Construcción", "rut": "11.111.111-1", "giro": "Mantención y construcción",
    }


def test_editar_con_rut_invalido_responde_422(client):
    admin = registrar_empresa(client)
    r = client.put("/empresas/actual", json={"nombre": "X", "rut": "1-K"}, headers=auth(admin["token"]))
    assert r.status_code == 422


def test_editar_con_rut_de_otra_empresa_responde_409(client):
    a, b = registrar_empresa(client), registrar_empresa(client)
    r = client.put("/empresas/actual", json={"nombre": "A", "rut": b["empresa"]["rut"]}, headers=auth(a["token"]))
    assert r.status_code == 409


def test_empleado_y_contador_ven_pero_no_editan(client, sql):
    admin = registrar_empresa(client, "Solo Lectura")
    for rol in ("empleado", "contador"):
        miembro = agregar_miembro(sql, admin["empresa"]["id"], rol)
        assert client.get("/empresas/actual", headers=auth(miembro["token"])).json()["empresa"]["nombre"] == "Solo Lectura"
        r = client.put("/empresas/actual", json={"nombre": "Hackeada", "rut": rut_valido()}, headers=auth(miembro["token"]))
        assert r.status_code == 403
        assert r.json()["detail"]["codigo"] == "rol_sin_permiso"
    assert client.get("/empresas/actual", headers=auth(admin["token"])).json()["empresa"]["nombre"] == "Solo Lectura"


def test_cada_admin_edita_solo_su_empresa(client):
    """No hay id en la URL: la empresa sale del token. A no puede tocar a B."""
    a, b = registrar_empresa(client, "Empresa A"), registrar_empresa(client, "Empresa B")
    client.put("/empresas/actual", json={"nombre": "A editada", "rut": rut_valido()}, headers=auth(a["token"]))
    assert client.get("/empresas/actual", headers=auth(b["token"])).json()["empresa"]["nombre"] == "Empresa B"
