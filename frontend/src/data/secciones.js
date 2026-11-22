// Secciones de la app. `listo: false` = se ve en el menú pero muestra la pantalla "Pronto".
// `permiso`: solo aparece para los roles que lo tienen (app/core/permisos.py).
export const SECCIONES = [
  { id: 'inicio', label: 'Inicio', icon: 'home', listo: true },
  { id: 'movimientos', label: 'Movimientos', corto: 'Movim.', icon: 'list', listo: true },
  { id: 'cargar', label: 'Cargar boleta', corto: 'Cargar', icon: 'camera', listo: true, permiso: 'movimientos.registrar' },
  // HU10–HU13: importación masiva, solo admin y contador
  { id: 'importar', label: 'Importar planilla', corto: 'Importar', icon: 'sheet', listo: true, permiso: 'importaciones.realizar' },
  // Sin "Por revisar" ni "Reportes" (21-11-2026): la IA ya se confirma al cargar y la exportación
  // vive en Movimientos (HU16); un reporte aparte repetía lo de Inicio y Movimientos.
  { id: 'categorias', label: 'Categorías', icon: 'tag', listo: true },
  { id: 'equipo', label: 'Equipo', icon: 'users', listo: true, permiso: 'usuarios.ver' },
]
