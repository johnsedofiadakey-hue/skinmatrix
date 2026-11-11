import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import AdminApp from './AdminApp.jsx'
import './admin.css'
import './pos.css'
import { applyTheme } from './theme.js'

applyTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode><AdminApp /></StrictMode>,
)

// Keeps the shop system on this device so the till can start and reload with no internet (src/admin/sw-template.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' }).catch(() => {}) })
}
