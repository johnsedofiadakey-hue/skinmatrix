import { createContext, useContext, useEffect, useState } from 'react'

// Kept apart from OpsContext.jsx so that file exports only a component and Vite Fast Refresh keeps working.
export const OpsContext = createContext(null)

export function useOps() {
  const value = useContext(OpsContext)
  if (!value) throw new Error('useOps must be used inside OpsProvider')
  return value
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export function useHashRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [parts, setParts] = useState(read)
  useEffect(() => {
    const onChange = () => { setParts(read()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return parts
}
