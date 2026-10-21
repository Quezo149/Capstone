-- 0008_movimientos_anulacion.sql
-- Eliminación lógica de movimientos (HU06). En contabilidad un registro no se borra, se anula:
-- "Eliminar" en la app marca eliminado_en y eliminado_por, y la fila queda en la base. Así el
-- dueño y el contador pueden saber quién anuló qué y cuándo, y "Deshacer" recupera el mismo
-- movimiento (mismo id y fecha de creación) en vez de crear uno nuevo.
--
-- El backend excluye los anulados de listados, totales y filtros (app/routers/expenses.py).
-- No se mezcla con RLS: RLS decide quién puede ver, esto decide qué está vigente.
-- Una categoría con movimientos anulados sigue sin poder eliminarse (fk_movimientos_categoria):
-- el historial conserva su categoría.

ALTER TABLE dbo.movimientos ADD
    eliminado_en   DATETIME2        NULL,
    eliminado_por  UNIQUEIDENTIFIER NULL
        CONSTRAINT fk_movimientos_eliminado_por FOREIGN KEY REFERENCES dbo.usuarios (id),
    -- Anulado = las dos columnas con valor; vigente = las dos en NULL
    CONSTRAINT ck_movimientos_anulacion CHECK (
        (eliminado_en IS NULL AND eliminado_por IS NULL) OR (eliminado_en IS NOT NULL AND eliminado_por IS NOT NULL)
    );
