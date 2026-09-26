import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ShopPage from './ShopPage'
import TermsPage from './TermsPage'
import CheckoutDrawer from './Checkout'
import ProductSheet from './ProductSheet'
import { SiteProvider } from './storefront'
import './styles.css'
import './overrides.css'
import './shop-panel.css'
import './brand-products.css'
import './shop-page.css'
import './site-pages.css'
import './panels.css'

// One bundle, several pages (Firebase rewrites every path here). Anything unknown shows the home page.
// /checkout is the shop with the checkout panel already open. Product details and checkout slide over every page.
const PAGES = { '/shop': ShopPage, '/checkout': ShopPage, '/terms': TermsPage }
const Page = PAGES[window.location.pathname.replace(/\/+$/, '')] || App

createRoot(document.getElementById('root')).render(
  <StrictMode><SiteProvider><Page /><ProductSheet /><CheckoutDrawer /></SiteProvider></StrictMode>,
)
