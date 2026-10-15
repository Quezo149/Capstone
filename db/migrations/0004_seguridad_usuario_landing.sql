-- 0004_seguridad_usuario_landing.sql
-- Crea el usuario con menor privilegio para la recepción de solicitudes desde la landing.

-- Crear el usuario en la base de datos si no existe
IF NOT EXISTS (SELECT * FROM sys.database_principals WHERE name = 'app_landing_user')
BEGIN
    CREATE USER app_landing_user FOR LOGIN app_landing_login;
END;

-- Denegar permisos directos sobre la tabla por seguridad (previene lecturas/modificaciones no autorizadas)
DENY SELECT, INSERT, UPDATE, DELETE ON dbo.piloto_interesados TO app_landing_user;

-- Otorgar permiso ÚNICAMENTE para ejecutar el procedimiento almacenado
GRANT EXECUTE ON dbo.sp_registrar_piloto_interesado TO app_landing_user;