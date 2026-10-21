import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as repo from '../data/movimientos'
import { useCategorias } from './Categorias'

// Estado global de movimientos. Las vistas solo usan useMovimientos(); no hablan con la API.
const Ctx = createContext(null)

// Orden: más reciente primero; a igual fecha, el último creado arriba
const ordenar = (lista) =>
  [...lista].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado_en.localeCompare(a.creado_en))

export function MovimientosProvider({ children }) {
  const { categorias } = useCategorias()
  const [movs, setMovs] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
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

  const cargar = useCallback(
    () =>
      repo
        .listar()
        .then((l) => {
          setMovs(ordenar(l))
          setError(null)
        })
        .catch((e) => setError(e.message))
        .finally(() => setCargando(false)),
    [],
  )

  useEffect(() => {
    cargar()
  }, [cargar])

  // Botón "Reintentar" cuando la carga falló
  const recargar = useCallback(() => {
    setCargando(true)
    return cargar()
  }, [cargar])

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
    await repo.eliminar(id)
    setMovs((l) => l.filter((m) => m.id !== id))
    return borrado
  }, [])

  const restaurar = useCallback(async (mov) => {
    const vuelto = await repo.restaurar(mov.id)
    setMovs((l) => ordenar([...l.filter((m) => m.id !== vuelto.id), vuelto]))
    setTocado(vuelto.id)
  }, [])

  const cargarEjemplo = useCallback(async () => {
    setMovs(ordenar(await repo.cargarEjemplo(categorias)))
  }, [categorias])

  const borrarTodo = useCallback(async () => {
    await repo.borrarTodo(movsRef.current)
    setMovs([])
  }, [])

  const value = useMemo(
    () => ({ movs, cargando, error, recargar, tocado, crear, actualizar, eliminar, restaurar, cargarEjemplo, borrarTodo }),
    [movs, cargando, error, recargar, tocado, crear, actualizar, eliminar, restaurar, cargarEjemplo, borrarTodo],
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
