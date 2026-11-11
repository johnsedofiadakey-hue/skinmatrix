// Products: everything about a product in one place and one form — photo, name, price, barcode, cost, stock
// and whether the website shows it. "Receive stock" adds new boxes by scanning them.
// (Long website descriptions and discovery tags stay in Website editor → Product descriptions.)
import { useMemo, useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { formatMoney, parseCedis } from '../lib/money.js'
import { sellableFromSummary, stockLevel } from '../../../functions/src/core/stock.js'
import { CATEGORIES, PRODUCT_IMAGES } from '../../cloud/site.js'
import { Dialog, Empty, Icon, Pill, Segmented } from '../components/ui.jsx'
import { CameraScanner } from '../components/scanner.jsx'
import { fmtExpiry } from '../components/format.js'
import { ReceiveStock } from '../pos/ReceiveStock.jsx'

const toCedis = (pesewas) => (Number.isInteger(pesewas) ? (pesewas / 100).toFixed(2) : '')

export default function Products() {
  const { products, catalogLoaded, can } = useOps()
  const now = useNow(60000)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null) // product id, or 'new'
  const [receiving, setReceiving] = useState(false)

  const rows = useMemo(() => products.map((product) => {
    const units = sellableFromSummary(product.stock, now)
    return { product, units, level: stockLevel(units, product.setup.reorderPoint ?? 3) }
  }), [products, now])
  const counts = {
    low: rows.filter((row) => row.level === 'low').length,
    out: rows.filter((row) => row.level === 'out' && row.product.price).length,
    noPrice: rows.filter((row) => !row.product.price).length,
    noBarcode: rows.filter((row) => row.product.price && !row.product.setup.barcode).length,
  }
  const needle = search.trim().toLowerCase()
  const shown = rows
    .filter((row) => filter === 'all' ? Boolean(row.product.price) || needle
      : filter === 'low' ? row.level === 'low'
        : filter === 'out' ? row.level === 'out' && row.product.price
          : filter === 'noPrice' ? !row.product.price
            : filter === 'noBarcode' ? row.product.price && !row.product.setup.barcode : true)
    .filter((row) => !needle || `${row.product.name} ${row.product.brand} ${row.product.setup.sku || ''} ${row.product.setup.barcode || ''}`.toLowerCase().includes(needle))
    .sort((a, b) => a.product.name.localeCompare(b.product.name))
  const editingProduct = editing && editing !== 'new' ? products.find((product) => product.id === editing) : null

  return <div className="stack products-page">
    <div className="products-actions">
      <button type="button" className="btn primary large" onClick={() => setEditing('new')}><Icon name="plus" size={18} /> Add a product</button>
      {can('deliveries') ? <button type="button" className="btn secondary large" onClick={() => setReceiving(true)}><Icon name="delivery" size={18} /> Receive stock</button> : null}
    </div>
    <div className="toolbar">
      <Segmented label="Show" value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'For sale' },
        { value: 'low', label: 'Low', count: counts.low },
        { value: 'out', label: 'Out', count: counts.out },
        { value: 'noBarcode', label: 'No barcode', count: counts.noBarcode },
        { value: 'noPrice', label: 'No price', count: counts.noPrice },
      ]} />
      <label className="search grow"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, brand or barcode" aria-label="Search products" /></label>
    </div>
    {filter === 'noPrice' ? <p className="muted small">Products without a price are drafts: the till and the website do not show them. Open one and add a price to start selling it.</p> : null}
    {!catalogLoaded ? <p className="muted">Loading…</p> : shown.length ? <ul className="product-rows">{shown.map(({ product, units, level }) => <li key={product.id}>
      <button type="button" className="product-row" onClick={() => setEditing(product.id)}>
        <span className="product-row-art">{product.image ? <img src={product.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Icon name="products" size={24} />}</span>
        <span className="product-row-main"><b>{product.name}</b><span className="muted small">{[product.brand, product.size].filter(Boolean).join(' · ') || ' '}</span></span>
        <span className="product-row-price">{product.price ? formatMoney(product.price) : <Pill tone="amber">No price</Pill>}</span>
        <span className="product-row-stock">
          <b className={level === 'out' ? 'bad-text' : level === 'low' ? 'warn-text' : ''}>{units}</b><span className="muted small">in stock</span>
        </span>
        <span className="product-row-tags">
          {!product.setup.barcode ? <Pill tone="amber">No barcode</Pill> : null}
          {product.visible === false ? <Pill tone="grey">Shop only</Pill> : <Pill tone="green">On website</Pill>}
        </span>
      </button>
    </li>)}</ul> : <Empty title={products.length ? 'Nothing here' : 'No products yet'}>{products.length ? 'Try another filter or search.' : 'Press Add a product to start.'}</Empty>}

    {editing === 'new' ? <ProductForm onClose={() => setEditing(null)} /> : null}
    {editingProduct ? <ProductForm product={editingProduct} onClose={() => setEditing(null)} onReceive={() => { setEditing(null); setReceiving(true) }} /> : null}
    {receiving ? <ReceiveStock onClose={() => setReceiving(false)} /> : null}
  </div>
}

