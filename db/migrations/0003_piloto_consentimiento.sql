-- 0003_piloto_consentimiento.sql
-- Consentimiento del formulario piloto (Ley 19.628 art. 4 / Ley 21.719 arts. 12 y 27)
-- y registro mediante procedimiento almacenado con un rol de mínimo privilegio.
--
-- Reemplaza a las antiguas 0003 (sp_registrar_piloto_interesado) y 0004 (app_landing_user),
-- que no llegaron a aplicarse en ningún ambiente. Va en un solo lote, sin GO:
-- run_migrations.py ejecuta el archivo completo con pyodbc, que no entiende GO.

-- 1) Evidencia del consentimiento. NULL = registro anterior a la política (no aceptó nada);
--    toda fila nueva llega con ambas columnas, porque el procedimiento las exige.
--    El CHECK impide dejar una sin la otra.
ALTER TABLE dbo.piloto_interesados ADD
    consentimiento_en DATETIME2   NULL,  -- hora del servidor (UTC), no del navegador
    politica_version  VARCHAR(10) NULL,  -- versión de la política que vio, ej. '1.0'
    CONSTRAINT ck_piloto_interesados_consentimiento
        CHECK ((consentimiento_en IS NULL AND politica_version IS NULL)
            OR (consentimiento_en IS NOT NULL AND politica_version IS NOT NULL));

-- 2) Procedimiento de registro. Dentro de EXEC porque CREATE PROCEDURE debe ser la primera
--    sentencia de su lote, y porque el procedimiento usa las columnas recién agregadas.
EXEC (N'
CREATE OR ALTER PROCEDURE dbo.sp_registrar_piloto_interesado
    @nombre           NVARCHAR(100),
    @email            NVARCHAR(254),
    @empresa          NVARCHAR(150),
    @equipo           VARCHAR(5),
    @gestion_hoy      VARCHAR(10),
    @es_contador      BIT = 0,
    @politica_version VARCHAR(10)
AS
BEGIN
    SET NOCOUNT ON;

    -- Sin versión de política no hay consentimiento que probar: no se registra.
    IF @politica_version IS NULL OR TRIM(@politica_version) = ''''
        THROW 50001, ''Falta la versión de la política de privacidad aceptada.'', 1;

    INSERT INTO dbo.piloto_interesados
        (nombre, email, empresa, equipo, gestion_hoy, es_contador, consentimiento_en, politica_version)
    VALUES
        (TRIM(@nombre), LOWER(TRIM(@email)), TRIM(@empresa), @equipo, @gestion_hoy, @es_contador,
         SYSUTCDATETIME(), TRIM(@politica_version));
END
');

-- 3) Rol de mínimo privilegio para quien registre interesados desde la landing:
--    solo puede ejecutar el procedimiento, nunca leer ni tocar la tabla directamente.
--    Un rol (y no un usuario) para que la migración no dependa de logins ni contraseñas,
--    que cambian por ambiente. Asignar el usuario es un paso manual, una vez por ambiente:
--
--      Azure (base master):          CREATE LOGIN app_landing_login WITH PASSWORD = '...';
--      Docker local (base master):   igual que Azure.
--      Luego, en sqldb-kontadoria:   CREATE USER app_landing_user FOR LOGIN app_landing_login;
--                                    ALTER ROLE rol_landing ADD MEMBER app_landing_user;
IF DATABASE_PRINCIPAL_ID('rol_landing') IS NULL
    EXEC (N'CREATE ROLE rol_landing');

GRANT EXECUTE ON OBJECT::dbo.sp_registrar_piloto_interesado TO rol_landing;
DENY SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.piloto_interesados TO rol_landing;
