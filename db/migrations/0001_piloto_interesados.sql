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
    -- Códigos estables, no el texto visible del formulario: la etiqueta puede
    -- cambiar en la landing sin tocar la base (ver SignupForm.jsx).
    equipo      VARCHAR(5)    NOT NULL
                CONSTRAINT ck_piloto_interesados_equipo
                CHECK (equipo IN ('1', '2-5', '6-10', '11-20', '21+')),
    gestion_hoy VARCHAR(10)   NOT NULL
                CONSTRAINT ck_piloto_interesados_gestion_hoy
                CHECK (gestion_hoy IN ('excel', 'whatsapp', 'papel', 'otro')),
    creado_en   DATETIME2     NOT NULL
                CONSTRAINT df_piloto_interesados_creado_en DEFAULT SYSUTCDATETIME()
);
