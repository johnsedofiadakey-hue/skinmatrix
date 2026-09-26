import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './overrides.css'
import './shop-panel.css'
import './brand-products.css'

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>,
)
