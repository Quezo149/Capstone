// Datos de la política de privacidad (PrivacyDialog.jsx) y del consentimiento del formulario.
// VERSION debe ser igual a POLITICA_VERSION en backend/app/routers/piloto.py: el backend
// rechaza (422) cualquier otra. Al cambiar el texto de la política, subir ambas a la vez
// y actualizar VIGENTE_DESDE.
export const VERSION = '1.0'
export const VIGENTE_DESDE = '15 de octubre de 2026'
export const CONTACTO = 'felipeignacio027@gmail.com'
export const RESPONSABLES = 'Felipe Quezada, Diego Gallardo y Vicente Hermosilla'

// Hash que abre el modal: cualquier <a href="#privacidad"> de la página lo abre,
// y kontadoria.cl/#privacidad se puede compartir como enlace directo a la política.
export const HASH = '#privacidad'
