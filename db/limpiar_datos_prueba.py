"""
limpiar_datos_prueba.py
Borra los datos de negocio (empresas, usuarios, movimientos, categorías propias e invitaciones)
para dejar la base limpia antes de abrir la app a clientes. Pensado para correrlo UNA vez, justo
antes del piloto, cuando en Azure solo hay cuentas de prueba del equipo.

NO toca:
- piloto_interesados: contactos reales que dejaron sus datos en la landing.
- las categorías predefinidas (empresa_id NULL) ni schema_migrations.
- las cuentas de Microsoft Entra: si alguien vuelve a entrar, la app le pide registrar su empresa.
  Las cuentas de prueba se eliminan, si se quiere, en el portal de Entra.

RLS aplica también al administrador de la base: sin contexto, un DELETE no ve filas. Por eso el
script apaga las políticas, borra y las vuelve a encender, todo en UNA transacción: si algo falla,
se revierte entero y RLS queda encendido. Azure SQL guarda copias automáticas (restauración a un
punto en el tiempo), pero conviene correrlo primero sin --borrar y revisar los números.

Uso:
    AZURE_SQL_CONNECTION_STRING="..." python limpiar_datos_prueba.py            # solo cuenta
    AZURE_SQL_CONNECTION_STRING="..." python limpiar_datos_prueba.py --borrar   # borra (pide confirmar)
"""

import re
import sys

from run_migrations import get_connection

# Orden de borrado según las claves foráneas (hijos antes que padres)
PASOS = [
    ("invitaciones", "DELETE FROM dbo.invitaciones"),
    ("movimientos", "DELETE FROM dbo.movimientos"),
    ("categorías propias", "DELETE FROM dbo.categorias WHERE empresa_id IS NOT NULL"),
    ("membresías (usuarios_empresa)", "DELETE FROM dbo.usuarios_empresa"),
    ("usuarios", "DELETE FROM dbo.usuarios"),
    ("empresas", "DELETE FROM dbo.empresas"),
]

CONTEOS = {
    "empresas": "SELECT COUNT(*) FROM dbo.empresas",
    "usuarios": "SELECT COUNT(*) FROM dbo.usuarios",
    "membresías (usuarios_empresa)": "SELECT COUNT(*) FROM dbo.usuarios_empresa",
    "categorías propias": "SELECT COUNT(*) FROM dbo.categorias WHERE empresa_id IS NOT NULL",
    "movimientos": "SELECT COUNT(*) FROM dbo.movimientos",
    "invitaciones": "SELECT COUNT(*) FROM dbo.invitaciones",
    "-- se conservan --": None,
    "categorías predefinidas": "SELECT COUNT(*) FROM dbo.categorias WHERE empresa_id IS NULL",
    "piloto_interesados (landing)": "SELECT COUNT(*) FROM dbo.piloto_interesados",
}


def politicas(cur):
    """Políticas de RLS que están encendidas (dependen de qué migraciones se aplicaron)."""
    cur.execute(
        "SELECT SCHEMA_NAME(schema_id) + '.' + name FROM sys.security_policies WHERE is_enabled = 1"
    )
    return [r[0] for r in cur.fetchall()]


def tabla_existe(cur, nombre):
    cur.execute("SELECT 1 FROM sys.tables WHERE name = ?", nombre)
    return cur.fetchone() is not None


def contar(cur, titulo):
    print(f"\n{titulo}")
    for etiqueta, sql in CONTEOS.items():
        if sql is None:
            print(f"  {etiqueta}")
            continue
        tabla = re.search(r"dbo\.(\w+)", sql).group(1)
        valor = cur.execute(sql).fetchone()[0] if tabla_existe(cur, tabla) else "(no existe)"
        print(f"  {etiqueta:<32} {valor}")


def main():
    borrar = "--borrar" in sys.argv
    conn = get_connection()
    conn.autocommit = False
    cur = conn.cursor()
    servidor = cur.execute("SELECT @@SERVERNAME, DB_NAME()").fetchone()
    print(f"Base: {servidor[1]} en {servidor[0]}")

    activas = politicas(cur)
    try:
        # Con RLS apagado (dentro de la transacción) los conteos muestran todo, no solo lo visible
        for p in activas:
            cur.execute(f"ALTER SECURITY POLICY {p} WITH (STATE = OFF)")
        contar(cur, "Antes:")

        if not borrar:
            print("\nNo se borró nada. Para borrar, vuelve a correrlo con --borrar.")
            conn.rollback()
            return

        escrito = input(f"\nEsto BORRA los datos de arriba. Escribe el nombre de la base ({servidor[1]}) para seguir: ")
        if escrito.strip() != servidor[1]:
            print("No coincide. No se borró nada.")
            conn.rollback()
            return

        for etiqueta, sql in PASOS:
            tabla = re.search(r"dbo\.(\w+)", sql).group(1)
            if tabla_existe(cur, tabla):
                cur.execute(sql)
                print(f"  Borrado: {etiqueta} ({cur.rowcount})")

        contar(cur, "Después:")
        for p in activas:
            cur.execute(f"ALTER SECURITY POLICY {p} WITH (STATE = ON)")
        conn.commit()
        print("\nListo. RLS volvió a quedar encendido en:", ", ".join(activas))
    except Exception as e:
        conn.rollback()  # también deshace el STATE = OFF: RLS sigue como estaba
        print(f"\nERROR: {e}\nSe revirtió todo; no se borró nada y RLS quedó como estaba.")
        sys.exit(1)
    finally:
        # Comprobación final, fuera de la transacción
        apagadas = set(activas) - set(politicas(conn.cursor()))
        if apagadas:
            print(f"ATENCIÓN: estas políticas quedaron apagadas: {apagadas}")


if __name__ == "__main__":
    main()
