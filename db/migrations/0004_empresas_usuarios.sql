-- 0004_empresas_usuarios.sql
-- Empresas, usuarios y su pertenencia con rol (HU17, HU04, HU01 — KONTADORIA-24).
-- Modelo de Base de Datos v2.1: la identidad (Entra External ID) vive en `usuarios`,
-- separada del rol, que es por empresa (`usuarios_empresa`). KontadorIA no guarda contraseñas.
--
-- Estas tres tablas NO llevan RLS: el backend las consulta para resolver la empresa y el rol
-- del usuario ANTES de fijar SESSION_CONTEXT. Ningún endpoint debe exponerlas sin filtrar
-- por el usuario autenticado.

CREATE TABLE dbo.empresas (
    id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_empresas_id DEFAULT NEWSEQUENTIALID(),
    nombre     NVARCHAR(150)    NOT NULL,
    rut        VARCHAR(10)      NOT NULL,  -- normalizado: sin puntos, con guion y K mayúscula (12345678-5)
    giro       NVARCHAR(150)    NULL,
    creado_en  DATETIME2        NOT NULL CONSTRAINT df_empresas_creado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_empresas PRIMARY KEY (id),
    CONSTRAINT uq_empresas_rut UNIQUE (rut),
    -- Solo el formato; el dígito verificador lo valida el backend (app/core/rut.py).
    CONSTRAINT ck_empresas_rut CHECK (rut LIKE '%[0-9]-[0-9K]' AND rut NOT LIKE '%[^0-9K-]%')
);

CREATE TABLE dbo.usuarios (
    id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_usuarios_id DEFAULT NEWSEQUENTIALID(),
    -- Object ID del usuario en Entra External ID (claim `oid`). Cambia si se migra el tenant
    -- (ver migración a cuenta profesional): por eso el resto del modelo usa `id`, no `entra_oid`.
    entra_oid  UNIQUEIDENTIFIER NOT NULL,
    email      NVARCHAR(254)    NOT NULL,
    nombre     NVARCHAR(100)    NULL,
    creado_en  DATETIME2        NOT NULL CONSTRAINT df_usuarios_creado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_usuarios PRIMARY KEY (id),
    CONSTRAINT uq_usuarios_entra_oid UNIQUE (entra_oid)
);

CREATE TABLE dbo.usuarios_empresa (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_usuarios_empresa_id DEFAULT NEWSEQUENTIALID(),
    usuario_id  UNIQUEIDENTIFIER NOT NULL,
    empresa_id  UNIQUEIDENTIFIER NOT NULL,
    rol         VARCHAR(10)      NOT NULL,
    activo      BIT              NOT NULL CONSTRAINT df_usuarios_empresa_activo DEFAULT 1,
    creado_en   DATETIME2        NOT NULL CONSTRAINT df_usuarios_empresa_creado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_usuarios_empresa PRIMARY KEY (id),
    CONSTRAINT fk_usuarios_empresa_usuario FOREIGN KEY (usuario_id) REFERENCES dbo.usuarios (id),
    CONSTRAINT fk_usuarios_empresa_empresa FOREIGN KEY (empresa_id) REFERENCES dbo.empresas (id),
    -- Una persona tiene un solo rol en cada empresa (puede estar en varias empresas).
    CONSTRAINT uq_usuarios_empresa UNIQUE (usuario_id, empresa_id),
    CONSTRAINT ck_usuarios_empresa_rol CHECK (rol IN ('admin', 'contador', 'empleado'))
);

CREATE INDEX ix_usuarios_empresa_empresa ON dbo.usuarios_empresa (empresa_id);
