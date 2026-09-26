import { useEffect, useState } from 'react'
import { Arrow, BagPanel, ProductVisual, SiteFooter, SiteHeader, products, useBag } from './storefront'

const filters = [
  { id: 'All', label: 'All', title: 'Everything in the edit' },
  { id: 'Inside', label: 'Nutrition', title: 'Nutrition · from within' },
  { id: 'On the surface', label: 'Skincare', title: 'Skincare · on the surface' },
]

export default function ShopPage() {
  const { bag, count, add, remove } = useBag()
  const [bagOpen, setBagOpen] = useState(false)
  const [filter, setFilter] = useState(filters[0])
  const visible = filter.id === 'All' ? products : products.filter((product) => product.category === filter.id)

  useEffect(() => { document.title = 'Shop — SkinMatrix' }, [])

  return <main className="shop-page">
    <SiteHeader base="/" bagCount={count} onBag={() => setBagOpen(true)} />

    <section className="shop-page-hero">
      <span className="eyebrow">The SkinMatrix selection</span>
      <h1>Find your <em>ritual.</em></h1>
      <p>Recognised skincare and wellness brands, selected for the way they work together.</p>
      <div className="shop-page-filters" role="group" aria-label="Filter products">
        {filters.map((item) => <button key={item.id} className={filter.id === item.id ? 'active' : ''} aria-pressed={filter.id === item.id} onClick={() => setFilter(item)}>{item.label}</button>)}
      </div>
    </section>

    <section className="shop-page-body" aria-label="Products">
      <div className="shop-page-count"><span className="eyebrow">{filter.title}</span><span className="eyebrow">{visible.length} {visible.length === 1 ? 'product' : 'products'}</span></div>
      <div className="shop-page-grid">
        {visible.map((product) => <article className={`shop-card tone-${product.tone}`} key={product.name}>
          <div className="shop-card-art"><ProductVisual product={product} /></div>
          <div className="shop-card-copy">
            <span className="eyebrow">{product.brand} · {product.type}</span>
            <h2>{product.name}</h2>
            <p>{product.note}</p>
            <div className="shop-card-buy">
              <b>{product.price}</b>
              <button className={`button ${bag[product.name] ? 'in-bag' : 'dark'}`} onClick={() => add(product)} aria-label={`Add ${product.name} to bag`}>{bag[product.name] ? `In bag · ${bag[product.name]}` : 'Add to bag'} <Arrow /></button>
            </div>
          </div>
        </article>)}
      </div>
    </section>

    <section className="shop-page-help">
      <div><span className="eyebrow">Not sure where to start?</span><h2>Shop by what you<br /><em>want to feel.</em></h2></div>
      <a className="button dark" href="/#concerns">Shop by concern <Arrow /></a>
    </section>

    <SiteFooter base="/" />
    <BagPanel open={bagOpen} onClose={() => setBagOpen(false)} bag={bag} onRemove={remove} />
  </main>
}
