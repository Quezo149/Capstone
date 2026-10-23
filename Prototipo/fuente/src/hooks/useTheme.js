import { useEffect, useState } from 'react'

const STORAGE_KEY = 'kontadoria-theme'
const QUERY = '(prefers-color-scheme: dark)'

function readSaved() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    // localStorage puede estar bloqueado (modo privado, etc.)
  }
  return null
}

// theme === null significa "sin elección manual": manda prefers-color-scheme.
export default function useTheme() {
  const [theme, setTheme] = useState(readSaved)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(QUERY).matches)

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const onChange = (e) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (theme) root.setAttribute('data-theme', theme)
    else root.removeAttribute('data-theme')
  }, [theme])

  const dark = theme ? theme === 'dark' : systemDark

  function toggle() {
    const next = dark ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // sin persistencia: el tema igual cambia durante la sesión
    }
  }

  return { dark, toggle }
}
