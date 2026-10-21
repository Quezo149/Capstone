"""
KONTADORIA-44, 46 — HU03: roles y permisos.

Cada rol intenta, llamando directo a la API, las acciones de la tabla de roles
(app/core/permisos.py). Lo prohibido responde 403; lo permitido, no.
Además /auth/me entrega los permisos que la app usa para mostrar u ocultar acciones,
y el rol sale de la base aunque el token traiga un claim "rol" inventado.
"""

import pytest

from app.core.permisos import PERMISOS, permisos_de
from tests.utils import agregar_miembro, auth, crear_token, registrar_empresa, rut_valido


@pytest.fixture
def tokens(client, sql):
    e = registrar_empresa(client)
    eid = e["empresa"]["id"]
    return {
        "admin": e["token"],
        "contador": agregar_miembro(sql, eid, "contador")["token"],
        "empleado": agregar_miembro(sql, eid, "empleado")["token"],
    }


def _categoria_gasto(client, token):
    return next(c["id"] for c in client.get("/categorias", headers=auth(token)).json() if c["tipo"] == "gasto")


# (permiso de la tabla, cómo probarlo). Cada llamada usa datos válidos: si responde 403
# es por el rol, no por los datos.
ACCIONES = {
    "empresa.ver": lambda c, t: c.get("/empresas/actual", headers=auth(t)),
    "empresa.editar": lambda c, t: c.put("/empresas/actual", json={"nombre": "Editada", "rut": rut_valido()}, headers=auth(t)),
    "categorias.ver": lambda c, t: c.get("/categorias", headers=auth(t)),
    "categorias.gestionar": lambda c, t: c.post("/categorias", json={"nombre": f"Cat {t[-6:]}", "tipo": "gasto", "color": "#7a4fa0"}, headers=auth(t)),
    "movimientos.ver": lambda c, t: c.get("/movimientos", headers=auth(t)),
    "movimientos.registrar": lambda c, t: c.post(
        "/movimientos",
        json={"tipo": "gasto", "fecha": "2026-10-10", "monto": 1000, "categoria_id": _categoria_gasto(c, t), "tipo_documento": "otro"},
        headers=auth(t),
    ),
    "usuarios.ver": lambda c, t: c.get("/usuarios", headers=auth(t)),
}


@pytest.mark.parametrize("rol", ["admin", "contador", "empleado"])
@pytest.mark.parametrize("permiso", sorted(ACCIONES))
def test_cada_rol_solo_hace_lo_que_su_rol_permite(client, tokens, rol, permiso):
    r = ACCIONES[permiso](client, tokens[rol])
    if rol in PERMISOS[permiso]:
        assert r.status_code in (200, 201), r.text
    else:
        assert r.status_code == 403, r.text
        assert r.json()["detail"]["codigo"] == "rol_sin_permiso"


@pytest.mark.parametrize("rol", ["admin", "contador", "empleado"])
def test_me_entrega_los_permisos_del_rol(client, tokens, rol):
    r = client.get("/auth/me", headers=auth(tokens[rol]))
    assert r.status_code == 200
    assert r.json()["rol"] == rol
    assert r.json()["permisos"] == permisos_de(rol)


def test_rol_del_token_se_ignora(client, sql):
    """Un claim "rol": "admin" agregado al token no cambia nada: el rol sale de usuarios_empresa."""
    e = registrar_empresa(client)
    empleado = agregar_miembro(sql, e["empresa"]["id"], "empleado")
    token = crear_token(empleado["oid"], extra={"rol": "admin", "roles": ["admin"]})
    assert client.get("/auth/me", headers=auth(token)).json()["rol"] == "empleado"
    r = client.put("/empresas/actual", json={"nombre": "Hackeada", "rut": rut_valido()}, headers=auth(token))
    assert r.status_code == 403


def test_usuarios_solo_de_la_empresa(client, tokens):
    otra = registrar_empresa(client, "Otra")
    emails = {u["email"] for u in client.get("/usuarios", headers=auth(tokens["admin"])).json()}
    assert len(emails) == 3
    assert not any(otra["oid"][:8] in e for e in emails)


def test_todos_los_permisos_tienen_roles_validos():
    for permiso, roles in PERMISOS.items():
        assert roles and set(roles) <= {"admin", "contador", "empleado"}, permiso
