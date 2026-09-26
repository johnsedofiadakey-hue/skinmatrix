import { useEffect, useRef, useState } from 'react'
import { Check, Minus, PackageCheck, Plus, ShoppingBag, Tag, X } from 'lucide-react'
import { ArrowNext, ICON, priceLabel, ProductVisual, useSite } from './storefront'
import { canBuy, formatGhs } from './cloud/site.js'

const MAX = 20

// Product details: opens when a product is tapped anywhere on the site (address gets ?product=id).
export default function ProductSheet() {
  const { product, products, cart, add, openCart, openProduct, closeProduct } = useSite()
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(0)
  const dialog = useRef(null)
  const open = Boolean(product)
  const inCart = product ? cart[product.id] || 0 : 0
  const room = Math.max(0, MAX - inCart)
  const buyable = product ? canBuy(product) : false

  // New product: start again at 1, scroll to the top, focus the close button.
  useEffect(() => {
    setQty(1)
    setAdded(0)
    if (!product) return undefined
    dialog.current?.scrollTo?.({ top: 0 })
    const timer = setTimeout(() => dialog.current?.querySelector('.sheet-close')?.focus({ preventScroll: true }), 60)
    return () => clearTimeout(timer)
  }, [product?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') closeProduct() }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow }
  }, [open, closeProduct])

  useEffect(() => {
    if (!added) return undefined
    const timer = setTimeout(() => setAdded(0), 4000)
    return () => clearTimeout(timer)
  }, [added])

  if (!product) return <div className="product-sheet" aria-hidden="true" />

  const chosen = Math.min(qty, room || 1)
  const related = products.filter((item) => item.id !== product.id && item.category === product.category).slice(0, 3)
  const status = !product.inStock ? 'Out of stock' : !product.price ? 'Price coming soon' : 'In stock'

  const addToCart = () => { add(product, chosen); setAdded(chosen); setQty(1) }
  const buyNow = () => { add(product, chosen); closeProduct(); openCart(0) }

  return <div className="product-sheet open">
    <button className="sheet-backdrop" onClick={closeProduct} aria-label="Close product" tabIndex={-1} />
    <div ref={dialog} className="sheet-card" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <button className="sheet-close" onClick={closeProduct} aria-label="Close"><X {...ICON} /></button>
      <div className="sheet-art"><ProductVisual product={product} /></div>
      <div className="sheet-info">
        <span className="eyebrow">{product.brand} · {product.category}</span>
        <h2 id="sheet-title">{product.name}</h2>
        {product.type ? <p className="sheet-type">{product.type}</p> : null}
        <p className="sheet-price">{priceLabel(product)}</p>
        {product.description ? <p className="sheet-desc">{product.description}</p> : null}

        <ul className="sheet-facts">
          {product.size ? <li><Tag {...ICON} /> <span>Size</span><b>{product.size}</b></li> : null}
          <li><PackageCheck {...ICON} /> <span>Availability</span><b className={buyable ? 'ok' : ''}>{status}</b></li>
          {inCart ? <li><ShoppingBag {...ICON} /> <span>In your cart</span><b>{inCart}</b></li> : null}
        </ul>

        {buyable ? <div className="sheet-buy">
          <div className="sheet-qty">
            <span id="qty-label">Quantity</span>
            <div className="qty big" role="group" aria-labelledby="qty-label">
              <button onClick={() => setQty(Math.max(1, chosen - 1))} disabled={chosen <= 1} aria-label="One less"><Minus {...ICON} /></button>
              <span aria-live="polite">{chosen}</span>
              <button onClick={() => setQty(Math.min(room, chosen + 1))} disabled={chosen >= room} aria-label="One more"><Plus {...ICON} /></button>
            </div>
            <b className="sheet-line-total">{formatGhs(product.price * chosen)}</b>
          </div>
          {room ? <div className="sheet-actions">
            <button className="button dark" onClick={addToCart}>Add to cart <ShoppingBag {...ICON} /></button>
            <button className="button sheet-buy-now" onClick={buyNow}>Buy now <ArrowNext /></button>
          </div> : <p className="sheet-note">You have the most we allow in one order ({MAX}).</p>}
          <div className={`sheet-added ${added ? 'show' : ''}`} role="status" aria-live="polite">
            {added ? <><Check {...ICON} /> <span>Added {added} to your cart.</span><button onClick={() => { closeProduct(); openCart(0) }}>View cart</button></> : null}
          </div>
        </div> : <p className="sheet-note">{!product.inStock ? 'This product is out of stock right now. Please check again soon.' : 'You cannot buy this yet. The price is coming soon.'}</p>}

        {related.length ? <div className="sheet-related">
          <b>More {product.category.toLowerCase()}</b>
          <ul>{related.map((item) => <li key={item.id}><button onClick={() => openProduct(item.id)}>
            <span className="related-art"><ProductVisual product={item} /></span>
            <span><small>{item.brand}</small>{item.name}<em>{priceLabel(item)}</em></span>
          </button></li>)}</ul>
        </div> : null}
      </div>
    </div>
  </div>
}
