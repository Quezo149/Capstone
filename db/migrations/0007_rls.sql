-- 0007_rls.sql
-- Row-Level Security: aislamiento entre empresas y, para el rol empleado, entre usuarios
-- (HU05 — KONTADORIA-31). Ver "Seguridad en el Sistema" y 07 Autenticación y Multi-tenancy.
--
-- El backend fija SESSION_CONTEXT (empresa_id, usuario_id, rol) al inicio de cada request,
-- después de validar el token y leer el rol desde usuarios_empresa (app/core/auth.py).
-- Sin contexto, las tablas protegidas no devuelven filas: el error es "no ver nada", nunca
-- "ver todo". RLS aplica también a kadmin/dbo; solo puede saltárselo quien desactive la política.
--
-- Va en un solo lote, sin GO (run_migrations.py no entiende GO): CREATE FUNCTION y
-- CREATE SECURITY POLICY deben ser la primera sentencia de su lote, por eso van dentro de EXEC.

EXEC (N'CREATE SCHEMA seguridad');

-- 1) Movimientos: misma empresa y, si el rol es empleado, además debe ser el dueño de la fila.
--    admin y contador ven todos los movimientos de su empresa.
EXEC (N'
CREATE FUNCTION seguridad.fn_rls_movimientos (@empresa_id UNIQUEIDENTIFIER, @usuario_id UNIQUEIDENTIFIER)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
    WHERE @empresa_id = CAST(SESSION_CONTEXT(N''empresa_id'') AS UNIQUEIDENTIFIER)
      AND (
            CAST(SESSION_CONTEXT(N''rol'') AS VARCHAR(10)) IN (''admin'', ''contador'')
         OR (CAST(SESSION_CONTEXT(N''rol'') AS VARCHAR(10)) = ''empleado''
             AND @usuario_id = CAST(SESSION_CONTEXT(N''usuario_id'') AS UNIQUEIDENTIFIER))
      )
');

-- 2) Datos de la empresa sin dueño individual (categorías propias; más adelante presupuestos,
--    invitaciones, importaciones): solo la empresa del contexto.
EXEC (N'
CREATE FUNCTION seguridad.fn_rls_empresa (@empresa_id UNIQUEIDENTIFIER)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
    WHERE @empresa_id = CAST(SESSION_CONTEXT(N''empresa_id'') AS UNIQUEIDENTIFIER)
');

-- 3) Lectura de categorías: las propias de la empresa más las predefinidas (empresa_id NULL).
EXEC (N'
CREATE FUNCTION seguridad.fn_rls_categorias_lectura (@empresa_id UNIQUEIDENTIFIER)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
    WHERE @empresa_id IS NULL
       OR @empresa_id = CAST(SESSION_CONTEXT(N''empresa_id'') AS UNIQUEIDENTIFIER)
');

-- FILTER oculta las filas ajenas en SELECT, UPDATE y DELETE.
-- BLOCK AFTER INSERT/UPDATE impide escribir una fila que quedaría fuera del contexto
-- (por ejemplo, insertar un movimiento a nombre de otra empresa o moverlo a otra).
EXEC (N'
CREATE SECURITY POLICY seguridad.politica_movimientos
    ADD FILTER PREDICATE seguridad.fn_rls_movimientos(empresa_id, usuario_id) ON dbo.movimientos,
    ADD BLOCK PREDICATE seguridad.fn_rls_movimientos(empresa_id, usuario_id) ON dbo.movimientos AFTER INSERT,
    ADD BLOCK PREDICATE seguridad.fn_rls_movimientos(empresa_id, usuario_id) ON dbo.movimientos AFTER UPDATE
    WITH (STATE = ON)
');

-- Las predefinidas se leen, pero nadie las crea ni modifica desde la app: el BLOCK usa el
-- predicado estricto (empresa_id NULL no coincide con ningún contexto).
EXEC (N'
CREATE SECURITY POLICY seguridad.politica_categorias
    ADD FILTER PREDICATE seguridad.fn_rls_categorias_lectura(empresa_id) ON dbo.categorias,
    ADD BLOCK PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.categorias AFTER INSERT,
    ADD BLOCK PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.categorias AFTER UPDATE,
    ADD BLOCK PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.categorias BEFORE UPDATE,
    ADD BLOCK PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.categorias BEFORE DELETE
    WITH (STATE = ON)
');
