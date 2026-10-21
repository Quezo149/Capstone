-- 0005_categorias.sql
-- Categorías de ingreso y gasto, y carga de las predefinidas (HU17 — KONTADORIA-35).
-- empresa_id NULL = categoría predefinida, visible para todas las empresas: así una empresa
-- nueva "parte con las categorías predefinidas" sin copiar filas al registrarse.
-- Con empresa_id = categoría propia de esa empresa (HU14, solo admin — decisión D2).

CREATE TABLE dbo.categorias (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_categorias_id DEFAULT NEWSEQUENTIALID(),
    empresa_id  UNIQUEIDENTIFIER NULL,
    nombre      NVARCHAR(50)     NOT NULL,
    tipo        VARCHAR(7)       NOT NULL,
    color       CHAR(7)          NOT NULL,  -- hexadecimal, ej. #17804f (lo usa el dashboard)
    creado_en   DATETIME2        NOT NULL CONSTRAINT df_categorias_creado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_categorias PRIMARY KEY (id),
    CONSTRAINT fk_categorias_empresa FOREIGN KEY (empresa_id) REFERENCES dbo.empresas (id),
    -- En SQL Server dos NULL cuentan como iguales en un UNIQUE: tampoco se repiten las predefinidas.
    CONSTRAINT uq_categorias_nombre UNIQUE (empresa_id, tipo, nombre),
    CONSTRAINT ck_categorias_tipo CHECK (tipo IN ('ingreso', 'gasto')),
    CONSTRAINT ck_categorias_color CHECK (color LIKE '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]')
);

-- Las mismas categorías y colores que usa la app hoy (frontend/src/data/categorias.js).
INSERT INTO dbo.categorias (empresa_id, nombre, tipo, color) VALUES
    (NULL, N'Ventas',               'ingreso', '#17804f'),
    (NULL, N'Otros ingresos',       'ingreso', '#5aa37f'),
    (NULL, N'Insumos',              'gasto',   '#0f6e55'),
    (NULL, N'Arriendo',             'gasto',   '#2f5d8a'),
    (NULL, N'Remuneraciones',       'gasto',   '#7a4fa0'),
    (NULL, N'Servicios básicos',    'gasto',   '#c48a12'),
    (NULL, N'Transporte',           'gasto',   '#b8382a'),
    (NULL, N'Mantención',           'gasto',   '#8a6a4f'),
    (NULL, N'Marketing',            'gasto',   '#c2477d'),
    (NULL, N'Impuestos y patentes', 'gasto',   '#4d625b'),
    (NULL, N'Otros gastos',         'gasto',   '#7d8d87');
