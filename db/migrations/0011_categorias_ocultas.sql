-- 0011_categorias_ocultas.sql
-- Categorías predefinidas que una empresa decidió no ver al registrar (mejora a HU14, 28-10-2026).
-- Las predefinidas son compartidas por todas las empresas (empresa_id NULL en dbo.categorias) y los
-- movimientos apuntan a ellas, así que no se borran ni se editan: cada empresa puede OCULTARLAS.
-- Una oculta no aparece en los formularios, pero los movimientos que ya la usan la siguen mostrando
-- y se puede volver a mostrar (borrando la fila de aquí).
--
-- Reglas que aplica el backend (app/routers/categorias.py):
--   * solo predefinidas (las propias se editan o eliminan) y solo el admin;
--   * siempre queda al menos una categoría visible de gastos y una de ingresos: el empleado no
--     crea categorías (D2) y sin ninguna no podría registrar.

CREATE TABLE dbo.categorias_ocultas (
    empresa_id    UNIQUEIDENTIFIER NOT NULL,
    categoria_id  UNIQUEIDENTIFIER NOT NULL,
    ocultada_por  UNIQUEIDENTIFIER NOT NULL,
    ocultada_en   DATETIME2        NOT NULL CONSTRAINT df_categorias_ocultas_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_categorias_ocultas PRIMARY KEY (empresa_id, categoria_id),
    CONSTRAINT fk_categorias_ocultas_empresa FOREIGN KEY (empresa_id) REFERENCES dbo.empresas (id),
    CONSTRAINT fk_categorias_ocultas_categoria FOREIGN KEY (categoria_id) REFERENCES dbo.categorias (id),
    CONSTRAINT fk_categorias_ocultas_usuario FOREIGN KEY (ocultada_por) REFERENCES dbo.usuarios (id)
);

-- RLS: cada empresa ve y escribe solo sus filas (mismo predicado que las categorías propias).
-- En EXEC: run_migrations.py manda el archivo en un solo lote y CREATE SECURITY POLICY debe ir solo.
EXEC (N'
CREATE SECURITY POLICY seguridad.politica_categorias_ocultas
    ADD FILTER PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.categorias_ocultas,
    ADD BLOCK PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.categorias_ocultas AFTER INSERT,
    ADD BLOCK PREDICATE seguridad.fn_rls_empresa(empresa_id) ON dbo.categorias_ocultas AFTER UPDATE
    WITH (STATE = ON)
');
