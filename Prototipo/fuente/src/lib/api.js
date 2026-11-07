// PROTOTIPO: misma firma que frontend/src/lib/api.js, pero responde desde lib/proto.js en vez
// de llamar a func-kontadoria. Imita las reglas del backend que se notan en pantalla:
// permisos por rol (app/core/permisos.py), RLS del empleado e idempotencia.
import { leerDb, guardarDb, nuevoId, PERSONAS, rolActual, usuarioSesion } from './proto'
import { aliasNuevos, analizar, faltantesMapeo, huella, interpretarHojas, MAX_FILAS } from './importacion'

export class ApiError extends Error {
  constructor(status, codigo, mensaje) {
    super(mensaje)
    this.status = status
    this.codigo = codigo
  }
}

// Copia de app/core/permisos.py
const PERMISOS = {
  'empresa.ver': ['admin', 'contador', 'empleado'],
  'empresa.editar': ['admin'],
  'categorias.ver': ['admin', 'contador', 'empleado'],
  'categorias.gestionar': ['admin'],
  'movimientos.ver': ['admin', 'contador', 'empleado'],
  'movimientos.registrar': ['admin', 'empleado'],
  'movimientos.filtrar_usuario': ['admin', 'contador'],
  'usuarios.ver': ['admin', 'contador'],
  'usuarios.gestionar': ['admin'],
  // Importación masiva (HU10–HU13, Sprint 4): el contador importa aunque no registre a mano (D1)
  'importaciones.realizar': ['admin', 'contador'],
  'importaciones.ver': ['admin', 'contador'],
  // Solo en el prototipo por ahora: si pasa a producción se decide con el equipo
  'importaciones.anular': ['admin', 'contador'],
}
const permisosDe = (rol) => Object.keys(PERMISOS).filter((p) => PERMISOS[p].includes(rol)).sort()

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const copia = (x) => JSON.parse(JSON.stringify(x))
const noEncontrado = () => new ApiError(404, 'no_encontrado', 'No encontramos ese registro.')

function exigir(rol, permiso) {
  if (!PERMISOS[permiso].includes(rol)) throw new ApiError(403, 'sin_permiso', 'Tu rol no permite hacer esto.')
}

// RLS: el empleado solo ve lo que registró él
const visibles = (db, rol, yo) => db.movimientos.filter((m) => !m.eliminado && (rol !== 'empleado' || m.usuario_id === yo.id))

