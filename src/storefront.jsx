import { useEffect, useState } from 'react'

// Shared by the home page and the /shop page.

export const products = [
  { no: '01', name: 'Collagen Beauty Builder', brand: 'NeoCell', category: 'Inside', type: 'Beauty support', note: 'Collagen · A.L.A. · biotin', price: 'Catalogue price coming soon', tone: 'neocell', image: '/assets/products/neocell-collagen-beauty-builder.png' },
  { no: '02', name: 'Magnesium Glycinate', brand: 'NOW', category: 'Inside', type: 'Daily support', note: 'Magnesium glycinate · 180 tablets', price: 'Catalogue price coming soon', tone: 'magnesium', image: '/assets/products/now-magnesium-glycinate.png' },
  { no: '03', name: 'Wellwoman 50+', brand: 'Vitabiotics', category: 'Inside', type: "Women's wellbeing", note: '26 nutrients · 50+', price: 'Catalogue price coming soon', tone: 'wellwoman', image: '/assets/products/wellwoman-50-plus.png' },
  { no: '04', name: 'Niacinamide 10 + TXA 4 Serum', brand: 'Anua', category: 'On the surface', type: 'Targeted skincare', note: 'Niacinamide serum · 30 ml', price: 'Catalogue price coming soon', tone: 'anua', image: '/assets/products/anua-niacinamide-10-txa-4.png' },
]

export function Arrow() { return <span aria-hidden="true">↗</span> }

function ProductObject({ tone, large = false }) {
  return <div className={`product-object ${tone} ${large ? 'large' : ''}`} aria-hidden="true">
    <i className="orb orb-a" /><i className="orb orb-b" /><i className="capsule" />
    <div className="bottle"><div className="bottle-cap" /><div className="bottle-label">SKIN<br />MATRIX</div></div>
  </div>
}

export function ProductVisual({ product, className = '' }) {
  if (!product.image) return <ProductObject tone={product.tone} />
  return <div className={`brand-product-visual ${product.tone} ${className}`} aria-hidden="true"><div className="product-halo" /><img src={product.image} alt="" referrerPolicy="no-referrer" /></div>
}

// The bag is kept in this browser so it survives moving between the home page and /shop.
const BAG_KEY = 'skinmatrix-bag'

function readBag() {
  try {
    const saved = JSON.parse(localStorage.getItem(BAG_KEY) || '{}')
    return saved && typeof saved === 'object' ? saved : {}
  } catch {
    return {}
  }
}

export function useBag() {
  const [bag, setBag] = useState(readBag)
  useEffect(() => {
    try { localStorage.setItem(BAG_KEY, JSON.stringify(bag)) } catch { /* private mode: the bag lasts for this page only */ }
  }, [bag])
  const count = products.reduce((sum, product) => sum + (bag[product.name] || 0), 0)
  const add = (product) => setBag((items) => ({ ...items, [product.name]: (items[product.name] || 0) + 1 }))
  const remove = (name) => setBag((items) => {
    const next = { ...items }
    const left = Math.max(0, (items[name] || 1) - 1)
    if (left) next[name] = left
    else delete next[name]
    return next
  })
  return { bag, count, add, remove }
}

// `base` is '' on the home page (in-page anchors) and '/' elsewhere (anchors on the home page).
export function SiteHeader({ base = '', bagCount, onBag }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const close = () => setMenuOpen(false)
  return <header className="site-header">
    <a href={base ? '/' : '#top'} className="brand"><img src="/assets/skinmatrix-logo.png" alt="SkinMatrix — Nutrition for Every Age" /></a>
    <nav><a href={`${base}#concerns`}>Discover</a><a href="/shop">Shop</a><a href={`${base}#ingredients`}>Ingredients</a><a href={`${base}#edit`}>The Edit</a></nav>
    <div className="header-actions"><button aria-label="Search">⌕</button><button onClick={onBag} aria-label="Open shopping bag">Bag <sup>{bagCount}</sup></button><button className="menu" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}>{menuOpen ? '×' : '☰'}</button></div>
    <div className={`mobile-nav ${menuOpen ? 'open' : ''}`} aria-hidden={!menuOpen}><a href={`${base}#concerns`} onClick={close}>Discover</a><a href="/shop" onClick={close}>Shop the edit</a><a href={`${base}#ingredients`} onClick={close}>Ingredients</a><a href={`${base}#edit`} onClick={close}>The edit</a><button onClick={() => { onBag(); close() }}>Bag · {bagCount}</button></div>
  </header>
}

export function SiteFooter({ base = '' }) {
  const top = base ? '/' : '#top'
  return <footer><img src="/assets/skinmatrix-logo.png" alt="SkinMatrix" /><div><a href={top}>Instagram</a><a href={top}>Contact</a><a href={top}>Shipping & Returns</a></div><small>© 2026 SkinMatrix. Nutrition for every age.</small></footer>
}

export function BagPanel({ open, onClose, bag, onRemove }) {
  const items = products.filter((product) => bag[product.name])
  return <aside className={`shop-panel ${open ? 'open' : ''}`} aria-hidden={!open}>
    <button className="panel-backdrop" onClick={onClose} aria-label="Close bag" />
    <div className="panel-sheet" role="dialog" aria-modal="true" aria-label="Your bag">
      <div className="panel-top"><span className="eyebrow">Your selected rituals</span><button onClick={onClose} className="panel-close" aria-label="Close">×</button></div>
      <div className="bag-view"><h2>Your <em>edit.</em></h2>{items.length ? <><div className="bag-items">{items.map(product => <div className="bag-item" key={product.name}><ProductVisual product={product} /><div><span>{product.brand}</span><h3>{product.name}</h3><p>{bag[product.name]} selected · {product.price}</p></div><button onClick={() => onRemove(product.name)} aria-label={`Remove ${product.name}`}>−</button></div>)}</div><p className="catalogue-note">Prices and live checkout will follow the verified SkinMatrix catalogue.</p><button className="button dark checkout">Request this edit <Arrow /></button></> : <p className="empty-state">Nothing selected yet. Start with a goal, then add what your routine needs.</p>}<a className="text-link" href="/shop" onClick={onClose}>Browse the shop <Arrow /></a></div>
    </div>
  </aside>
}
