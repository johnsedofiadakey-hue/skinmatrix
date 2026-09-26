import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ArrowRight, ArrowUpRight, Camera, Mail, Menu, MessageCircle, Phone, Plus, ShoppingBag, X } from 'lucide-react'
import { canBuy, DEFAULT_PRODUCTS, formatGhs, mergeCatalog, mergeContent } from './cloud/site.js'

// Shared by every public page: website content (from the admin editor), the cart, header, footer and cart panel.

// Web icons (Lucide). Each sits in a span so the existing CSS hooks (e.g. `.button span`) still apply.
export const ICON = { size: '1em', strokeWidth: 1.75, 'aria-hidden': true, focusable: false }
export function Arrow() { return <span className="icon-wrap" aria-hidden="true"><ArrowUpRight {...ICON} /></span> }
export function ArrowNext() { return <span className="icon-wrap" aria-hidden="true"><ArrowRight {...ICON} /></span> }
export function AddIcon() { return <Plus {...ICON} /> }

// The hero shelf keeps the original four product photos whatever the catalog says.
export const heroProducts = DEFAULT_PRODUCTS

export function ProductVisual({ product, className = '' }) {
  return <div className={`brand-product-visual ${className}`} aria-hidden="true"><div className="product-halo" />{product.image ? <img src={product.image} alt="" referrerPolicy="no-referrer" /> : null}</div>
}

export function priceLabel(product) {
  return product.price ? formatGhs(product.price) : 'Price coming soon'
}

export function buyLabel(product, inCart = 0) {
  if (!product.inStock) return 'Out of stock'
  if (!product.price) return 'Coming soon'
  return inCart ? `In cart (${inCart}) · Add one more` : 'Add to cart'
}

// ---- Content + cart --------------------------------------------------------------------------------

const SITE_CACHE = 'skinmatrix-site'
const CART_KEY = 'skinmatrix-cart'

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode: kept for this page only */ }
}

async function loadSite() {
  const [{ doc, getDoc }, { db }] = await Promise.all([import('firebase/firestore/lite'), import('./cloud/firebase.js')])
  const [content, catalog] = await Promise.all([getDoc(doc(db, 'site', 'content')), getDoc(doc(db, 'site', 'catalog'))])
  return { content: content.exists() ? content.data() : null, catalog: catalog.exists() ? catalog.data() : null }
}

const SiteContext = createContext(null)

