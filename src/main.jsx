import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ShopPage from './ShopPage'
import CheckoutPage from './CheckoutPage'
import TermsPage from './TermsPage'
import { SiteProvider } from './storefront'
import './styles.css'
import './overrides.css'
import './shop-panel.css'
import './brand-products.css'
import './shop-page.css'
import './site-pages.css'

// One bundle, several pages (Firebase rewrites every path here). Anything unknown shows the home page.
const PAGES = { '/shop': ShopPage, '/checkout': CheckoutPage, '/terms': TermsPage }
const Page = PAGES[window.location.pathname.replace(/\/+$/, '')] || App

createRoot(document.getElementById('root')).render(
  <StrictMode><SiteProvider><Page /></SiteProvider></StrictMode>,
)
