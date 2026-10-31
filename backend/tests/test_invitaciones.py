"""
KONTADORIA-38, 39, 40, 43 — HU02: invitaciones.

- El admin invita con correo y rol; el token se guarda solo como hash y se devuelve una vez.
- Solo el admin invita, lista y revoca (validado en el servidor).
- El link sirve una vez, vence a las 72 h, se puede revocar y exige el mismo correo.
- El rol sale de la invitación, nunca del body; quien ya tiene empresa no acepta otra.
- Quien tiene una invitación pendiente no crea una empresa propia por error.
- RLS: una empresa no ve ni revoca invitaciones de otra; sin contexto no se ve ninguna.
"""

import hashlib
import uuid

import pytest

from tests.utils import ACEPTA, POLITICA_VERSION, agregar_miembro, auth, crear_token, registrar_empresa, rut_valido


@pytest.fixture
def empresa(client, sql):
    e = registrar_empresa(client, "Pollito Picarón")
    e["contador"] = agregar_miembro(sql, e["empresa"]["id"], "contador")
    e["empleado"] = agregar_miembro(sql, e["empresa"]["id"], "empleado")
    return e


def _invitar(client, token, email="nueva.persona@prueba.cl", rol="contador"):
    return client.post("/invitaciones", json={"email": email, "rol": rol}, headers=auth(token))


def _invitado(email="nueva.persona@prueba.cl"):
    """Una persona nueva que inicia sesión con ese correo."""
    oid = str(uuid.uuid4())
    return {"oid": oid, "token": crear_token(oid, email)}


def _aceptar(client, token_sesion, token_link, **extra):
    return client.post("/invitaciones/aceptar", json={"token": token_link, **ACEPTA, **extra}, headers=auth(token_sesion))


def _con_contexto(sql, empresa_id, sentencia, *params):
    """Ejecuta en la base con el contexto de la empresa (RLS sigue activo también para sa)."""
    cur = sql.cursor()
    cur.execute("EXEC sp_set_session_context N'empresa_id', ?", empresa_id)
    cur.execute(sentencia, *params)
    cur.execute("EXEC sp_set_session_context N'empresa_id', NULL")
    cur.close()


def test_admin_invita_y_el_token_se_guarda_solo_como_hash(client, sql, empresa):
    r = _invitar(client, empresa["token"])
    assert r.status_code == 201, r.text
    inv, token = r.json()["invitacion"], r.json()["token"]
    assert inv["estado"] == "pendiente" and inv["rol"] == "contador" and inv["email"] == "nueva.persona@prueba.cl"
    assert len(token) >= 40
    cur = sql.cursor()
    cur.execute("EXEC sp_set_session_context N'empresa_id', ?", empresa["empresa"]["id"])
    guardado = cur.execute("SELECT token_hash FROM dbo.invitaciones WHERE id = ?", inv["id"]).fetchone()[0]
    cur.execute("EXEC sp_set_session_context N'empresa_id', NULL")
    cur.close()
    assert bytes(guardado) == hashlib.sha256(token.encode()).digest()
    assert token.encode() not in bytes(guardado)
    assert inv["id"] in {i["id"] for i in client.get("/invitaciones", headers=auth(empresa["token"])).json()}


def test_solo_el_admin_invita_lista_y_revoca(client, empresa):
    inv = _invitar(client, empresa["token"]).json()["invitacion"]
    for quien in (empresa["contador"], empresa["empleado"]):
        assert _invitar(client, quien["token"], email="otra@prueba.cl").status_code == 403
        assert client.get("/invitaciones", headers=auth(quien["token"])).status_code == 403
        assert client.delete(f"/invitaciones/{inv['id']}", headers=auth(quien["token"])).status_code == 403


@pytest.mark.parametrize("email", ["", "sin-arroba", "a@b", "con espacio@prueba.cl"])
def test_correo_invalido(client, empresa, email):
    assert _invitar(client, empresa["token"], email=email).status_code == 422


def test_rol_invalido(client, empresa):
    assert _invitar(client, empresa["token"], rol="superadmin").status_code == 422


def test_no_se_invita_a_quien_ya_es_miembro(client, sql, empresa):
    email_contador = client.get("/usuarios", headers=auth(empresa["token"])).json()[1]["email"]
    r = _invitar(client, empresa["token"], email=email_contador)
    assert r.status_code == 409 and r.json()["detail"]["codigo"] == "ya_es_miembro"


