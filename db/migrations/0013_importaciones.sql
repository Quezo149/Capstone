-- 0013_importaciones.sql
-- Importaciones masivas desde CSV/XLSX (HU10–HU13 — KONTADORIA-65). Ver "15 Modelo de Base de
-- Datos" (entidad Importaciones) y la columna movimientos.importacion_id, que existe desde 0006.
--
-- Una fila por archivo CONFIRMADO. La vista previa (HU12) no escribe nada: el backend valida el
-- archivo, muestra el resumen y solo al confirmar crea, en una transacción, esta fila y los
-- movimientos válidos con origen = 'importacion_masiva'. Cancelar no deja rastro en la base.
-- Por eso no hay estados "pendiente" ni "cancelada": solo completada o completada con errores.
--
-- Trazabilidad (HU13): quién (usuario_id), cuándo (creado_en), qué archivo (nombre y tipo),
-- cuántas filas (totales, importadas, con error) y con qué resultado (estado). Cada movimiento
-- importado apunta a su importación.
--
-- Va en un solo lote, sin GO (run_migrations.py no entiende GO): CREATE SECURITY POLICY va
-- dentro de EXEC.

CREATE TABLE dbo.importaciones (
    id                 UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_importaciones_id DEFAULT NEWSEQUENTIALID(),
    empresa_id         UNIQUEIDENTIFIER NOT NULL,  -- clave del aislamiento (RLS)
    usuario_id         UNIQUEIDENTIFIER NOT NULL,  -- quién importó (admin o contador)
    -- Idempotencia: un doble clic en "Confirmar" o un reintento crea una sola importación.
    client_request_id  UNIQUEIDENTIFIER NULL,
    nombre_archivo     NVARCHAR(255)    NOT NULL,  -- tal como lo subió el usuario
    tipo_archivo       VARCHAR(4)       NOT NULL,
    total_filas        INT              NOT NULL,  -- filas de datos, sin contar el encabezado
    filas_importadas   INT              NOT NULL,
    filas_con_error    INT              NOT NULL,
    estado             VARCHAR(22)      NOT NULL,
    creado_en          DATETIME2        NOT NULL CONSTRAINT df_importaciones_creado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_importaciones PRIMARY KEY (id),
    -- (id, empresa_id) único para que movimientos lo use en una FK compuesta (más abajo).
    CONSTRAINT uq_importaciones_id_empresa UNIQUE (id, empresa_id),
    CONSTRAINT fk_importaciones_empresa FOREIGN KEY (empresa_id) REFERENCES dbo.empresas (id),
    CONSTRAINT fk_importaciones_usuario FOREIGN KEY (usuario_id) REFERENCES dbo.usuarios (id),
    CONSTRAINT ck_importaciones_tipo_archivo CHECK (tipo_archivo IN ('csv', 'xlsx')),
    CONSTRAINT ck_importaciones_conteos CHECK (
        filas_con_error >= 0
        AND filas_importadas > 0                       -- sin filas válidas no se puede confirmar
        AND total_filas = filas_importadas + filas_con_error
    ),
    CONSTRAINT ck_importaciones_estado CHECK (estado IN ('completada', 'completada_con_errores')),
    -- El estado no puede contradecir los conteos.
    CONSTRAINT ck_importaciones_estado_conteos CHECK (
        (estado = 'completada' AND filas_con_error = 0)
        OR (estado = 'completada_con_errores' AND filas_con_error > 0)
    )
);

-- UNIQUE filtrado: las importaciones sin client_request_id (NULL) no chocan entre sí.
CREATE UNIQUE INDEX uq_importaciones_client_request_id
    ON dbo.importaciones (client_request_id) WHERE client_request_id IS NOT NULL;

-- Historial de importaciones de la empresa, de la más reciente a la más antigua (HU13).
CREATE INDEX ix_importaciones_empresa_fecha ON dbo.importaciones (empresa_id, creado_en DESC);

-- La FK que 0006 dejó pendiente. Es compuesta (importacion_id, empresa_id): un movimiento solo
-- puede apuntar a una importación de SU empresa. Una FK simple no lo garantiza, porque SQL Server
-- valida las FK sin aplicar RLS. Si importacion_id es NULL (carga manual o foto/PDF), no se valida.
ALTER TABLE dbo.movimientos
    ADD CONSTRAINT fk_movimientos_importacion
    FOREIGN KEY (importacion_id, empresa_id) REFERENCES dbo.importaciones (id, empresa_id);

-- Movimientos de una importación (detalle desde el historial).
CREATE INDEX ix_movimientos_importacion
    ON dbo.movimientos (importacion_id) WHERE importacion_id IS NOT NULL;

-- RLS: cada empresa ve y escribe solo sus importaciones, el mismo predicado que las categorías
-- propias (fn_rls_empresa, 0007). El empleado no tiene permiso de importar ni de ver el
-- historial; eso lo decide el backend (app/core/permisos.py), como en el resto de las tablas.
EXEC (N'
CREATE SECURITY POLICY seguridad.politica_importaciones
    ADD FILTER PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.importaciones,
    ADD BLOCK PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.importaciones AFTER INSERT,
    ADD BLOCK PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.importaciones AFTER UPDATE
    WITH (STATE = ON)
');
