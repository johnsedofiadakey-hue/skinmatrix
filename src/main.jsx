import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ShopPage from './ShopPage'
import './styles.css'
import './overrides.css'
import './shop-panel.css'
import './brand-products.css'
import './shop-page.css'

// Two pages on one bundle: /shop is the shop, everything else is the home page (Firebase rewrites both here).
const isShop = /^\/shop\/?$/.test(window.location.pathname)

createRoot(document.getElementById('root')).render(
  <StrictMode>{isShop ? <ShopPage /> : <App />}</StrictMode>,
)