def test_vista_publica_del_link(client, empresa):
    token = _invitar(client, empresa["token"], email="felipe.ignacio@prueba.cl").json()["token"]
    r = client.get(f"/invitaciones/publica/{token}")
    assert r.status_code == 200
    assert r.json() == {"empresa": "Pollito Picarón", "rol": "contador", "email": "felipe.ignacio@prueba.cl", "estado": "pendiente"}
    assert client.get(f"/invitaciones/publica/{'x' * 43}").status_code == 404


def test_aceptar_con_el_mismo_correo(client, empresa):
    token = _invitar(client, empresa["token"], rol="empleado").json()["token"]
    persona = _invitado()
    r = _aceptar(client, persona["token"], token)
    assert r.status_code == 200, r.text
    assert r.json() == {"empresa": "Pollito Picarón", "rol": "empleado"}
    me = client.get("/auth/me", headers=auth(persona["token"])).json()
    assert me["empresa_id"] == empresa["empresa"]["id"] and me["rol"] == "empleado"
    # Ya no aparece entre las abiertas
    assert client.get("/invitaciones", headers=auth(empresa["token"])).json() == []


def test_correo_sin_distinguir_mayusculas(client, empresa):
    token = _invitar(client, empresa["token"], email="Nueva.Persona@Prueba.CL").json()["token"]
    assert _aceptar(client, _invitado("nueva.persona@prueba.cl")["token"], token).status_code == 200


def test_el_rol_sale_de_la_invitacion_no_del_body(client, empresa):
    token = _invitar(client, empresa["token"], rol="empleado").json()["token"]
    persona = _invitado()
    assert _aceptar(client, persona["token"], token, rol="admin").json()["rol"] == "empleado"
    assert client.get("/auth/me", headers=auth(persona["token"])).json()["rol"] == "empleado"


def test_link_reutilizado(client, empresa):
    token = _invitar(client, empresa["token"]).json()["token"]
    assert _aceptar(client, _invitado()["token"], token).status_code == 200
    # Otra cuenta con el mismo correo (o la misma persona otra vez) no lo puede volver a usar
    r = _aceptar(client, _invitado()["token"], token)
    assert r.status_code == 410 and r.json()["detail"]["codigo"] == "invitacion_usada"


def test_link_con_otro_correo(client, empresa):
    token = _invitar(client, empresa["token"]).json()["token"]
    r = _aceptar(client, _invitado("intruso@prueba.cl")["token"], token)
    assert r.status_code == 403 and r.json()["detail"]["codigo"] == "correo_distinto"
    # Al intruso se le muestra el correo invitado enmascarado
    assert "intruso" not in r.json()["detail"]["mensaje"] and "nu•••••@prueba.cl" in r.json()["detail"]["mensaje"]
    # La invitación sigue disponible para la persona correcta
    assert _aceptar(client, _invitado()["token"], token).status_code == 200


def test_link_vencido(client, sql, empresa):
    r = _invitar(client, empresa["token"]).json()
    _con_contexto(
        sql, empresa["empresa"]["id"],
        "UPDATE dbo.invitaciones SET expira_en = DATEADD(MINUTE, -1, SYSUTCDATETIME()) WHERE id = ?", r["invitacion"]["id"],
    )
    resp = _aceptar(client, _invitado()["token"], r["token"])
    assert resp.status_code == 410 and resp.json()["detail"]["codigo"] == "invitacion_vencida"
    assert client.get(f"/invitaciones/publica/{r['token']}").json()["estado"] == "vencida"


def test_vigencia_de_72_horas(client, sql, empresa):
    inv = _invitar(client, empresa["token"]).json()["invitacion"]
    cur = sql.cursor()
    cur.execute("EXEC sp_set_session_context N'empresa_id', ?", empresa["empresa"]["id"])
    horas = cur.execute("SELECT DATEDIFF(MINUTE, creado_en, expira_en) FROM dbo.invitaciones WHERE id = ?", inv["id"]).fetchone()[0]
    cur.execute("EXEC sp_set_session_context N'empresa_id', NULL")
    cur.close()
    assert horas == 72 * 60


