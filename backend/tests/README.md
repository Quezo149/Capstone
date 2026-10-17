# Pruebas del backend

Pruebas automáticas de las historias del Sprint 1 (HU01, HU04, HU05 y HU17). Corren contra
SQL Server en Docker, en una base `kontadoria_test` que se borra y se vuelve a crear con todas
las migraciones de `db/migrations` cada vez. **Nunca apuntan a Azure.**

Los tokens de Entra se firman con una clave RSA generada en la misma prueba, y se reemplaza la
descarga del JWKS de Entra por esa clave. Así se prueba la validación real del backend (firma,
emisor, audiencia, vencimiento) sin depender del tenant ni de usuarios reales.

## Cómo correrlas

Desde la raíz del repo, con Docker andando y `.env` creado (ver `.env.example`):

```bash
docker compose up -d sqlserver
cd backend
python -m venv .venv            # solo la primera vez
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -v
```

En Windows el ejecutable está en `.venv\Scripts\python`. Necesitan el ODBC Driver 18 for SQL Server.
En GitHub corren solas en cada PR y antes de cada deploy (`.github/workflows/test-backend.yml`).

## Qué cubre cada archivo

| Archivo | Jira | Qué verifica |
|---|---|---|
| `test_tokens.py` | KONTADORIA-19, 23 (HU01) | 401 sin token, con token alterado, firmado con otra clave, vencido, sin vencimiento, de otra audiencia, de otro emisor, ID token en vez de access token, `alg: none` y HS256 con la clave pública. Token válido → 200. El JWKS se descarga una vez y queda en caché. |
| `test_registro_empresa.py` | KONTADORIA-25, 27 (HU17, HU01) | El registro deja al usuario como admin; la empresa nueva ve las 11 categorías predefinidas; no se puede crear una segunda empresa; un usuario invitado (ya miembro) no crea empresa; RUT repetido → 409 sin dejar datos a medias; RUT inválido → 422; usuario desactivado → 403. |
| `test_empresa.py` | KONTADORIA-28, 30 (HU04) | El admin ve y edita su empresa; empleado y contador ven pero no editan (403); un admin no puede tocar otra empresa. |
| `test_rut.py` | KONTADORIA-29 (HU04) | Formatos aceptados (con puntos, sin guion, k minúscula), dígito verificador 0 y K, y rechazos. |
| `test_piloto.py` | — (regresión) | El formulario piloto de la landing sigue registrando con consentimiento, y un correo repetido responde igual. |
| `test_aislamiento.py` | KONTADORIA-31, 32, 33 (HU05) | Empresa A no ve movimientos ni categorías de B (lista y por id → 404); aplica a todos los roles; el empleado solo ve lo suyo; admin y contador ven todo lo de su empresa. Directo en la base: sin contexto no se ve nada; no se puede insertar, mover, editar ni borrar en otra empresa; un empleado no registra a nombre de otro; las categorías predefinidas no se modifican. Pool: una conexión reutilizada llega sin el contexto anterior y el contexto sobrevive a un commit dentro del request. |

## Evidencia para la defensa (KONTADORIA-34)

`python -m pytest -v tests/test_aislamiento.py` deja la lista de casos con PASSED. Para mostrar
que las pruebas sí detectan una fuga, se puede cambiar `STATE = ON` por `STATE = OFF` en
`db/migrations/0007_rls.sql` (solo en local, sin commitear): las 15 pruebas de aislamiento fallan.
Con `STATE = ON` vuelven a pasar.

## Pendiente para QA (ideas para ampliar)

- Prueba manual con la app y dos cuentas reales de Entra (empresa A y B) una vez configurado el login.
- Colección de Postman con tokens reales, como respaldo de la demo (07 Autenticación y Multi-tenancy).
- Casos de HU02 (invitaciones) cuando se implementen en el Sprint 2.
