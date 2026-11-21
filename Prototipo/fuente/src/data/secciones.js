// Secciones de la app. `listo: false` = se ve en el menú pero muestra la pantalla "Pronto".
// `permiso`: solo aparece para los roles que lo tienen (app/core/permisos.py).
export const SECCIONES = [
  { id: 'inicio', label: 'Inicio', icon: 'home', listo: true },
  { id: 'movimientos', label: 'Movimientos', corto: 'Movim.', icon: 'list', listo: true },
  { id: 'cargar', label: 'Cargar boleta', corto: 'Cargar', icon: 'camera', listo: true, permiso: 'movimientos.registrar' },
  // PROTOTIPO Sprint 4: importación masiva (HU10–HU13), solo admin y contador
  { id: 'importar', label: 'Importar planilla', corto: 'Importar', icon: 'sheet', listo: true, permiso: 'importaciones.realizar' },
  // PROTOTIPO Sprint 5: presupuestos por categoría y mes (HU15), dueño y contador.
  // Sin «Por revisar» (sin historia: la IA se confirma al momento) ni «Reportes» (HU16 = exportar
  // desde Movimientos): decisión del 21-11-2026.
  { id: 'presupuestos', label: 'Presupuestos', corto: 'Presup.', icon: 'target', listo: true, permiso: 'presupuestos.ver' },
  { id: 'categorias', label: 'Categorías', icon: 'tag', listo: true },
  { id: 'equipo', label: 'Equipo', icon: 'users', listo: true, permiso: 'usuarios.ver' },
]
