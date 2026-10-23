// PROTOTIPO: misma firma que frontend/src/lib/api.js, pero responde desde lib/proto.js en vez
// de llamar a func-kontadoria. Imita las reglas del backend que se notan en pantalla:
// permisos por rol (app/core/permisos.py), RLS del empleado e idempotencia.
import { leerDb, guardarDb, nuevoId, PERSONAS, rolActual } from './proto'

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
  if (r('/categorias')) return copia(db.categorias)
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