def test_link_revocado(client, empresa):
    r = _invitar(client, empresa["token"]).json()
    assert client.delete(f"/invitaciones/{r['invitacion']['id']}", headers=auth(empresa["token"])).status_code == 204
    resp = _aceptar(client, _invitado()["token"], r["token"])
    assert resp.status_code == 410 and resp.json()["detail"]["codigo"] == "invitacion_revocada"
    assert client.delete(f"/invitaciones/{r['invitacion']['id']}", headers=auth(empresa["token"])).status_code == 404


def test_reinvitar_anula_el_link_anterior(client, empresa):
    viejo = _invitar(client, empresa["token"]).json()["token"]
    nuevo = _invitar(client, empresa["token"], rol="empleado").json()["token"]
    assert _aceptar(client, _invitado()["token"], viejo).json()["detail"]["codigo"] == "invitacion_revocada"
    assert _aceptar(client, _invitado()["token"], nuevo).status_code == 200
    assert len(client.get("/invitaciones", headers=auth(empresa["token"])).json()) == 0


def test_quien_ya_tiene_empresa_no_acepta_otra(client, empresa):
    otra = registrar_empresa(client, "Manti")
    email_otra = f"admin.{otra['oid'][:8]}@prueba.cl"
    token = _invitar(client, empresa["token"], email=email_otra).json()["token"]
    r = _aceptar(client, otra["token"], token)
    assert r.status_code == 409 and r.json()["detail"]["codigo"] == "ya_tiene_empresa"


def test_con_invitacion_pendiente_no_crea_empresa_propia(client, empresa):
    # Correo único: la base de pruebas no se limpia entre pruebas y otras invitan a nueva.persona@
    email = f"sin.empresa.{uuid.uuid4().hex[:8]}@prueba.cl"
    r = _invitar(client, empresa["token"], email=email).json()
    persona = _invitado(email)
    datos = {"nombre": "Por error", "rut": rut_valido(), **ACEPTA}
    resp = client.post("/empresas", json=datos, headers=auth(persona["token"]))
    assert resp.status_code == 409 and resp.json()["detail"]["codigo"] == "tiene_invitacion"
    assert "Pollito Picarón" in resp.json()["detail"]["mensaje"]
    # Si el admin la revoca, ya puede crear la suya
    client.delete(f"/invitaciones/{r['invitacion']['id']}", headers=auth(empresa["token"]))
    assert client.post("/empresas", json=datos, headers=auth(persona["token"])).status_code == 201


def test_otra_empresa_no_ve_ni_revoca(client, empresa):
    inv = _invitar(client, empresa["token"]).json()["invitacion"]
    otra = registrar_empresa(client, "Manti")
    assert client.get("/invitaciones", headers=auth(otra["token"])).json() == []
    assert client.delete(f"/invitaciones/{inv['id']}", headers=auth(otra["token"])).status_code == 404


def test_sin_contexto_no_se_ve_ninguna(client, sql, empresa):
    _invitar(client, empresa["token"])
    cur = sql.cursor()
    assert cur.execute("SELECT COUNT(*) FROM dbo.invitaciones").fetchone()[0] == 0
    cur.close()


def test_sin_sesion_no_se_acepta(client, empresa):
    token = _invitar(client, empresa["token"]).json()["token"]
    assert client.post("/invitaciones/aceptar", json={"token": token, **ACEPTA}).status_code == 401


@pytest.mark.parametrize("politica", [{}, {**ACEPTA, "acepta_politica": False}, {**ACEPTA, "politica_version": "0.9"}])
def test_aceptar_exige_la_politica_vigente(client, empresa, politica):
    token = _invitar(client, empresa["token"]).json()["token"]
    persona = _invitado()
    r = client.post("/invitaciones/aceptar", json={"token": token, **politica}, headers=auth(persona["token"]))
    assert r.status_code == 422
    # El link sigue sirviendo: no se gastó
    assert _aceptar(client, persona["token"], token).status_code == 200


def test_aceptar_guarda_version_y_fecha_de_la_politica(client, sql, empresa):
    token = _invitar(client, empresa["token"]).json()["token"]
    persona = _invitado()
    assert _aceptar(client, persona["token"], token).status_code == 200
    fila = sql.cursor().execute(
        "SELECT politica_version, politica_aceptada_en FROM dbo.usuarios WHERE entra_oid = ?", persona["oid"]
    ).fetchone()
    assert fila.politica_version == POLITICA_VERSION and fila.politica_aceptada_en is not None
