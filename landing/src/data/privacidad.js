// Datos de la política de privacidad (PrivacyDialog.jsx).
// Versión y fecha vienen de politica.json en la raíz del repo, el mismo archivo que leen la app
// (frontend) y el backend: al cambiar el texto de la política, actualizar solo ese archivo.
// La 1.0 era la del formulario del piloto (ya retirado); POLITICA_VERSION en
// backend/app/routers/piloto.py queda en '1.0' porque es la que aceptaron esas personas.
import politica from '../../../politica.json'

export const VERSION = politica.version
export const VIGENTE_DESDE = politica.vigente_desde
export const CONTACTO = 'felipeignacio027@gmail.com'
export const RESPONSABLES = 'Felipe Quezada, Diego Gallardo y Vicente Hermosilla'

// Hash que abre el modal: cualquier <a href="#privacidad"> de la página lo abre,
// y kontadoria.cl/#privacidad se puede compartir como enlace directo a la política.
export const HASH = '#privacidad'
