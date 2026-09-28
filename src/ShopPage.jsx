import { useEffect, useMemo, useState } from 'react'
import { Arrow, buyLabel, priceLabel, ProductVisual, SiteFooter, SiteHeader, useSite } from './storefront'
import { canBuy, CATEGORIES, SHOP_AUDIENCES, SHOP_GOALS, SHOP_INGREDIENTS, SHOP_NEEDS } from './cloud/site.js'

const FILTERS = [{ id: 'All', label: 'All products' }, ...CATEGORIES.map((id) => ({ id, label: id }))]

function startFilters() {
  const wanted = new URLSearchParams(window.location.search).get('category')
  const need = new URLSearchParams(window.location.search).get('need')
  const ingredient = new URLSearchParams(window.location.search).get('ingredient')
  const audience = new URLSearchParams(window.location.search).get('for')
  return {
    category: FILTERS.some((item) => item.id === wanted) ? wanted : 'All',
    audience: SHOP_AUDIENCES.some((item) => item.id === audience) ? audience : '',
    need: SHOP_NEEDS.some((item) => item.id === need) ? need : '',
    ingredient: SHOP_INGREDIENTS.includes(ingredient) ? ingredient : '',
  }
}

export default function ShopPage() {
  const { products, cart, add, openCart, openProduct } = useSite()
  const [filters, setFilters] = useState(startFilters)
  const [justAdded, setJustAdded] = useState(null)
  const visible = useMemo(() => products.filter((product) => product.visible &&
    (filters.category === 'All' || product.category === filters.category) &&
    (!filters.audience || product.audiences?.includes(filters.audience)) &&
    (!filters.need || product.needs?.includes(filters.need)) &&
    (!filters.ingredient || product.ingredients?.includes(filters.ingredient))), [products, filters])
  const audienceCards = useMemo(() => SHOP_AUDIENCES.map((audience) => ({ ...audience, count: products.filter((product) => product.visible && product.audiences?.includes(audience.id)).length })), [products])
  const adultAudiences = audienceCards.filter((audience) => ['Men', 'Women'].includes(audience.id))
  const childAudiences = audienceCards.filter((audience) => ['6 months–4 years', '4–12 years', '13–19 years'].includes(audience.id))
  const goalCards = useMemo(() => SHOP_GOALS.map((id) => ({ ...SHOP_NEEDS.find((need) => need.id === id), count: products.filter((product) => product.visible && product.needs?.includes(id)).length })), [products])
  const otherNeeds = useMemo(() => SHOP_NEEDS.filter((need) => !SHOP_GOALS.includes(need.id)).map((need) => ({ ...need, count: products.filter((product) => product.visible && product.needs?.includes(need.id)).length })), [products])
  const availableIngredients = useMemo(() => SHOP_INGREDIENTS.filter((ingredient) => products.some((product) => product.visible && product.ingredients?.includes(ingredient))), [products])

  useEffect(() => { document.title = window.location.pathname.startsWith('/checkout') ? 'Checkout — SkinMatrix' : 'Shop — SkinMatrix' }, [])
  useEffect(() => {
    if (!justAdded) return undefined
    const timer = setTimeout(() => setJustAdded(null), 3500)
    return () => clearTimeout(timer)
  }, [justAdded])

  const choose = (next) => {
    const value = { ...filters, ...next }
    setFilters(value)
    const url = new URL(window.location.href)
    if (value.category === 'All') url.searchParams.delete('category')
    else url.searchParams.set('category', value.category)
    if (!value.audience) url.searchParams.delete('for')
    else url.searchParams.set('for', value.audience)
    if (!value.need) url.searchParams.delete('need')
    else url.searchParams.set('need', value.need)
    if (!value.ingredient) url.searchParams.delete('ingredient')
    else url.searchParams.set('ingredient', value.ingredient)
    window.history.replaceState(null, '', url)
  }

  return <main className="shop-page">
    <SiteHeader base="/" />

    <section className="shop-page-hero">
      <span className="eyebrow">Shop</span>
      <h1>Find what you <em>need.</em></h1>
      <p>Shop by product, concern or ingredient—then build a routine that fits your life.</p>
      <div className="shop-page-filters" role="group" aria-label="Filter by product department">
        {FILTERS.map((item) => <button key={item.id} className={filters.category === item.id ? 'active' : ''} aria-pressed={filters.category === item.id} onClick={() => choose({ category: item.id })}>{item.label}</button>)}
      </div>
    </section>

    <section className="shop-discovery" aria-label="Shop by customer, need or ingredient">
      <div className="shop-discovery-heading"><span className="eyebrow">More ways to shop</span><h2>Find the right<br /><em>shelf, quickly.</em></h2></div>
      <div className="shop-navigation">
        <div className="shop-nav-set"><span className="eyebrow">Adults</span><div>{adultAudiences.map((audience) => <button key={audience.id} className={filters.audience === audience.id ? 'active' : ''} onClick={() => choose({ audience: filters.audience === audience.id ? '' : audience.id, need: '', ingredient: '' })} aria-pressed={filters.audience === audience.id}>{audience.label}<small>{audience.count}</small></button>)}</div></div>
        <div className="shop-nav-set"><span className="eyebrow">Children</span><div>{childAudiences.map((audience) => <button key={audience.id} disabled={!audience.count} className={filters.audience === audience.id ? 'active' : ''} onClick={() => choose({ audience: filters.audience === audience.id ? '' : audience.id, need: '', ingredient: '' })} aria-pressed={filters.audience === audience.id}>{audience.label}<small>{audience.count || 'soon'}</small></button>)}</div></div>
        <div className="shop-nav-set"><span className="eyebrow">Weight goals</span><div>{goalCards.map((goal) => <button key={goal.id} disabled={!goal.count} className={filters.need === goal.id ? 'active' : ''} onClick={() => choose({ need: filters.need === goal.id ? '' : goal.id, audience: '', ingredient: '' })} aria-pressed={filters.need === goal.id}>{goal.label}<small>{goal.count || 'soon'}</small></button>)}</div></div>
        <div className="shop-nav-set shop-nav-set--wide"><span className="eyebrow">Shop by need</span><div>{otherNeeds.map((need) => <button key={need.id} disabled={!need.count} className={filters.need === need.id ? 'active' : ''} onClick={() => choose({ need: filters.need === need.id ? '' : need.id, audience: '', ingredient: '' })} aria-pressed={filters.need === need.id}>{need.label}</button>)}</div></div>
        <div className="shop-nav-set shop-nav-set--wide"><span className="eyebrow">Shop by ingredient</span><div>{availableIngredients.map((ingredient) => <button key={ingredient} className={filters.ingredient === ingredient ? 'active' : ''} onClick={() => choose({ ingredient: filters.ingredient === ingredient ? '' : ingredient, audience: '', need: '' })} aria-pressed={filters.ingredient === ingredient}>{ingredient}</button>)}</div></div>
      </div>
    </section>

    <section className="shop-page-body" aria-label="Products">
      <div className="shop-page-count"><span className="eyebrow">{filters.audience || filters.need || filters.ingredient || FILTERS.find((item) => item.id === filters.category).label}</span><span className="eyebrow">{visible.length} {visible.length === 1 ? 'product' : 'products'}</span></div>
      {visible.length ? <div className="shop-page-grid">
        {visible.map((product) => {
          const inCart = cart[product.id] || 0
          return <article className="shop-card" key={product.id}>
            <button className="shop-card-art" onClick={() => openProduct(product.id)} aria-label={`See details for ${product.name}`}><ProductVisual product={product} /><span className="shop-card-peek">See details</span></button>
            <div className="shop-card-copy">
              <span className="eyebrow">{product.brand}{product.size ? ` · ${product.size}` : ''}</span>
              <h2><button className="shop-card-name" onClick={() => openProduct(product.id)}>{product.name}</button></h2>
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
  </main>
}
