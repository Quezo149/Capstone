-- 0006_movimientos.sql
-- Movimientos financieros (Modelo de Base de Datos v2.1). Se crea en el Sprint 1 porque el
-- aislamiento de HU05 (KONTADORIA-31/33) se prueba sobre esta tabla: empresa A contra B y
-- empleado contra otro empleado. El registro desde la app llega con HU03 (Sprint 2).

CREATE TABLE dbo.movimientos (
    id                 UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_movimientos_id DEFAULT NEWSEQUENTIALID(),
    empresa_id         UNIQUEIDENTIFIER NOT NULL,  -- clave del aislamiento (RLS)
    usuario_id         UNIQUEIDENTIFIER NOT NULL,  -- quién lo registró (RLS del rol empleado)
    categoria_id       UNIQUEIDENTIFIER NOT NULL,
    -- FK a importaciones se agrega con esa tabla (HU de importación masiva, Sprint 4).
    importacion_id     UNIQUEIDENTIFIER NULL,
    -- Idempotencia: el mismo envío repetido (mala conexión) se guarda una sola vez.
    client_request_id  UNIQUEIDENTIFIER NULL,
    tipo               VARCHAR(7)       NOT NULL,
    fecha              DATE             NOT NULL,  -- fecha del documento u operación
    monto              BIGINT           NOT NULL,  -- pesos chilenos, sin decimales
    proveedor          NVARCHAR(150)    NULL,
    descripcion        NVARCHAR(500)    NULL,
    tipo_documento     VARCHAR(7)       NOT NULL,
    origen             VARCHAR(18)      NOT NULL,
    archivo_blob       NVARCHAR(400)    NULL,      -- ruta del respaldo en Blob Storage
    creado_en          DATETIME2        NOT NULL CONSTRAINT df_movimientos_creado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_movimientos PRIMARY KEY (id),
    CONSTRAINT fk_movimientos_empresa FOREIGN KEY (empresa_id) REFERENCES dbo.empresas (id),
    CONSTRAINT fk_movimientos_usuario FOREIGN KEY (usuario_id) REFERENCES dbo.usuarios (id),
    CONSTRAINT fk_movimientos_categoria FOREIGN KEY (categoria_id) REFERENCES dbo.categorias (id),
    CONSTRAINT ck_movimientos_tipo CHECK (tipo IN ('ingreso', 'gasto')),
    CONSTRAINT ck_movimientos_monto CHECK (monto > 0),
    CONSTRAINT ck_movimientos_tipo_documento CHECK (tipo_documento IN ('boleta', 'factura', 'otro')),
    CONSTRAINT ck_movimientos_origen CHECK (origen IN ('manual', 'foto', 'pdf', 'importacion_masiva'))
);

-- UNIQUE filtrado: varios movimientos pueden no traer client_request_id (NULL).
CREATE UNIQUE INDEX uq_movimientos_client_request_id
    ON dbo.movimientos (client_request_id) WHERE client_request_id IS NOT NULL;

CREATE INDEX ix_movimientos_empresa_fecha ON dbo.movimientos (empresa_id, fecha DESC);
