-- 0014_importaciones_formatos.sql
-- Importación masiva en producción (HU10–HU13), con las decisiones del 09-11-2026:
--
--   * Motor híbrido: el navegador lee la planilla y arma la vista previa; el backend recibe solo
--     las filas interpretadas, las vuelve a validar y guarda todo en una transacción. El archivo
--     no llega al servidor: de él quedan el nombre, el tipo y su SHA-256 (trazabilidad).
--   * Anular una importación completa (admin y contador), con anulación suave y restaurable.
--   * "Recordar formato" de planillas propias, por empresa (importacion_formatos), y las
--     categorías de la planilla asociadas a categorías de KontadorIA (categorias_alias).
--
-- Funciona esté o no aplicada 0013 en una base: el runner aplica 0013 antes que esta.
-- Va en un solo lote, sin GO (run_migrations.py no entiende GO): las columnas nuevas y los
-- CHECK que las usan van en el mismo ALTER TABLE (como en 0008), y CREATE SECURITY POLICY
-- va dentro de EXEC.

-- ---------------------------------------------------------------------------------------------
-- Importaciones: formato, filas excluidas/omitidas, huella del archivo y anulación
-- ---------------------------------------------------------------------------------------------

-- total = importadas + con error + excluidas (duplicados o filas que el usuario quitó en la
-- revisión). Las omitidas (totales, saldos, títulos, filas ocultas) no son movimientos y no
-- entran en el total.
ALTER TABLE dbo.importaciones DROP CONSTRAINT ck_importaciones_conteos;

ALTER TABLE dbo.importaciones ADD
    -- "Plantilla KontadorIA", el nombre del formato recordado o "Planilla propia"
    formato         NVARCHAR(80)     NOT NULL CONSTRAINT df_importaciones_formato DEFAULT N'Plantilla KontadorIA',
    -- SHA-256 del archivo, calculado en el navegador: permite ver si el mismo archivo se subió dos veces
    archivo_sha256  CHAR(64)         NULL,
    filas_excluidas INT              NOT NULL CONSTRAINT df_importaciones_excluidas DEFAULT 0,
    filas_omitidas  INT              NOT NULL CONSTRAINT df_importaciones_omitidas DEFAULT 0,
    anulada_en      DATETIME2        NULL,
    anulada_por     UNIQUEIDENTIFIER NULL
        CONSTRAINT fk_importaciones_anulada_por FOREIGN KEY REFERENCES dbo.usuarios (id),
    CONSTRAINT ck_importaciones_conteos CHECK (
        filas_con_error >= 0
        AND filas_excluidas >= 0
        AND filas_omitidas >= 0
        AND filas_importadas > 0                       -- sin filas válidas no se puede confirmar
        AND total_filas = filas_importadas + filas_con_error + filas_excluidas
    ),
    CONSTRAINT ck_importaciones_sha256 CHECK (archivo_sha256 IS NULL OR archivo_sha256 NOT LIKE '%[^0-9a-f]%'),
    -- Anulada = las dos columnas con valor; vigente = las dos en NULL (como movimientos, 0008)
    CONSTRAINT ck_importaciones_anulacion CHECK (
        (anulada_en IS NULL AND anulada_por IS NULL) OR (anulada_en IS NOT NULL AND anulada_por IS NOT NULL)
    );

-- ---------------------------------------------------------------------------------------------
-- Movimientos importados: de qué fila vienen y su huella
-- ---------------------------------------------------------------------------------------------

-- huella_importacion = tipo|fecha|monto|descripción normalizada|n.º de ocurrencia (la arma el
-- motor del navegador). Re-subir el mismo archivo o un período que se solapa marca esas filas
-- como "ya importadas" en la vista previa; dos cafés iguales el mismo día siguen siendo dos.
ALTER TABLE dbo.movimientos ADD
    huella_importacion NVARCHAR(700) NULL,
    fila_origen        INT           NULL,  -- n.º de fila en la planilla, para el detalle
    -- Un movimiento importado siempre apunta a su importación, y uno manual nunca lo hace
    CONSTRAINT ck_movimientos_importacion CHECK (
        (origen = 'importacion_masiva' AND importacion_id IS NOT NULL AND huella_importacion IS NOT NULL)
        OR (origen <> 'importacion_masiva' AND importacion_id IS NULL AND huella_importacion IS NULL AND fila_origen IS NULL)
    );

