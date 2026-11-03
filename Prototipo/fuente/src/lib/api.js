// PROTOTIPO: misma firma que frontend/src/lib/api.js, pero responde desde lib/proto.js en vez
// de llamar a func-kontadoria. Imita las reglas del backend que se notan en pantalla:
// permisos por rol (app/core/permisos.py), RLS del empleado e idempotencia.
import { leerDb, guardarDb, nuevoId, PERSONAS, rolActual } from './proto'
import { revisarEstructura, validar } from './importacion'

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
  const rol = rolActual()
  const yo = PERSONAS[rol]
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

  // ---------- Importaciones (HU10–HU13) ----------
  // validar no escribe nada (vista previa, HU12). Confirmar vuelve a validar el archivo completo
  // en el "servidor" y guarda todo junto: la importación y sus movimientos válidos.
  const revisar = (filas) => {
    const estructura = revisarEstructura(filas)
    if (!estructura.ok) return { estructura, filas: [] }
    const r = validar(filas, estructura, { categorias: db.categorias, existentes: db.movimientos })
    return { estructura, filas: r.filas }
  }
  const importaciones = () => (db.importaciones ??= [])
  if (r('/importaciones/validar', 'POST')) {
    exigir(rol, 'importaciones.realizar')
    await espera(700)
    return copia(revisar(body.filas))
  }
  if (r('/importaciones', 'POST')) {
    exigir(rol, 'importaciones.realizar')
    const repetida = body.client_request_id && importaciones().find((x) => x.client_request_id === body.client_request_id)
    if (repetida) return copia(repetida)
    const { estructura, filas } = revisar(body.filas)
    if (!estructura.ok) throw new ApiError(422, 'estructura_invalida', 'El archivo no usa la estructura de la plantilla.')
    if (filas.length > 2000) throw new ApiError(413, 'demasiadas_filas', 'La planilla tiene más de 2.000 filas.')
    const validas = filas.filter((f) => f.datos)
    if (!validas.length) throw new ApiError(422, 'sin_filas_validas', 'No hay filas válidas para importar.')
    await espera(600)
    const imp = {
      id: nuevoId(),
      client_request_id: body.client_request_id ?? null,
      nombre_archivo: body.nombre,
      tipo_archivo: body.tipo,
      usuario_id: yo.id,
      usuario_nombre: yo.nombre,
      total_filas: filas.length,
      filas_importadas: validas.length,
      filas_con_error: filas.length - validas.length,
      estado: validas.length === filas.length ? 'completada' : 'completada_con_errores',
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
  if (r('/invitaciones')) return copia(db.invitaciones)
  if (r('/invitaciones', 'POST')) {
    exigir(rol, 'usuarios.gestionar')
    const inv = {
      id: nuevoId(),
      email: body.email,
      rol: body.rol,
      estado: 'pendiente',
      expira_en: new Date(Date.now() + 72 * 3600e3).toISOString(),
      invitado_por: yo.nombre,
    }
    db.invitaciones.push(inv)
    return fin({ invitacion: inv, token: 'prototipo-sin-token-real' })
  }
  if ((p = r('/invitaciones/:id', 'DELETE'))) {
    db.invitaciones = db.invitaciones.filter((x) => x.id !== p.id)
    return fin(null)
  }

  throw new ApiError(404, 'no_existe', `El prototipo no simula ${method} ${ruta}.`)
}
