// Empresa y usuario de ejemplo mientras no hay login (Entra External ID llega después).
// Pollito Picarón es uno de los negocios entrevistados (03 Registro de Stakeholders).
// Condición de la entrevista: solo se publica el nombre del negocio. Por eso no hay RUT
// (no tenemos el real y no se inventa uno) ni nombre de persona: el usuario se muestra por su rol.
// rol usa los mismos códigos que `usuarios_empresa.rol`: admin | contador | empleado
export const EMPRESA = { nombre: 'Pollito Picarón', rut: null, rubro: 'Venta de comida' }
export const USUARIO = { nombre: null, rol: 'admin' }

// Cómo se ve cada rol en pantalla
export const NOMBRE_ROL = { admin: 'Dueño', contador: 'Contador', empleado: 'Colaborador' }
