"""
run_migrations.py
Aplica automáticamente las migraciones de base de datos pendientes.
Ver "Tutorial - Migraciones de Base de Datos" en el vault.

Uso:
    AZURE_SQL_CONNECTION_STRING="..." python run_migrations.py
"""

import os
import sys

import pyodbc

MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "migrations")


def get_connection():
    connection_string = os.environ.get("AZURE_SQL_CONNECTION_STRING")
    if not connection_string:
        print("ERROR: falta la variable de entorno AZURE_SQL_CONNECTION_STRING")
        sys.exit(1)
    return pyodbc.connect(connection_string)


def ensure_migrations_table(cursor):
    cursor.execute("""
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'schema_migrations')
        CREATE TABLE schema_migrations (
            version     VARCHAR(10) PRIMARY KEY,
            aplicado_en DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        )
    """)


def get_applied_versions(cursor):
    cursor.execute("SELECT version FROM schema_migrations")
    return {row[0] for row in cursor.fetchall()}


def get_pending_migrations(applied):
    archivos = sorted(f for f in os.listdir(MIGRATIONS_DIR) if f.endswith(".sql"))
    pendientes = []
    for archivo in archivos:
        version = archivo.split("_")[0]
        if version not in applied:
            pendientes.append((version, archivo))
    return pendientes


def apply_migration(cursor, conn, version, archivo):
    ruta = os.path.join(MIGRATIONS_DIR, archivo)
    with open(ruta, encoding="utf-8") as f:
        sql = f.read()
    try:
        # El cambio y su registro en schema_migrations van en la misma transacción:
        # o quedan los dos, o ninguno.
        cursor.execute(sql)
        cursor.execute("INSERT INTO schema_migrations (version) VALUES (?)", version)
        conn.commit()
        print(f"  Aplicada: {archivo}")
    except Exception as e:
        conn.rollback()
        print(f"  ERROR aplicando {archivo}: {e}")
        print("  Se detiene la ejecución. Corrige el archivo y vuelve a correr el script.")
        sys.exit(1)


def main():
    conn = get_connection()
    cursor = conn.cursor()

    ensure_migrations_table(cursor)
    conn.commit()

    applied = get_applied_versions(cursor)
    pending = get_pending_migrations(applied)

    if not pending:
        print("No hay migraciones pendientes. La base de datos está al día.")
        return

    print(f"Aplicando {len(pending)} migración(es) pendiente(s):")
    for version, archivo in pending:
        apply_migration(cursor, conn, version, archivo)

    print("Listo.")


if __name__ == "__main__":
    main()
