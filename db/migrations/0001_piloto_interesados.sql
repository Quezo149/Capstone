-- 0001_piloto_interesados.sql
-- Interesados en el programa piloto, registrados desde el formulario de la landing.
-- No pertenece a ninguna empresa (se llena antes de que exista una cuenta), por eso
-- no lleva empresa_id ni RLS: solo el backend la lee y la escribe.
CREATE TABLE piloto_interesados (
    id          UNIQUEIDENTIFIER NOT NULL
                CONSTRAINT pk_piloto_interesados PRIMARY KEY
                CONSTRAINT df_piloto_interesados_id DEFAULT NEWSEQUENTIALID(),
    nombre      NVARCHAR(100) NOT NULL,
    email       NVARCHAR(254) NOT NULL
                CONSTRAINT uq_piloto_interesados_email UNIQUE,
    empresa     NVARCHAR(150) NOT NULL,
    equipo      NVARCHAR(20)  NOT NULL,
    gestion_hoy NVARCHAR(50)  NOT NULL,
    creado_en   DATETIME2     NOT NULL
                CONSTRAINT df_piloto_interesados_creado_en DEFAULT SYSUTCDATETIME()
);
