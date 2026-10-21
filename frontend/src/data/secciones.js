// Secciones de la app. `listo: false` = se ve en el menú pero muestra la pantalla "Pronto".
// `permiso`: solo aparece para los roles que lo tienen (app/core/permisos.py).
export const SECCIONES = [
  { id: 'inicio', label: 'Inicio', icon: 'home', listo: true },
  { id: 'movimientos', label: 'Movimientos', corto: 'Movim.', icon: 'list', listo: true },
  { id: 'cargar', label: 'Cargar boleta', corto: 'Cargar', icon: 'camera' },
  { id: 'revisar', label: 'Por revisar', icon: 'checkc' },
  { id: 'reportes', label: 'Reportes', icon: 'chart' },
  { id: 'categorias', label: 'Categorías', icon: 'tag', listo: true },
  { id: 'equipo', label: 'Equipo', icon: 'users', listo: true, permiso: 'usuarios.ver' },
]
