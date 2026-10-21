#!/usr/bin/env bash
# Corre un comando contra la base de Azure, con AZURE_SQL_CONNECTION_STRING armada desde
# backend/local.settings.azure.json (ignorado por git). La contraseña no se muestra ni queda en
# el historial de la terminal: solo vive en el entorno del comando que se ejecuta.
#
# Uso (desde la raíz del repo):
#   db/con_azure.sh backend/.venv/bin/python db/run_migrations.py
#   db/con_azure.sh backend/.venv/bin/python db/limpiar_datos_prueba.py
#
# Requisitos: la IP de este equipo permitida en el firewall de sql-kontadoria (portal de Azure),
# y el ODBC Driver 18. La base es serverless: la primera conexión puede tardar ~1 minuto en despertarla.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$RAIZ/backend/local.settings.azure.json"
PY="$RAIZ/backend/.venv/bin/python"

if [ $# -eq 0 ]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi
if [ ! -f "$CFG" ]; then
  echo "Falta $CFG (la configuración de Azure con la clave de la base)." >&2
  exit 1
fi

# En la cadena ODBC la contraseña va entre llaves, y una } dentro se escribe }}
AZURE_SQL_CONNECTION_STRING="$("$PY" - "$CFG" <<'EOF'
import json, sys
v = json.load(open(sys.argv[1], encoding="utf-8"))["Values"]
clave = v["SQL_PASSWORD"].replace("}", "}}")
print(
    "DRIVER={ODBC Driver 18 for SQL Server};"
    f"SERVER={v['SQL_SERVER']};DATABASE={v['SQL_DATABASE']};UID={v['SQL_USER']};PWD={{{clave}}};"
    "Encrypt=yes;TrustServerCertificate=no"
)
EOF
)"
export AZURE_SQL_CONNECTION_STRING

echo "Base: $(echo "$AZURE_SQL_CONNECTION_STRING" | grep -o 'DATABASE=[^;]*' | cut -d= -f2) en $(echo "$AZURE_SQL_CONNECTION_STRING" | grep -o 'SERVER=[^;]*' | cut -d= -f2)" >&2
exec "$@"
