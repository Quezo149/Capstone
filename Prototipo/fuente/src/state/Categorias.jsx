import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'

// Categorías de la empresa (HU14): predefinidas + propias, desde GET /categorias.
// Crear, editar y eliminar solo los ve el admin; el backend lo exige igual (403).
const Ctx = createContext(null)

const SIN_CATEGORIA = { nombre: 'Sin categoría', tipo: 'gasto', color: '#7d8d87', predefinida: true }

const ordenar = (lista) =>
  [...lista].sort((a, b) => b.tipo.localeCompare(a.tipo) || b.predefinida - a.predefinida || a.nombre.localeCompare(b.nombre, 'es'))

export function CategoriasProvider({ children }) {
  const [lista, setLista] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api('/categorias')
      .then((l) => setLista(l))
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false))
  }, [])

  const porId = useMemo(() => Object.fromEntries(lista.map((c) => [c.id, c])), [lista])
  const categoria = useCallback((id) => porId[id] ?? { ...SIN_CATEGORIA, id }, [porId])
  const categoriasDe = useCallback((tipo) => lista.filter((c) => c.tipo === tipo), [lista])

  const crear = useCallback(async (datos) => {
    const c = await api('/categorias', { method: 'POST', body: datos })
    setLista((l) => ordenar([...l, c]))
    return c
  }, [])

  const editar = useCallback(async (id, datos) => {
    const c = await api(`/categorias/${id}`, { method: 'PUT', body: datos })
    setLista((l) => ordenar(l.map((x) => (x.id === id ? c : x))))
    return c
  }, [])

  const eliminar = useCallback(async (id) => {
    await api(`/categorias/${id}`, { method: 'DELETE' })
    setLista((l) => l.filter((x) => x.id !== id))
  }, [])

  const value = useMemo(
    () => ({ categorias: lista, cargando, error, categoria, categoriasDe, crear, editar, eliminar }),
    [lista, cargando, error, categoria, categoriasDe, crear, editar, eliminar],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCategorias() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCategorias va dentro de <CategoriasProvider>')
  return v
}
