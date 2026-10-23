import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { cerrarSesion, configurado, iniciarMsal, iniciarSesion } from '../auth/msal'
import { api, ApiError } from '../lib/api'

// Estado de la sesión, de punta a punta:
//   cargando     → procesando la vuelta desde Entra / preguntando a la API quién soy
//   sin_config   → faltan las variables VITE_ENTRA_* (solo pasa en desarrollo)
//   anonimo      → no hay sesión: pantalla de acceso
//   sin_empresa  → primera vez: registrar la empresa (HU17)
//   desactivado  → el admin le quitó el acceso (HU01)
//   error        → la API no respondió como se esperaba
//   listo        → `perfil` tiene rol y empresa: se muestra la app
const SesionContext = createContext(null)

export function SesionProvider({ children }) {
  const [estado, setEstado] = useState(configurado ? 'cargando' : 'sin_config')
  const [perfil, setPerfil] = useState(null)
  const [error, setError] = useState(null)

  const refrescar = useCallback(async () => {
    try {
      setPerfil(await api('/auth/me'))
      setEstado('listo')
    } catch (e) {
      if (e instanceof ApiError && e.codigo === 'sin_empresa') setEstado('sin_empresa')
      else if (e instanceof ApiError && e.codigo === 'usuario_desactivado') setEstado('desactivado')
      else if (e instanceof ApiError && e.status === 401) setEstado('anonimo')
      else {
        setError(e instanceof ApiError ? e.message : 'No pudimos validar tu sesión.')
        setEstado('error')
      }
    }
  }, [])

  useEffect(() => {
    if (!configurado) return
    let vivo = true
    iniciarMsal()
      .then((cuenta) => {
        if (!vivo) return
        if (cuenta) refrescar()
        else setEstado('anonimo')
      })
      .catch((e) => {
        // Por ejemplo: el usuario canceló en la página de Entra, o volvió con un error
        console.error(e)
        if (vivo) setEstado('anonimo')
      })
    return () => {
      vivo = false
    }
  }, [refrescar])

  // HU03: los permisos los calcula el backend a partir del rol (GET /auth/me). La pantalla solo
  // oculta lo que el rol no puede hacer; la regla de verdad se aplica en el servidor.
  const puede = useCallback((permiso) => Boolean(perfil?.permisos?.includes(permiso)), [perfil])

  const valor = useMemo(
    () => ({ estado, perfil, error, refrescar, puede, entrar: iniciarSesion, salir: cerrarSesion }),
    [estado, perfil, error, refrescar, puede],
  )
  return <SesionContext.Provider value={valor}>{children}</SesionContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useSesion = () => useContext(SesionContext)