export async function api(ruta, { method = 'GET', body } = {}) {
  await espera(180) // que se sienta como una API
  const db = leerDb()
  // Quien aceptó una invitación en este navegador entra como esa persona (ver usuarioSesion)
  const propio = usuarioSesion(db)
  const rol = propio?.rol ?? rolActual()
  const yo = propio ?? PERSONAS[rol]
  const [camino] = ruta.split('?')
  const partes = camino.split('/').filter(Boolean)
  const r = (patron, m = 'GET') => {
    if (method !== m) return null
    const p = patron.split('/').filter(Boolean)
    if (p.length !== partes.length) return null
    const params = {}
    for (let i = 0; i < p.length; i++) {
      if (p[i].startsWith(':')) params[p[i].slice(1)] = partes[i]
      else if (p[i] !== partes[i]) return null
    }
    return params
  }
  let p
  const fin = (x) => {
    guardarDb()
    return copia(x)
  }

  // ---------- Invitación: lo que ve quien abre el link (HU02), antes de pertenecer a la empresa ----------
  const vigencia = (inv) => (inv.estado === 'pendiente' && new Date(inv.expira_en) < new Date() ? 'vencida' : inv.estado)
  if ((p = r('/invitaciones/publica/:token'))) {
    const inv = db.invitaciones.find((x) => x.token === p.token)
    if (!inv || !db.empresa) throw new ApiError(404, 'no_encontrada', 'No encontramos esta invitación. Revisa que el link esté completo.')
    return { empresa: db.empresa.nombre, rol: inv.rol, email: inv.email, estado: vigencia(inv) }
  }
  // PROTOTIPO: no hay cuentas reales, así que aceptar "inicia sesión" como la persona invitada en
  // este navegador. Para volver al dueño se usa el selector "Entrar como" de la barra del prototipo.
  if (r('/invitaciones/aceptar', 'POST')) {
    const inv = db.invitaciones.find((x) => x.token === body.token)
    if (!inv) throw new ApiError(404, 'no_encontrada', 'No encontramos esta invitación.')
    if (vigencia(inv) !== 'pendiente') throw new ApiError(409, 'no_vigente', 'Esta invitación ya no está vigente. Pide un link nuevo.')
    let u = db.usuarios.find((x) => x.email.toLowerCase() === inv.email.toLowerCase())
    if (!u) {
      const local = inv.email.split('@')[0].replace(/[._-]+/g, ' ').trim()
      const nombre = local.replace(/\b\p{L}/gu, (l) => l.toUpperCase()) || inv.email
      u = { id: nuevoId(), nombre, email: inv.email, rol: inv.rol, activo: true }
      db.usuarios.push(u)
    } else Object.assign(u, { rol: inv.rol, activo: true })
    inv.estado = 'usada'
    db.sesionUsuarioId = u.id
    return fin({ usuario: u })
  }

  // Producción: la primera sesión no tiene empresa (HU17)
  if (!db.empresa) {
    if (r('/empresas', 'POST')) {
      db.empresa = { id: nuevoId(), nombre: body.nombre, rut: body.rut, giro: body.giro ?? '' }
      db.usuarios = [{ ...yo, rol: 'admin', activo: true }]
      return fin({ empresa: db.empresa })
    }
    throw new ApiError(403, 'sin_empresa', 'Todavía no registras tu empresa.')
  }
  if (propio && propio.activo === false) throw new ApiError(403, 'usuario_desactivado', 'Tu acceso está desactivado.')
  if (r('/auth/me'))
    return { usuario_id: yo.id, empresa_id: db.empresa.id, empresa_nombre: db.empresa.nombre, rol, email: yo.email, permisos: permisosDe(rol) }

  // ---------- Categorías (HU14) ----------
  // PROTOTIPO A+B: el admin puede ocultar una predefinida para SU empresa (no se borra: el
  // historial la sigue mostrando). En la app real sería una tabla categorias_ocultas.
  const ocultas = () => (db.empresa.ocultas ??= [])
  // Siempre queda al menos una categoría visible de gastos y una de ingresos: el empleado no
  // crea categorías (D2) y sin ninguna no podría registrar nada
  const visiblesDe = (tipo) => db.categorias.filter((c) => c.tipo === tipo && !ocultas().includes(c.id))
  const ultimaVisible = (c) => visiblesDe(c.tipo).length <= 1 && !ocultas().includes(c.id)
  const errorUltima = (c) =>
    new ApiError(409, 'ultima_visible', `Debe quedar al menos una categoría de ${c.tipo === 'gasto' ? 'gastos' : 'ingresos'}.`)
  if (r('/categorias')) return copia(db.categorias.map((c) => ({ ...c, oculta: ocultas().includes(c.id) })))
  if ((p = r('/categorias/:id/oculta', 'PUT'))) {
    exigir(rol, 'categorias.gestionar')
    const c = db.categorias.find((x) => x.id === p.id)
    if (!c) throw noEncontrado()
    if (!c.predefinida) throw new ApiError(422, 'solo_predefinidas', 'Las categorías propias se editan o eliminan.')
    if (body.oculta && ultimaVisible(c)) throw errorUltima(c)
    db.empresa.ocultas = body.oculta ? [...new Set([...ocultas(), c.id])] : ocultas().filter((id) => id !== c.id)
    return fin({ ...c, oculta: Boolean(body.oculta) })
  }
  if (r('/categorias', 'POST')) {
    exigir(rol, 'categorias.gestionar')
    const c = { id: nuevoId(), ...body, predefinida: false }
    db.categorias.push(c)
    return fin(c)
  }
  if ((p = r('/categorias/:id', 'PUT'))) {
    exigir(rol, 'categorias.gestionar')
    const c = db.categorias.find((x) => x.id === p.id)
    if (!c) throw noEncontrado()
    Object.assign(c, body, { tipo: c.tipo })
    return fin(c)
  }
  if ((p = r('/categorias/:id', 'DELETE'))) {
    exigir(rol, 'categorias.gestionar')
    if (db.movimientos.some((m) => m.categoria_id === p.id && !m.eliminado))
      throw new ApiError(409, 'categoria_en_uso', 'Esta categoría tiene movimientos: no se puede eliminar.')
    const borrada = db.categorias.find((x) => x.id === p.id)
    if (borrada && ultimaVisible(borrada)) throw errorUltima(borrada)
    db.categorias = db.categorias.filter((x) => x.id !== p.id)
    return fin(null)
  }

  // ---------- Movimientos (HU06, HU07, HU08/09) ----------
  if (r('/movimientos')) return copia(visibles(db, rol, yo))
  if (r('/movimientos', 'POST')) {
    exigir(rol, 'movimientos.registrar')
    // Idempotencia: el mismo client_request_id devuelve el mismo movimiento
    const repetido = body.client_request_id && db.movimientos.find((m) => m.client_request_id === body.client_request_id)
    if (repetido) return copia(repetido)
    const m = {
      origen: 'manual',
      documento: null,
      ...body,
      id: nuevoId(),
      usuario_id: yo.id,
      usuario_nombre: yo.nombre,
      creado_en: new Date().toISOString(),
      eliminado: false,
    }
    db.movimientos.push(m)
    return fin(m)
  }
  if ((p = r('/movimientos/:id', 'PUT'))) {
    exigir(rol, 'movimientos.registrar')
    const m = visibles(db, rol, yo).find((x) => x.id === p.id)
    if (!m) throw noEncontrado()
    Object.assign(m, body)
    return fin(m)
  }
  if ((p = r('/movimientos/:id', 'DELETE'))) {
    exigir(rol, 'movimientos.registrar')
    const m = visibles(db, rol, yo).find((x) => x.id === p.id)
    if (!m) throw noEncontrado()
    m.eliminado = true
    return fin(null)
  }
  if ((p = r('/movimientos/:id/restaurar', 'POST'))) {
    const m = db.movimientos.find((x) => x.id === p.id)
    if (!m) throw noEncontrado()
    m.eliminado = false
    return fin(m)
  }

  // ---------- Importaciones (HU10–HU13 + planillas propias) ----------
  // Mismo contrato que la propuesta para el backend: el cliente manda el archivo (aquí, sus hojas ya
  // leídas) en cada paso y el servidor no guarda nada hasta confirmar. analizar y validar no
  // escriben; confirmar vuelve a validar todo y guarda junto la importación, los movimientos
  // válidos no excluidos, el formato (si se pidió recordarlo) y las categorías asociadas.
  const importaciones = () => (db.importaciones ??= [])
  const perfiles = () => (db.perfilesImportacion ??= [])
  const alias = () => (db.empresa.aliasCategorias ??= {})
  const categoriasConOcultas = () => db.categorias.map((c) => ({ ...c, oculta: ocultas().includes(c.id) }))
  // seleccion = hojas a importar (la primera es la del mapeo); incluirOcultas = filas ocultas por filtro
  const revisar = ({ hojas, seleccion, mapeo, incluirOcultas }) => {
    if (!mapeo || faltantesMapeo(mapeo).length) throw new ApiError(422, 'mapeo_incompleto', 'Faltan columnas por elegir.')
    return interpretarHojas(hojas, seleccion, mapeo, { categorias: categoriasConOcultas(), existentes: db.movimientos, incluirOcultas: Boolean(incluirOcultas) })
  }
  if (r('/importaciones/analizar', 'POST')) {
    exigir(rol, 'importaciones.realizar')
    await espera(300)
    const a = analizar(body.hojas, { categorias: categoriasConOcultas(), alias: alias(), perfiles: perfiles(), existentes: db.movimientos, forzarHoja: body.hoja ?? null })
    return copia({ ...a, alias: alias() })
  }
  if (r('/importaciones/validar', 'POST')) {
    exigir(rol, 'importaciones.realizar')
    await espera(450)
    return copia(revisar(body))
  }
  if (r('/importaciones/perfiles')) {
    exigir(rol, 'importaciones.realizar')
    return copia(perfiles())
  }
  if ((p = r('/importaciones/perfiles/:id', 'DELETE'))) {
    exigir(rol, 'importaciones.realizar')
    db.perfilesImportacion = perfiles().filter((x) => x.id !== p.id)
    return fin({ ok: true })
  }
  if (r('/importaciones', 'POST')) {
    exigir(rol, 'importaciones.realizar')
    const repetida = body.client_request_id && importaciones().find((x) => x.client_request_id === body.client_request_id)
    if (repetida) return copia(repetida)
    const { filas, ignoradas } = revisar(body)
    if (filas.length > MAX_FILAS) throw new ApiError(413, 'demasiadas_filas', `La planilla tiene más de ${MAX_FILAS.toLocaleString('es-CL')} filas.`)
    const excluidas = new Set(body.excluidas ?? [])
    const validas = filas.filter((f) => f.datos && !excluidas.has(f.key))
    if (!validas.length) throw new ApiError(422, 'sin_filas_validas', 'No hay filas válidas para importar.')
    await espera(600)
    // Formato propio: se recuerda (o se actualiza) para reconocerlo la próxima vez
    let formato = null
    const principal = body.hojas[body.seleccion[0]]
    if (!body.mapeo.plantilla) {
      Object.assign(alias(), aliasNuevos(body.mapeo, db.categorias))
      const h = huella(principal.filas[body.mapeo.encabezado])
      const config = { ...body.mapeo }
      delete config.catValores // las categorías se recuerdan aparte (alias), para toda la empresa
      delete config.encabezado // la fila del encabezado se busca por la huella
      delete config.origen
      delete config.ambiguo
      // Con id: el formato que se reconoció (o que se está corrigiendo). Sin id: uno nuevo, si se pidió.
      let perfil = body.perfil?.id ? perfiles().find((x) => x.id === body.perfil.id) : body.perfil?.guardar ? perfiles().find((x) => x.huella === h) : null
      if (perfil)
        Object.assign(perfil, { huella: h, mapeo: config, usos: perfil.usos + 1, usado_en: new Date().toISOString(), ...(body.perfil.guardar && body.perfil.nombre ? { nombre: body.perfil.nombre } : {}) })
      else if (body.perfil?.guardar) {
        perfil = { id: nuevoId(), nombre: body.perfil.nombre || 'Mi planilla', huella: h, mapeo: config, usos: 1, creado_por: yo.nombre, creado_en: new Date().toISOString(), usado_en: new Date().toISOString() }
        perfiles().unshift(perfil)
      }
      formato = perfil?.nombre ?? 'Planilla propia'
    }
    const conError = filas.filter((f) => !f.datos).length
    const imp = {
      id: nuevoId(),
      client_request_id: body.client_request_id ?? null,
      nombre_archivo: body.nombre,
      tipo_archivo: body.tipo,
      formato: formato ?? 'Plantilla KontadorIA',
      hojas: body.seleccion.map((i) => body.hojas[i].nombre),
      usuario_id: yo.id,
      usuario_nombre: yo.nombre,
      total_filas: filas.length,
      filas_importadas: validas.length,
      filas_con_error: conError,
      filas_excluidas: filas.length - validas.length - conError, // duplicados o filas que el usuario quitó
      filas_omitidas: ignoradas.length, // totales, saldos, títulos, ocultas
      estado: conError ? 'completada_con_errores' : 'completada',
      creado_en: new Date().toISOString(),
      anulada_en: null,
    }
    importaciones().unshift(imp)
    for (const f of validas)
      db.movimientos.push({
        ...f.datos,
        id: nuevoId(),
        client_request_id: null,
        origen: 'importacion_masiva',
        importacion_id: imp.id,
        huella_importacion: f.huella, // re-subir el mismo archivo no duplica nada
        fila_origen: f.n,
        documento: null,
        usuario_id: yo.id,
        usuario_nombre: yo.nombre,
        creado_en: imp.creado_en,
        eliminado: false,
      })
    return fin(imp)
  }
  if (r('/importaciones')) {
    exigir(rol, 'importaciones.ver')
    return copia(importaciones())
  }
  if ((p = r('/importaciones/:id/anular', 'POST'))) {
    exigir(rol, 'importaciones.anular')
    const imp = importaciones().find((x) => x.id === p.id)
    if (!imp) throw noEncontrado()
    if (imp.anulada_en) throw new ApiError(409, 'ya_anulada', 'Esta importación ya está anulada.')
    for (const m of db.movimientos) if (m.importacion_id === imp.id) m.eliminado = true
    Object.assign(imp, { anulada_en: new Date().toISOString(), anulada_por: yo.nombre })
    return fin(imp)
  }
  if ((p = r('/importaciones/:id/restaurar', 'POST'))) {
    exigir(rol, 'importaciones.anular')
    const imp = importaciones().find((x) => x.id === p.id)
    if (!imp) throw noEncontrado()
    for (const m of db.movimientos) if (m.importacion_id === imp.id) m.eliminado = false
    Object.assign(imp, { anulada_en: null, anulada_por: null })
    return fin(imp)
  }

  // ---------- Empresa (HU04) ----------
  if (r('/empresas/actual')) return { empresa: copia(db.empresa) }
  if (r('/empresas/actual', 'PUT')) {
    exigir(rol, 'empresa.editar')
    Object.assign(db.empresa, body)
    return fin({ empresa: db.empresa })
  }

  // ---------- Equipo (HU02) ----------
  if (r('/usuarios')) {
    exigir(rol, 'usuarios.ver')
    return copia(db.usuarios)
  }
  if ((p = r('/usuarios/:id/:campo', 'PUT'))) {
    exigir(rol, 'usuarios.gestionar')
    const u = db.usuarios.find((x) => x.id === p.id)
    if (!u) throw noEncontrado()
    Object.assign(u, body)
    return fin(u)
  }
  if (r('/invitaciones'))
    return copia(db.invitaciones.filter((x) => x.estado !== 'usada').map((x) => ({ ...x, token: undefined, estado: vigencia(x) })))
  if (r('/invitaciones', 'POST')) {
    exigir(rol, 'usuarios.gestionar')
    // Un link nuevo anula el anterior para el mismo correo (igual que el backend)
    db.invitaciones = db.invitaciones.filter((x) => x.estado === 'usada' || x.email.toLowerCase() !== body.email.toLowerCase())
    const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('')
    const inv = {
      id: nuevoId(),
      token,
      email: body.email,
      rol: body.rol,
      estado: 'pendiente',
      expira_en: new Date(Date.now() + 72 * 3600e3).toISOString(),
      invitado_por: yo.nombre,
    }
    db.invitaciones.push(inv)
    return fin({ invitacion: { ...inv, token: undefined }, token })
  }
  if ((p = r('/invitaciones/:id', 'DELETE'))) {
    db.invitaciones = db.invitaciones.filter((x) => x.id !== p.id)
    return fin(null)
  }

  throw new ApiError(404, 'no_existe', `El prototipo no simula ${method} ${ruta}.`)
}
