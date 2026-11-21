-- 0015_presupuestos.sql
-- Presupuestos de gasto por categoría y mes (HU15 — KONTADORIA-76). Solo el admin los crea,
-- edita y elimina (KONTADORIA-77); admin y contador los consultan. Las alertas automáticas al
-- acercarse al límite quedan fuera de v1 (Backlog futuro).
--
-- Reglas que garantiza la base:
--   * un solo presupuesto por empresa, categoría y mes (uq_presupuestos_categoria_mes);
--   * el mes se guarda como el primer día del mes (2026-12-01 = diciembre de 2026), así se
--     compara directo con movimientos.fecha sin ambigüedad de día;
--   * monto límite en pesos chilenos, entero y positivo (BIGINT, igual que movimientos.monto).
--
-- Reglas que aplica el backend (no se pueden expresar como CHECK porque miran otra tabla):
--   * la categoría debe ser de tipo 'gasto';
--   * la categoría debe ser una predefinida o una propia de ESTA empresa. La FK sola no lo
--     garantiza (SQL Server valida las FK sin RLS); el backend la busca con RLS activo antes de
--     insertar, igual que en movimientos.
--
-- Si se elimina una categoría propia, sus presupuestos se van con ella (ON DELETE CASCADE): un
-- presupuesto sin categoría no significa nada y así eliminar_categoria no necesita otro DELETE.
--
-- Va en un solo lote, sin GO (run_migrations.py no entiende GO): CREATE SECURITY POLICY va
-- dentro de EXEC.

CREATE TABLE dbo.presupuestos (
    id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT df_presupuestos_id DEFAULT NEWSEQUENTIALID(),
    empresa_id       UNIQUEIDENTIFIER NOT NULL,  -- clave del aislamiento (RLS)
    categoria_id     UNIQUEIDENTIFIER NOT NULL,
    mes              DATE             NOT NULL,  -- siempre el día 1 del mes
    monto            BIGINT           NOT NULL,  -- límite de gasto, pesos chilenos sin decimales
    creado_por       UNIQUEIDENTIFIER NOT NULL,
    creado_en        DATETIME2        NOT NULL CONSTRAINT df_presupuestos_creado_en DEFAULT SYSUTCDATETIME(),
    actualizado_por  UNIQUEIDENTIFIER NULL,
    actualizado_en   DATETIME2        NULL,
    CONSTRAINT pk_presupuestos PRIMARY KEY (id),
    CONSTRAINT fk_presupuestos_empresa FOREIGN KEY (empresa_id) REFERENCES dbo.empresas (id),
    CONSTRAINT fk_presupuestos_categoria FOREIGN KEY (categoria_id)
        REFERENCES dbo.categorias (id) ON DELETE CASCADE,
    CONSTRAINT fk_presupuestos_creado_por FOREIGN KEY (creado_por) REFERENCES dbo.usuarios (id),
    CONSTRAINT fk_presupuestos_actualizado_por FOREIGN KEY (actualizado_por) REFERENCES dbo.usuarios (id),
    -- Criterio de HU15: existe un solo presupuesto por categoría y mes (dentro de la empresa).
    CONSTRAINT uq_presupuestos_categoria_mes UNIQUE (empresa_id, categoria_id, mes),
    CONSTRAINT ck_presupuestos_mes CHECK (DAY(mes) = 1),
    -- Mismo tope que el formulario de movimientos (MAX_MONTO, 12 dígitos).
    CONSTRAINT ck_presupuestos_monto CHECK (monto > 0 AND monto <= 999999999999),
    -- Editado = las dos columnas con valor; nunca editado = las dos en NULL.
    CONSTRAINT ck_presupuestos_actualizacion CHECK (
        (actualizado_por IS NULL AND actualizado_en IS NULL)
        OR (actualizado_por IS NOT NULL AND actualizado_en IS NOT NULL)
    )
);

-- Pantalla de presupuestos: los de un mes de la empresa (el UNIQUE ya cubre empresa+categoría).
CREATE INDEX ix_presupuestos_empresa_mes ON dbo.presupuestos (empresa_id, mes);

-- RLS: cada empresa ve y escribe solo sus presupuestos (mismo predicado que importaciones, 0013).
-- El empleado no tiene permiso de verlos; eso lo decide el backend (app/core/permisos.py).
EXEC (N'
CREATE SECURITY POLICY seguridad.politica_presupuestos
    ADD FILTER PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.presupuestos,
    ADD BLOCK PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.presupuestos AFTER INSERT,
    ADD BLOCK PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.presupuestos AFTER UPDATE
    WITH (STATE = ON)
');
