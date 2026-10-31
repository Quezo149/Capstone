import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { cerrarSesion, configurado, iniciarMsal, iniciarSesion } from '../auth/msal'
import { api, ApiError } from '../lib/api'

// La API corre en Azure Functions y la base es Azure SQL serverless: si nadie la usó en un rato,
// la primera llamada puede tardar hasta un par de minutos (la Function arranca en frío y la base
// despierta de su pausa) o fallar con 503/504. Esos errores se reintentan solos, sin mostrarle
// "No pudimos cargar tu cuenta" a quien recién inició sesión.
const ESPERA_MAXIMA = 3 * 60 * 1000
const transitorio = (e) => e instanceof ApiError && [0, 502, 503, 504].includes(e.status)
const pausa = (ms) => new Promise((r) => setTimeout(r, ms))

// Estado de la sesión, de punta a punta:
//   cargando     → procesando la vuelta desde Entra / preguntando a la API quién soy
//   sin_config   → faltan las variables VITE_ENTRA_* (solo pasa en desarrollo)
//   anonimo      → no hay sesión: pantalla de acceso
//   sin_empresa  → primera vez: registrar la empresa (HU17)
//   desactivado  → el admin le quitó el acceso (HU01)
//   politica_pendiente → la cuenta no ha aceptado la versión vigente de la política de privacidad
//   error        → la API no respondió como se esperaba
//   listo        → `perfil` tiene rol y empresa: se muestra la app
const SesionContext = createContext(null)

export function SesionProvider({ children }) {
  const [estado, setEstado] = useState(configurado ? 'cargando' : 'sin_config')
  const [perfil, setPerfil] = useState(null)
  const [error, setError] = useState(null)

  const refrescar = useCallback(async () => {
    try {
      const limite = Date.now() + ESPERA_MAXIMA
      let espera = 2000
      for (;;) {
        try {
          setPerfil(await api('/auth/me'))
          break
        } catch (e) {
          if (!transitorio(e) || Date.now() + espera > limite) throw e
          await pausa(espera)
          espera = Math.min(espera * 1.5, 10000)
        }
      }
      setEstado('listo')
    } catch (e) {
      if (e instanceof ApiError && e.codigo === 'sin_empresa') setEstado('sin_empresa')
      else if (e instanceof ApiError && e.codigo === 'usuario_desactivado') setEstado('desactivado')
      else if (e instanceof ApiError && e.codigo === 'politica_pendiente') setEstado('politica_pendiente')
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

  // Botón "Reintentar" de la pantalla de error: vuelve a la pantalla de carga mientras tanto
  const reintentar = useCallback(() => {
    setEstado('cargando')
    return refrescar()
  }, [refrescar])

  const valor = useMemo(
    () => ({ estado, perfil, error, refrescar, reintentar, puede, entrar: iniciarSesion, salir: cerrarSesion }),
    [estado, perfil, error, refrescar, reintentar, puede],
  )
  return <SesionContext.Provider value={valor}>{children}</SesionContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useSesion = () => useContext(SesionContext)
