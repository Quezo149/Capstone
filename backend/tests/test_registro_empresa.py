"""
KONTADORIA-25 / KONTADORIA-27 — HU17: registro de la empresa después del primer inicio de sesión.
"""

import uuid

from tests.utils import agregar_miembro, auth, crear_token, registrar_empresa, rut_valido


def test_usuario_nuevo_sin_empresa_recibe_sin_empresa(client):
    r = client.get("/auth/me", headers=auth(crear_token()))
    assert r.status_code == 403
    assert r.json()["detail"]["codigo"] == "sin_empresa"


def test_registro_deja_al_usuario_como_admin(client, sql):
    oid = str(uuid.uuid4())
    token = crear_token(oid, "Duena@Prueba.cl")
    r = client.post("/empresas", json={"nombre": "  Pollito Picarón ", "rut": "76.086.428-5", "giro": ""}, headers=auth(token))
    assert r.status_code == 201, r.text
    assert r.json() == {
        "empresa": {"id": r.json()["empresa"]["id"], "nombre": "Pollito Picarón", "rut": "76.086.428-5", "giro": None},
        "rol": "admin",
    }
    fila = sql.cursor().execute(
        "SELECT u.email, ue.rol, ue.activo FROM dbo.usuarios u JOIN dbo.usuarios_empresa ue ON ue.usuario_id = u.id WHERE u.entra_oid = ?",
        oid,
    ).fetchone()
    assert (fila.email, fila.rol, fila.activo) == ("duena@prueba.cl", "admin", True)

    me = client.get("/auth/me", headers=auth(token)).json()
    assert me["rol"] == "admin" and me["empresa_nombre"] == "Pollito Picarón"


def test_empresa_nueva_parte_con_categorias_predefinidas(client):
    admin = registrar_empresa(client)
    categorias = client.get("/categorias", headers=auth(admin["token"])).json()
    assert len(categorias) == 11
    assert all(c["predefinida"] for c in categorias)
    assert {"Ventas", "Insumos", "Arriendo"} <= {c["nombre"] for c in categorias}


def test_no_puede_registrar_una_segunda_empresa(client):
    admin = registrar_empresa(client)
    r = client.post("/empresas", json={"nombre": "Otra", "rut": rut_valido()}, headers=auth(admin["token"]))
    assert r.status_code == 409
    assert r.json()["detail"]["codigo"] == "ya_tiene_empresa"


def test_usuario_invitado_no_crea_empresa(client, sql):
    """Quien ya es miembro de una empresa (llegó con invitación) no puede crear otra."""
    admin = registrar_empresa(client)
    empleado = agregar_miembro(sql, admin["empresa"]["id"], "empleado")
    r = client.post("/empresas", json={"nombre": "Mi propia empresa", "rut": rut_valido()}, headers=auth(empleado["token"]))
    assert r.status_code == 409
    assert r.json()["detail"]["codigo"] == "ya_tiene_empresa"


def test_rut_ya_registrado(client):
    rut = rut_valido()
    t1, t2 = crear_token(), crear_token()
    assert client.post("/empresas", json={"nombre": "A", "rut": rut}, headers=auth(t1)).status_code == 201
    r = client.post("/empresas", json={"nombre": "B", "rut": rut.replace("-", "")}, headers=auth(t2))
    assert r.status_code == 409
    assert r.json()["detail"]["codigo"] == "rut_registrado"
    # El que falló no quedó con empresa a medias
    assert client.get("/auth/me", headers=auth(t2)).json()["detail"]["codigo"] == "sin_empresa"


def test_rut_invalido_responde_422(client):
    r = client.post("/empresas", json={"nombre": "A", "rut": "12.345.678-9"}, headers=auth(crear_token()))
    assert r.status_code == 422
    assert "dígito verificador" in r.text


def test_nombre_obligatorio(client):
    r = client.post("/empresas", json={"nombre": "   ", "rut": rut_valido()}, headers=auth(crear_token()))
    assert r.status_code == 422


def test_registro_exige_token(client):
    assert client.post("/empresas", json={"nombre": "A", "rut": rut_valido()}).status_code == 401


def test_token_sin_email_no_puede_registrar(client):
    r = client.post("/empresas", json={"nombre": "A", "rut": rut_valido()}, headers=auth(crear_token(email=None)))
    assert r.status_code == 400
    assert r.json()["detail"]["codigo"] == "token_sin_email"


def test_usuario_desactivado_no_accede(client, sql):
    """HU01: un usuario desactivado no puede acceder aunque su token sea válido."""
    admin = registrar_empresa(client)
    inactivo = agregar_miembro(sql, admin["empresa"]["id"], "empleado", activo=False)
    r = client.get("/auth/me", headers=auth(inactivo["token"]))
    assert r.status_code == 403
    assert r.json()["detail"]["codigo"] == "usuario_desactivado"
    assert client.get("/movimientos", headers=auth(inactivo["token"])).status_code == 403
