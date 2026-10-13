import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as repo from '../data/movimientos'

// Estado global de movimientos. Las vistas solo usan useMovimientos(); no saben
// si los datos vienen de localStorage o de la API.
const Ctx = createContext(null)

// Orden: más reciente primero; a igual fecha, el último creado arriba
const ordenar = (lista) =>
  [...lista].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado_en.localeCompare(a.creado_en))

export function MovimientosProvider({ children }) {
  const [movs, setMovs] = useState([])
  const [cargando, setCargando] = useState(true)
  // Último movimiento creado o editado: la tabla lo resalta con un destello
  const [tocado, setTocado] = useState(null)
  // Copia sincrónica de la lista, para leerla dentro de callbacks sin depender de `movs`
  const movsRef = useRef(movs)
  useEffect(() => {
    movsRef.current = movs
  }, [movs])

  useEffect(() => {
    if (!tocado) return
    const t = setTimeout(() => setTocado(null), 2000)
    return () => clearTimeout(t)
  }, [tocado])

  useEffect(() => {
    repo.listar().then((l) => {
      setMovs(ordenar(l))
      setCargando(false)
    })
  }, [])

  const crear = useCallback(async (datos) => {
    const mov = await repo.crear(datos)
    setMovs((l) => (l.some((m) => m.id === mov.id) ? l : ordenar([...l, mov])))
    setTocado(mov.id)
    return mov
  }, [])

  const actualizar = useCallback(async (id, cambios) => {
    const mov = await repo.actualizar(id, cambios)
    setMovs((l) => ordenar(l.map((m) => (m.id === id ? mov : m))))
    setTocado(id)
    return mov
  }, [])

  const eliminar = useCallback(async (id) => {
    const borrado = movsRef.current.find((m) => m.id === id)
    setMovs((l) => l.filter((m) => m.id !== id))
    await repo.eliminar(id)
    return borrado
  }, [])

  const restaurar = useCallback(async (mov) => {
    await repo.restaurar(mov)
    setMovs((l) => ordenar([...l.filter((m) => m.id !== mov.id), mov]))
    setTocado(mov.id)
  }, [])

  const cargarEjemplo = useCallback(async () => {
    setMovs(ordenar(await repo.cargarEjemplo()))
  }, [])

  const borrarTodo = useCallback(async () => {
    await repo.borrarTodo()
    setMovs([])
  }, [])

  const value = useMemo(
    () => ({ movs, cargando, tocado, crear, actualizar, eliminar, restaurar, cargarEjemplo, borrarTodo }),
    [movs, cargando, tocado, crear, actualizar, eliminar, restaurar, cargarEjemplo, borrarTodo],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMovimientos() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useMovimientos va dentro de <MovimientosProvider>')
  return v
}

// Totales de un mes 'AAAA-MM' (o de toda la lista si ym es null)
// eslint-disable-next-line react-refresh/only-export-components
export function totales(movs, ym = null) {
  let ingresos = 0
  let gastos = 0
  for (const m of movs) {
    if (ym && !m.fecha.startsWith(ym)) continue
    if (m.tipo === 'ingreso') ingresos += m.monto
    else gastos += m.monto
  }
  return { ingresos, gastos, resultado: ingresos - gastos }
}