export function SiteProvider({ children }) {
  // Show the last saved content straight away, then refresh it from the database.
  const [saved, setSaved] = useState(() => readJson(SITE_CACHE) || { content: null, catalog: null })
  const [cart, setCart] = useState(() => {
    const stored = readJson(CART_KEY)
    return stored && typeof stored === 'object' ? stored : {}
  })
  // Checkout slides in from the side: step 0 cart, 1 details, 2 review and pay, 3 done. /checkout opens it.
  const [checkout, setCheckout] = useState(() => ({ open: window.location.pathname.replace(/\/+$/, '') === '/checkout', step: 0 }))
  // The product being looked at, kept in the address (?product=id) so it can be shared and Back closes it.
  const [productId, setProductId] = useState(() => new URLSearchParams(window.location.search).get('product'))

  useEffect(() => {
    let live = true
    loadSite().then((next) => { if (live) { setSaved(next); writeJson(SITE_CACHE, next) } }).catch(() => { /* offline or blocked: keep what we have */ })
    return () => { live = false }
  }, [])
  useEffect(() => { writeJson(CART_KEY, cart) }, [cart])
  useEffect(() => {
    const onPop = () => setProductId(new URLSearchParams(window.location.search).get('product'))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const content = useMemo(() => mergeContent(saved.content), [saved.content])
  // Local testing only (removed from the live build): localStorage 'skinmatrix-dev-catalog' = { products: [...] }.
  const devCatalog = import.meta.env.DEV ? readJson('skinmatrix-dev-catalog') : null
  const products = useMemo(() => mergeCatalog(devCatalog || saved.catalog), [devCatalog ? JSON.stringify(devCatalog) : '', saved.catalog]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => products.filter((product) => product.visible), [products])

  // Only products that can still be bought count; a product that went out of stock drops out of the cart.
  const count = shown.reduce((sum, product) => sum + (canBuy(product) ? cart[product.id] || 0 : 0), 0)
  const setQty = useCallback((id, qty) => setCart((items) => {
    const next = { ...items }
    if (qty > 0) next[id] = Math.min(20, qty)
    else delete next[id]
    return next
  }), [])
  const add = useCallback((product, qty = 1) => {
    if (!canBuy(product)) return
    setCart((items) => ({ ...items, [product.id]: Math.min(20, (items[product.id] || 0) + qty) }))
  }, [])
  const clear = useCallback(() => setCart({}), [])

  const openProduct = useCallback((id) => {
    const url = new URL(window.location.href)
    url.searchParams.set('product', id)
    if (new URLSearchParams(window.location.search).get('product')) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
    setProductId(id)
  }, [])
  const closeProduct = useCallback(() => {
    if (!new URLSearchParams(window.location.search).get('product')) { setProductId(null); return }
    const url = new URL(window.location.href)
    url.searchParams.delete('product')
    window.history.replaceState(null, '', url)
    setProductId(null)
  }, [])

  const value = {
    content, products: shown, cart, count, add, setQty, clear,
    cartOpen: checkout.open, checkoutStep: checkout.step,
    openCart: (step = 0) => setCheckout({ open: true, step: Number.isInteger(step) ? step : 0 }),
    setCheckoutStep: (step) => setCheckout((state) => ({ ...state, step })),
    closeCart: () => setCheckout((state) => ({ open: false, step: state.step === 3 ? 0 : state.step })),
    product: productId ? shown.find((item) => item.id === productId) || null : null,
    openProduct, closeProduct,
  }
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>
}

export const useSite = () => useContext(SiteContext)

// ---- Header and footer ----------------------------------------------------------------------

// `base` is '' on the home page (in-page links) and '/' on other pages (links back to home page sections).
export function SiteHeader({ base = '' }) {
  const { count, openCart } = useSite()
  const [menuOpen, setMenuOpen] = useState(false)
  const close = () => setMenuOpen(false)
  const links = [
    { href: '/shop', label: 'Shop' },
    { href: `${base}#concerns`, label: 'Find by need' },
    { href: `${base}#edit`, label: 'Brands' },
  ]
  return <header className="site-header">
    <a href={base ? '/' : '#top'} className="brand"><img src="/assets/skinmatrix-logo.png" alt="SkinMatrix home" /></a>
    <nav aria-label="Main">{links.map((link) => <a key={link.label} href={link.href}>{link.label}</a>)}</nav>
    <div className="header-actions">
      <button className="cart-button" onClick={() => openCart()} aria-label={`Open cart, ${count} ${count === 1 ? 'item' : 'items'}`}><ShoppingBag {...ICON} /> <span className="cart-word">Cart</span> <sup>{count}</sup></button>
      <button className="menu" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}>{menuOpen ? <X {...ICON} /> : <Menu {...ICON} />}</button>
    </div>
    <div className={`mobile-nav ${menuOpen ? 'open' : ''}`} aria-hidden={!menuOpen}>
      {links.map((link) => <a key={link.label} href={link.href} onClick={close}>{link.label}</a>)}
      <button onClick={() => { openCart(); close() }}>Cart ({count})</button>
    </div>
  </header>
}

const whatsappLink = (number) => {
  const digits = String(number || '').replace(/\D/g, '')
  if (!digits) return null
  return `https://wa.me/${digits.startsWith('0') ? `233${digits.slice(1)}` : digits}`
}

// Links typed into the admin editor: only web links, never javascript: or data: URLs.
const webLink = (text) => (/^https:\/\/[^\s"'<>]+$/i.test(String(text || '').trim()) ? String(text).trim() : null)

export function SiteFooter() {
  const { content } = useSite()
  const { shop } = content
  const wa = whatsappLink(shop.whatsapp)
  const instagram = webLink(shop.instagram)
  return <footer className="site-footer">
    <div className="footer-top">
      <a href="/" className="footer-logo"><img src="/assets/skinmatrix-logo.png" alt="SkinMatrix home" /></a>
      <nav className="footer-links" aria-label="Footer">
        <a href="/shop">Shop</a>
        <a href="/terms">Terms and conditions</a>
        <a href="/terms#returns-and-refunds">Returns and refunds</a>
      </nav>
      <div className="footer-contact">
        {shop.phone ? <a href={`tel:${shop.phone.replace(/\s/g, '')}`}><Phone {...ICON} /> {shop.phone}</a> : null}
        {wa ? <a href={wa} target="_blank" rel="noreferrer"><MessageCircle {...ICON} /> WhatsApp</a> : null}
        {shop.email ? <a href={`mailto:${shop.email}`}><Mail {...ICON} /> {shop.email}</a> : null}
        {instagram ? <a href={instagram} target="_blank" rel="noreferrer"><Camera {...ICON} /> Instagram</a> : null}
        {shop.address ? <span>{shop.address}</span> : null}
      </div>
    </div>
    <div className="footer-bottom">
      <small>© {new Date().getFullYear()} {shop.legalName || 'SkinMatrix'}. Skincare and supplements.</small>
      <a className="footer-staff" href="/admin/">Staff login</a>
    </div>
  </footer>
}
