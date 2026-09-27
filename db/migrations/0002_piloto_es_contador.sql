-- 0002_piloto_es_contador.sql
-- Marca a los interesados que son contadores externos (llevan varias PYMEs).
-- Sirve para medir interés en un futuro plan Contador (ver 13 Backlog Futuro).
-- NOT NULL + DEFAULT: las filas existentes quedan en 0 (no contador) automáticamente.
ALTER TABLE piloto_interesados
    ADD es_contador BIT NOT NULL
        CONSTRAINT df_piloto_interesados_es_contador DEFAULT 0;