-- ---------------------------------------------------------------------------------------------
-- Formatos recordados (planillas propias)
-- ---------------------------------------------------------------------------------------------

-- `huella` = encabezado normalizado de la planilla ("fecha|detalle|monto"): con ella se reconoce
-- el formato la próxima vez. `mapeo` = qué columna es qué (JSON del motor del navegador; el
-- backend no lo interpreta, solo lo guarda y lo devuelve).
CREATE TABLE dbo.importacion_formatos (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_importacion_formatos_id DEFAULT NEWSEQUENTIALID(),
    empresa_id  UNIQUEIDENTIFIER NOT NULL,
    nombre      NVARCHAR(80)     NOT NULL,
    huella      NVARCHAR(900)    NOT NULL,
    mapeo       NVARCHAR(MAX)    NOT NULL,
    usos        INT              NOT NULL CONSTRAINT df_importacion_formatos_usos DEFAULT 1,
    creado_por  UNIQUEIDENTIFIER NOT NULL,
    creado_en   DATETIME2        NOT NULL CONSTRAINT df_importacion_formatos_creado_en DEFAULT SYSUTCDATETIME(),
    usado_en    DATETIME2        NOT NULL CONSTRAINT df_importacion_formatos_usado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_importacion_formatos PRIMARY KEY (id),
    CONSTRAINT fk_importacion_formatos_empresa FOREIGN KEY (empresa_id) REFERENCES dbo.empresas (id),
    CONSTRAINT fk_importacion_formatos_usuario FOREIGN KEY (creado_por) REFERENCES dbo.usuarios (id),
    CONSTRAINT ck_importacion_formatos_mapeo CHECK (ISJSON(mapeo) = 1),
    CONSTRAINT ck_importacion_formatos_usos CHECK (usos > 0)
);

CREATE INDEX ix_importacion_formatos_empresa ON dbo.importacion_formatos (empresa_id, usado_en DESC);

-- ---------------------------------------------------------------------------------------------
-- Categorías de la planilla asociadas a categorías de KontadorIA
-- ---------------------------------------------------------------------------------------------

-- `valor` = texto de la columna categoría de la planilla, normalizado (sin tildes ni mayúsculas):
-- "Bencina" → Transporte. Es de toda la empresa, no de un formato: sirve en cualquier planilla.
CREATE TABLE dbo.categorias_alias (
    empresa_id     UNIQUEIDENTIFIER NOT NULL,
    valor          NVARCHAR(150)    NOT NULL,
    categoria_id   UNIQUEIDENTIFIER NOT NULL,
    actualizado_por UNIQUEIDENTIFIER NOT NULL,
    actualizado_en DATETIME2        NOT NULL CONSTRAINT df_categorias_alias_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_categorias_alias PRIMARY KEY (empresa_id, valor),
    CONSTRAINT fk_categorias_alias_empresa FOREIGN KEY (empresa_id) REFERENCES dbo.empresas (id),
    CONSTRAINT fk_categorias_alias_categoria FOREIGN KEY (categoria_id) REFERENCES dbo.categorias (id),
    CONSTRAINT fk_categorias_alias_usuario FOREIGN KEY (actualizado_por) REFERENCES dbo.usuarios (id)
);

-- RLS: cada empresa ve y escribe solo lo suyo (mismo predicado que importaciones, 0013).
EXEC (N'
CREATE SECURITY POLICY seguridad.politica_importacion_formatos
    ADD FILTER PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.importacion_formatos,
    ADD BLOCK PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.importacion_formatos AFTER INSERT,
    ADD BLOCK PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.importacion_formatos AFTER UPDATE
    WITH (STATE = ON)
');

EXEC (N'
CREATE SECURITY POLICY seguridad.politica_categorias_alias
    ADD FILTER PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.categorias_alias,
    ADD BLOCK PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.categorias_alias AFTER INSERT,
    ADD BLOCK PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.categorias_alias AFTER UPDATE
    WITH (STATE = ON)
');