// The one form. New products also take the stock already on the shelf.
function ProductForm({ product, onClose, onReceive }) {
  const { call, can, products } = useOps()
  const now = useNow(60000)
  const isNew = !product
  const [form, setForm] = useState(() => ({
    name: product?.name || '',
    brand: product?.brand || '',
    size: product?.size || '',
    category: product?.category || CATEGORIES[0],
    price: toCedis(product?.price),
    cost: toCedis(product?.cost),
    image: product?.image || '',
    barcode: product?.setup?.barcode || '',
    visible: product ? product.visible !== false : true,
    tracksExpiry: product ? product.setup?.tracksExpiry !== false : true,
    reorderPoint: String(product?.setup?.reorderPoint ?? 3),
    sku: product?.setup?.sku || '',
    quantity: '',
    expiry: '',
  }))
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (patch) => setForm((current) => ({ ...current, ...patch }))

  const price = form.price.trim() ? parseCedis(form.price) : null
  const cost = form.cost.trim() ? parseCedis(form.cost) : null
  const quantity = form.quantity.trim() ? Number.parseInt(form.quantity, 10) : 0
  const knownImage = PRODUCT_IMAGES.some((image) => image.src === form.image)
  const barcodeOwner = form.barcode ? products.find((item) => item.id !== product?.id && item.setup.barcode === form.barcode) : null
  const problems = [
    form.name.trim().length < 2 ? 'Type the product name.' : '',
    form.price.trim() && (price === null || price <= 0) ? 'Type the price like 250 or 250.50.' : '',
    form.cost.trim() && cost === null ? 'Type the cost like 120 or 120.50.' : '',
    barcodeOwner ? `This barcode is already on ${barcodeOwner.name}.` : '',
    isNew && quantity > 0 && form.tracksExpiry && !form.expiry ? 'Choose the expiry month printed on the box.' : '',
    form.quantity.trim() && !(quantity >= 0) ? 'Type how many you have, as a whole number.' : '',
  ].filter(Boolean)
  const units = product ? sellableFromSummary(product.stock, now) : 0

  const save = async (event) => {
    event.preventDefault()
    if (problems.length || busy) return
    setBusy(true)
    const result = await call('saveProduct', {
      ...(product ? { id: product.id } : {}),
      name: form.name, brand: form.brand, size: form.size, category: form.category, image: form.image, visible: form.visible,
      price, barcode: form.barcode.trim(), sku: form.sku, reorderPoint: Number.parseInt(form.reorderPoint, 10) || 0, tracksExpiry: form.tracksExpiry,
      ...(can('costs') ? { cost } : {}),
      ...(isNew && quantity > 0 ? { opening: { quantity, expiresOn: form.tracksExpiry ? lastDayOf(form.expiry) : null } } : {}),
    }, { success: isNew ? `${form.name} added${price ? '. It is on the till now' : ''}.` : 'Saved.' })
    setBusy(false)
    if (result) onClose()
  }

  return <Dialog title={isNew ? 'Add a product' : product.name} onClose={onClose} sheet wide>
    <form className="product-form" onSubmit={save}>
      <section className="product-form-photo">
        <span className="product-form-art">{form.image ? <img src={form.image} alt="" referrerPolicy="no-referrer" /> : <Icon name="products" size={40} />}</span>
        <label className="field"><span>Picture</span>
          <select value={knownImage ? form.image : form.image ? 'custom' : ''} onChange={(event) => set({ image: event.target.value === 'custom' ? (knownImage ? '' : form.image) : event.target.value })}>
            <option value="">No picture</option>
            {PRODUCT_IMAGES.map((image) => <option key={image.src} value={image.src}>{image.label}</option>)}
            <option value="custom">Another picture (paste a link)</option>
          </select>
        </label>
        {!knownImage && (form.image || form.image === '') ? <label className="field"><span>Picture link <em className="muted">optional</em></span><input value={form.image} onChange={(event) => set({ image: event.target.value.trim() })} placeholder="https://…" /></label> : null}
      </section>

      <section className="stack">
        <label className="field"><span>Product name</span><input value={form.name} onChange={(event) => set({ name: event.target.value })} maxLength={80} data-autofocus={isNew ? true : undefined} placeholder="e.g. Vitamin C Serum" /></label>
        <div className="field-row">
          <label className="field"><span>Brand</span><input value={form.brand} onChange={(event) => set({ brand: event.target.value })} maxLength={40} /></label>
          <label className="field"><span>Size</span><input value={form.size} onChange={(event) => set({ size: event.target.value })} maxLength={30} placeholder="30 ml, 60 tablets" /></label>
        </div>
        <div className="field"><span>Type</span><Segmented label="Type" value={form.category} onChange={(category) => set({ category })} options={CATEGORIES.map((value) => ({ value, label: value }))} /></div>

        <div className="field-row">
          <label className="field"><span>Selling price (GHS)</span><input className="big-input" inputMode="decimal" value={form.price} onChange={(event) => set({ price: event.target.value })} placeholder="0.00" />
            {!form.price.trim() ? <small className="muted">No price = a draft. The till won’t show it.</small> : null}</label>
          {can('costs') ? <label className="field"><span>Cost price (GHS) <em className="muted">optional, for profit</em></span><input inputMode="decimal" value={form.cost} onChange={(event) => set({ cost: event.target.value })} placeholder="What one costs you" /></label> : null}
        </div>

        <label className="field"><span>Barcode</span>
          <span className="row">
            <input className="grow" inputMode="numeric" value={form.barcode} onChange={(event) => set({ barcode: event.target.value.replace(/\s/g, '') })}
              onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} placeholder="Click here, then scan the box" />
            <button type="button" className="btn secondary" onClick={() => setCamera(true)}><Icon name="camera" size={16} /> Camera</button>
          </span>
          <small className="muted">With the USB scanner: click the box above, then scan the product. No barcode? Leave it empty and tap the product on the till.</small>
        </label>

        {isNew ? <fieldset className="product-form-stock">
          <legend>Stock you have now</legend>
          <div className="field-row">
            <label className="field"><span>How many on the shelf?</span><input className="big-input" inputMode="numeric" value={form.quantity} onChange={(event) => set({ quantity: event.target.value.replace(/\D/g, '') })} placeholder="0" /></label>
            {form.tracksExpiry ? <label className="field"><span>Expiry month <em className="muted">on the box</em></span><input type="month" value={form.expiry} onChange={(event) => set({ expiry: event.target.value })} /></label> : null}
          </div>
          <label className="check"><input type="checkbox" checked={!form.tracksExpiry} onChange={(event) => set({ tracksExpiry: !event.target.checked })} /> This product has no expiry date</label>
        </fieldset> : <div className="product-form-stock row wrap">
          <span className="grow"><b>{units}</b> in stock{product.stock?.nextExpiry ? <span className="muted"> · next expiry {fmtExpiry(product.stock.nextExpiry)}</span> : null}</span>
          {onReceive ? <button type="button" className="btn secondary" onClick={onReceive}><Icon name="plus" size={16} /> Receive stock</button> : null}
          <a className="btn ghost" href="#/stock">Correct the count</a>
        </div>}

        <label className="check big"><input type="checkbox" checked={form.visible} onChange={(event) => set({ visible: event.target.checked })} /> Show on the website (customers can order it when it is in stock)</label>

        <details className="product-form-more">
          <summary>More options</summary>
          <div className="stack">
            <label className="field"><span>Warn me when stock falls to</span><input inputMode="numeric" value={form.reorderPoint} onChange={(event) => set({ reorderPoint: event.target.value.replace(/\D/g, '') })} /></label>
            <label className="field"><span>Shop code (SKU) <em className="muted">optional</em></span><input value={form.sku} onChange={(event) => set({ sku: event.target.value.toUpperCase() })} maxLength={24} /></label>
            {!isNew ? <label className="check"><input type="checkbox" checked={!form.tracksExpiry} onChange={(event) => set({ tracksExpiry: !event.target.checked })} /> This product has no expiry date</label> : null}
            <p className="muted small">The long description and the website’s “good for” tags are in Website editor → Product descriptions.</p>
          </div>
        </details>

        {problems.length ? <p className="bad-text small" role="alert">{problems[0]}</p> : null}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary large" disabled={busy || problems.length > 0}>{busy ? 'Saving…' : isNew ? 'Add product' : 'Save changes'}</button>
        </div>
      </section>
    </form>
    {camera ? <CameraScanner onClose={() => setCamera(false)} onScan={(code) => { setCamera(false); set({ barcode: String(code).trim() }) }} /> : null}
  </Dialog>
}

// "2028-06" -> "2028-06-30": boxes print a month; the product is good until the end of it.
export function lastDayOf(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return null
  const [year, m] = month.split('-').map(Number)
  const day = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return `${month}-${String(day).padStart(2, '0')}`
}
