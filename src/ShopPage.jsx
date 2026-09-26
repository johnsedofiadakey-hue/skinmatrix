import { useEffect, useState } from 'react'
import { Arrow, buyLabel, CartPanel, priceLabel, ProductVisual, SiteFooter, SiteHeader, useSite } from './storefront'
import { canBuy, CATEGORIES } from './cloud/site.js'

const FILTERS = [{ id: 'All', label: 'All products' }, ...CATEGORIES.map((id) => ({ id, label: id }))]

function startFilter() {
  const wanted = new URLSearchParams(window.location.search).get('category')
  return FILTERS.some((item) => item.id === wanted) ? wanted : 'All'
}

export default function ShopPage() {
  const { products, cart, add, openCart } = useSite()
  const [filter, setFilter] = useState(startFilter)
  const [justAdded, setJustAdded] = useState(null)
  const visible = filter === 'All' ? products : products.filter((product) => product.category === filter)

  useEffect(() => { document.title = 'Shop — SkinMatrix' }, [])
  useEffect(() => {
    if (!justAdded) return undefined
    const timer = setTimeout(() => setJustAdded(null), 3500)
    return () => clearTimeout(timer)
  }, [justAdded])

  const choose = (id) => {
    setFilter(id)
    const url = new URL(window.location.href)
    if (id === 'All') url.searchParams.delete('category')
    else url.searchParams.set('category', id)
    window.history.replaceState(null, '', url)
  }

  return <main className="shop-page">
    <SiteHeader base="/" />

    <section className="shop-page-hero">
      <span className="eyebrow">Shop</span>
      <h1>Find what you <em>need.</em></h1>
      <p>Skincare and supplements from brands you can trust.</p>
      <div className="shop-page-filters" role="group" aria-label="Show products">
        {FILTERS.map((item) => <button key={item.id} className={filter === item.id ? 'active' : ''} aria-pressed={filter === item.id} onClick={() => choose(item.id)}>{item.label}</button>)}
      </div>
    </section>

    <section className="shop-page-body" aria-label="Products">
      <div className="shop-page-count"><span className="eyebrow">{FILTERS.find((item) => item.id === filter).label}</span><span className="eyebrow">{visible.length} {visible.length === 1 ? 'product' : 'products'}</span></div>
      {visible.length ? <div className="shop-page-grid">
        {visible.map((product) => {
          const inCart = cart[product.id] || 0
          return <article className="shop-card" key={product.id}>
            <div className="shop-card-art"><ProductVisual product={product} /></div>
            <div className="shop-card-copy">
              <span className="eyebrow">{product.brand}{product.size ? ` · ${product.size}` : ''}</span>
              <h2>{product.name}</h2>
              {product.type ? <p className="shop-card-type">{product.type}</p> : null}
              <p>{product.description}</p>
              <div className="shop-card-buy">
                <b className={product.price ? 'has-price' : ''}>{priceLabel(product)}</b>
                <button className={`button ${inCart ? 'in-bag' : 'dark'}`} disabled={!canBuy(product)} onClick={() => { add(product); setJustAdded(product) }}>{buyLabel(product, inCart)}</button>
              </div>
            </div>
          </article>
        })}
      </div> : <p className="shop-page-empty">No products here yet. Please check again soon.</p>}
    </section>

    <section className="shop-page-help">
      <div><span className="eyebrow">Not sure what to buy?</span><h2>Shop by what you<br /><em>need help with.</em></h2></div>
      <a className="button dark" href="/#concerns">Find by need <Arrow /></a>
    </section>

    <div className={`added-toast ${justAdded ? 'show' : ''}`} role="status" aria-live="polite">
      {justAdded ? <><span><b>{justAdded.name}</b> is in your cart.</span><button onClick={() => { setJustAdded(null); openCart() }}>View cart</button></> : null}
    </div>

    <SiteFooter />
    <CartPanel />
  </main>
}
