-- 0003_sp_registrar_piloto_interesado.sql
-- Encapsula la inserción de registros en piloto_interesados y sanitiza entradas.

CREATE PROCEDURE dbo.sp_registrar_piloto_interesado
    @nombre NVARCHAR(100),
    @email NVARCHAR(254),
    @empresa NVARCHAR(150),
    @equipo VARCHAR(5),
    @gestion_hoy VARCHAR(10),
    @es_contador BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    -- Normalización y sanitización básica
    SET @email = LOWER(TRIM(@email));
    SET @nombre = TRIM(@nombre);
    SET @empresa = TRIM(@empresa);

    INSERT INTO dbo.piloto_interesados (
        nombre,
        email,
        empresa,
        equipo,
        gestion_hoy,
        es_contador
    )
    VALUES (
        @nombre,
        @email,
        @empresa,
        @equipo,
        @gestion_hoy,
        @es_contador
    );
END;
GO