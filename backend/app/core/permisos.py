"""
Tabla de roles (HU03 — KONTADORIA-44). Fuente única de qué puede hacer cada rol:
los endpoints la consultan con require_permiso() y /auth/me se la entrega a la app para
mostrar u ocultar acciones (KONTADORIA-45). La pantalla solo refleja estas reglas; quien
decide es el servidor, y RLS sigue siendo la barrera de los datos (0007_rls.sql).

Basada en "05 Flujos de Carga.md" y en las decisiones del 11-10-2026:
D1 el contador no registra movimientos; D2 solo el admin crea y edita categorías.
"""

ROLES = ("admin", "contador", "empleado")

PERMISOS: dict[str, tuple[str, ...]] = {
    # Empresa (HU04)
    "empresa.ver": ("admin", "contador", "empleado"),
    "empresa.editar": ("admin",),
    # Categorías (HU14)
    "categorias.ver": ("admin", "contador", "empleado"),
    "categorias.gestionar": ("admin",),
    # Movimientos (HU06, HU07). Qué filas ve cada rol lo decide RLS:
    # el empleado solo las suyas; admin y contador, todas las de su empresa.
    "movimientos.ver": ("admin", "contador", "empleado"),
    "movimientos.registrar": ("admin", "empleado"),
    "movimientos.filtrar_usuario": ("admin", "contador"),
    # Usuarios de la empresa (HU02)
    "usuarios.ver": ("admin", "contador"),
    "usuarios.gestionar": ("admin",),
}


def permisos_de(rol: str) -> list[str]:
    return sorted(p for p, roles in PERMISOS.items() if rol in roles)
