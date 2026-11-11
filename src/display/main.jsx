import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Display from './Display.jsx'
import './display.css'

createRoot(document.getElementById('root')).render(<StrictMode><Display /></StrictMode>)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' }).catch(() => {}) })
}
