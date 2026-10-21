-- 0009_invitaciones.sql
-- Invitaciones de usuarios a una empresa (HU02 — KONTADORIA-38). Ver "06 Modelo de Datos" y
-- "07 Autenticación y Multi-tenancy", flujo de redención y checklist del token.
--
-- - El token (32 bytes aleatorios) nunca se guarda: solo su SHA-256. El link se muestra una vez.
-- - El estado se deriva de las fechas: usada (aceptada_en), revocada (revocada_en),
--   vencida (expira_en < ahora) o pendiente. Así no hay un campo que pueda quedar desfasado.
-- - Auditoría: quién invitó (invitado_por), a qué correo, con qué rol, cuándo, y quién aceptó.
--
-- RLS: el admin ve las de su empresa. El invitado todavía no tiene empresa, así que el backend
-- fija SESSION_CONTEXT 'invitacion_token' con el hash del token que trae el link: con eso ve
-- (y puede marcar como usada) solo esa fila. Para que quien tiene una invitación pendiente no
-- cree otra empresa por error, POST /empresas fija 'invitacion_email' con el correo verificado
-- de la sesión: ve solo las invitaciones dirigidas a sí mismo. Sin contexto no se ve nada.
--
-- Va en un solo lote, sin GO (run_migrations.py no entiende GO): CREATE FUNCTION y
-- CREATE SECURITY POLICY van dentro de EXEC.

CREATE TABLE dbo.invitaciones (
    id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_invitaciones_id DEFAULT NEWSEQUENTIALID(),
    empresa_id      UNIQUEIDENTIFIER NOT NULL,
    email_invitado  NVARCHAR(254)    NOT NULL,  -- en minúsculas
    rol             VARCHAR(10)      NOT NULL,  -- el que tendrá al aceptar; nunca viene del navegador
    token_hash      BINARY(32)       NOT NULL,  -- SHA-256 del token del link
    expira_en       DATETIME2        NOT NULL,  -- creado_en + 72 horas
    invitado_por    UNIQUEIDENTIFIER NOT NULL,  -- usuarios_empresa: quién la generó y desde qué empresa
    creado_en       DATETIME2        NOT NULL CONSTRAINT df_invitaciones_creado_en DEFAULT SYSUTCDATETIME(),
    aceptada_en     DATETIME2        NULL,
    aceptada_por    UNIQUEIDENTIFIER NULL,      -- usuarios.id de quien la usó
    revocada_en     DATETIME2        NULL,
    CONSTRAINT pk_invitaciones PRIMARY KEY (id),
    CONSTRAINT fk_invitaciones_empresa FOREIGN KEY (empresa_id) REFERENCES dbo.empresas (id),
    CONSTRAINT fk_invitaciones_invitado_por FOREIGN KEY (invitado_por) REFERENCES dbo.usuarios_empresa (id),
    CONSTRAINT fk_invitaciones_aceptada_por FOREIGN KEY (aceptada_por) REFERENCES dbo.usuarios (id),
    CONSTRAINT uq_invitaciones_token UNIQUE (token_hash),
    CONSTRAINT ck_invitaciones_rol CHECK (rol IN ('admin', 'contador', 'empleado')),
    -- Usada o revocada, nunca las dos; usada siempre dice por quién
    CONSTRAINT ck_invitaciones_estado CHECK (aceptada_en IS NULL OR revocada_en IS NULL),
    CONSTRAINT ck_invitaciones_aceptada CHECK (
        (aceptada_en IS NULL AND aceptada_por IS NULL) OR (aceptada_en IS NOT NULL AND aceptada_por IS NOT NULL)
    )
);

CREATE INDEX ix_invitaciones_empresa ON dbo.invitaciones (empresa_id, creado_en DESC);
CREATE INDEX ix_invitaciones_email ON dbo.invitaciones (email_invitado);

EXEC (N'
CREATE FUNCTION seguridad.fn_rls_invitaciones (@empresa_id UNIQUEIDENTIFIER, @token_hash BINARY(32), @email NVARCHAR(254))
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
    WHERE @empresa_id = CAST(SESSION_CONTEXT(N''empresa_id'') AS UNIQUEIDENTIFIER)
       OR @token_hash = CAST(SESSION_CONTEXT(N''invitacion_token'') AS BINARY(32))
       OR @email = CAST(SESSION_CONTEXT(N''invitacion_email'') AS NVARCHAR(254))
');

-- BLOCK AFTER INSERT: nadie crea invitaciones para otra empresa (el contexto de token no sirve
-- para insertar, porque el hash es nuevo). AFTER UPDATE: la fila sigue dentro del contexto.
EXEC (N'
CREATE SECURITY POLICY seguridad.politica_invitaciones
    ADD FILTER PREDICATE seguridad.fn_rls_invitaciones(empresa_id, token_hash, email_invitado) ON dbo.invitaciones,
    ADD BLOCK PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.invitaciones AFTER INSERT,
    ADD BLOCK PREDICATE seguridad.fn_rls_invitaciones(empresa_id, token_hash, email_invitado) ON dbo.invitaciones AFTER UPDATE
    WITH (STATE = ON)
');
