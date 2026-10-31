-- 0012_usuarios_politica.sql
-- (0010 y 0011 las usa la rama feature/sprint3-carga-ia)
-- Aceptación de la política de privacidad de la app (landing/src/data/privacidad.js).
-- La persona marca una casilla al registrar su empresa (HU17) o al aceptar una invitación (HU02):
-- se guarda qué versión aceptó y cuándo (hora del servidor), como prueba del consentimiento
-- (Ley 19.628 art. 4: debe constar por escrito; Ley 21.719: el responsable debe poder acreditarlo).
-- NULL = cuentas creadas antes de esta migración, que no aceptaron ninguna versión.

ALTER TABLE dbo.usuarios ADD
    politica_version     VARCHAR(10) NULL,
    politica_aceptada_en DATETIME2   NULL;
