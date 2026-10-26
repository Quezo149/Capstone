# Pruebas del backend

Pruebas automáticas de las historias del Sprint 1 (HU01, HU04, HU05 y HU17) y del Sprint 2 (HU02, HU03, HU06, HU07 y HU14). Corren contra
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
| `test_roles.py` | KONTADORIA-44, 46 (HU03) | Matriz completa: cada rol (admin, contador, empleado) intenta cada acción de la tabla de roles (`app/core/permisos.py`) llamando directo a la API; lo prohibido → 403 `rol_sin_permiso`. `/auth/me` entrega los permisos del rol. Un claim `rol: admin` inventado en el token no cambia nada. `/usuarios` solo lista a la propia empresa. |
| `test_categorias.py` | KONTADORIA-36 (HU14) | El admin crea, edita y elimina categorías propias; contador y empleado → 403; predefinidas no se modifican; nombre repetido (sin importar mayúsculas, también contra predefinidas) → 409; datos inválidos → 422; colores muy oscuros o muy claros (negro, blanco) → 422; categoría usada por movimientos, aunque estén anulados, no se elimina; las de otra empresa → 404. |
| `test_movimientos.py` | KONTADORIA-48, 50, 51, 52 (HU06, HU07) | Registro válido queda con la empresa y el usuario del token (aunque el body mande otros); monto cero, negativo, decimal o gigante → 422; categoría de otro tipo o de otra empresa → 422; contador → 403; envío repetido con el mismo `client_request_id` se guarda una vez; editar/eliminar: el empleado solo lo suyo. Eliminar **anula** (0008): la fila queda con `eliminado_por` y `eliminado_en`, no aparece en listados ni filtros, no se edita ni se anula dos veces, y `POST /movimientos/{id}/restaurar` recupera el mismo movimiento (mismo id); otro empleado o el contador no restauran. Filtros por tipo, categoría, fechas y usuario; el empleado no filtra por usuario (403) y sus filtros solo actúan sobre lo suyo. |
| `test_invitaciones.py` | KONTADORIA-38, 39, 40, 43 (HU02) | El token se guarda solo como SHA-256 y se devuelve una vez; solo el admin invita, lista y revoca; correo o rol inválidos → 422; no se invita a quien ya es miembro; vista pública del link sin sesión; aceptar con el mismo correo (sin distinguir mayúsculas) deja el rol de la invitación aunque el body mande otro; link reutilizado, vencido (72 h) o revocado → 410; con otro correo → 403 y el correo invitado se muestra enmascarado; re-invitar anula el link anterior; quien ya tiene empresa no acepta otra; con invitación pendiente no se crea empresa propia; otra empresa no ve ni revoca; sin contexto la tabla no muestra nada. |
| `test_usuarios.py` | KONTADORIA-41, 43 (HU02) | El admin cambia roles y desactiva o reactiva; contador y empleado → 403; el contador ve el equipo y el empleado no; un desactivado recibe 403 `usuario_desactivado` y su historial se conserva; el último admin activo no se quita el rol ni se desactiva (un admin desactivado no cuenta); con otro admin sí; usuarios de otra empresa → 404. |
| `test_aislamiento.py` | KONTADORIA-31, 32, 33 (HU05) | Empresa A no ve movimientos ni categorías de B (lista y por id → 404); aplica a todos los roles; el empleado solo ve lo suyo; admin y contador ven todo lo de su empresa. Directo en la base: sin contexto no se ve nada; no se puede insertar, mover, editar ni borrar en otra empresa; un empleado no registra a nombre de otro; las categorías predefinidas no se modifican. Pool: una conexión reutilizada llega sin el contexto anterior y el contexto sobrevive a un commit dentro del request. |
| `test_conexion.py` | — (regresión) | Base serverless en pausa: el login que falla con 40613 se reintenta hasta que despierta; un error permanente (contraseña mala) no se reintenta; pasado el límite, la API responde 503 `base_no_disponible` en vez de 500. `/health/db` responde. |

## Evidencia para la defensa (KONTADORIA-34)

`python -m pytest -v tests/test_aislamiento.py` deja la lista de casos con PASSED. Para mostrar
que las pruebas sí detectan una fuga, se puede cambiar `STATE = ON` por `STATE = OFF` en
`db/migrations/0007_rls.sql` (solo en local, sin commitear): las 15 pruebas de aislamiento fallan.
Con `STATE = ON` vuelven a pasar.

## Pendiente para QA (ideas para ampliar)

- Prueba manual con la app y dos cuentas reales de Entra (empresa A y B) una vez configurado el login.
- Colección de Postman con tokens reales, como respaldo de la demo (07 Autenticación y Multi-tenancy).
- Prueba manual de HU02 con dos cuentas reales (ver más abajo).
- Prueba manual con la app de los tres roles (Sprint 2): el contador no ve "Nuevo movimiento" y ve
  la lista en solo lectura; el empleado ve solo lo suyo y no tiene filtro por persona; el admin
  gestiona categorías en `#/categorias`.

## Prueba manual de invitaciones (HU02)

Necesitas dos cuentas de Entra: el admin y la persona invitada (otro correo; una dirección con
`+`, como `tucorreo+contador@gmail.com`, suele servir). Usa una ventana normal para el admin y
una de **incógnito** para el invitado: si no, Microsoft entra con la sesión que ya tiene abierta.

1. Admin → Equipo → Invitar: correo y rol. Copia el link (se muestra una sola vez).
2. Incógnito: abre el link → debe decir la empresa y el rol → "Crear mi cuenta" con ese correo.
3. Al volver, "Unirme a …" → entra a la app con el rol invitado.
4. Repite el link en otra ventana → "Este link ya se usó".
5. Invita a otro correo y ábrelo iniciando sesión con una cuenta distinta → debe rechazarlo.
6. Admin: cambia el rol del invitado y desactívalo → en la otra ventana, al recargar, queda fuera.
7. Admin: intenta quitarte el rol de administrador siendo el único → debe impedirlo.
