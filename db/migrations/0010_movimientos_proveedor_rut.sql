-- 0010_movimientos_proveedor_rut.sql
-- RUT del emisor del documento (HU08/HU09, Sprint 3). La lectura con IA lo saca de la boleta o
-- factura (app/core/lectura.py, validando el dígito verificador) y el usuario lo confirma o
-- corrige antes de guardar. Sirve para dos cosas:
--   * sugerir la categoría con el historial de la empresa: si ya se le compró a ese RUT, se
--     propone la misma categoría (el nombre del comercio cambia entre boletas, el RUT no);
--   * avisar de una compra repetida: mismo RUT, monto y fecha (voucher + boleta de la misma compra).
--
-- Se guarda normalizado, sin puntos y con guion: 76134946-5 (como app/core/rut.py). NULL en los
-- movimientos manuales sin RUT y en los anteriores a esta migración.

ALTER TABLE dbo.movimientos ADD
    proveedor_rut  VARCHAR(10) NULL;

-- Las dos búsquedas son siempre dentro de la empresa (RLS) y por RUT; la fecha ordena el historial.
-- Va en EXEC porque run_migrations.py manda el archivo en un solo lote (sin GO) y SQL Server
-- compila el lote entero antes de que exista la columna nueva.
EXEC('CREATE INDEX ix_movimientos_empresa_proveedor_rut
          ON dbo.movimientos (empresa_id, proveedor_rut, fecha DESC)
          WHERE proveedor_rut IS NOT NULL');
