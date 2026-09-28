import { useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { formatMoney, parseCedis } from '../lib/money.js'
import { sellableFromSummary } from '../../../functions/src/core/stock.js'
import { Dialog, Empty, Icon, Pill, Segmented } from '../components/ui.jsx'
import { Guide } from '../components/guide.jsx'
import { beep, CameraScanner, useHardwareScanner } from '../components/scanner.jsx'

// Till details for each catalogue product: shop code, barcode, low-stock level, expiry tracking and cost.
// Name, price, photo and whether it shows on the website are edited in Website → Products.
export default function Setup() {
  const { products, catalogLoaded } = useOps()
  const now = useNow(60000)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(null)
  const missing = (product) => !product.setup.barcode || product.cost === null
  const needle = search.trim().toLowerCase()
  const shown = products.filter((product) => (filter === 'all' || missing(product))
    && (!needle || `${product.name} ${product.brand} ${product.setup.sku || ''} ${product.setup.barcode || ''}`.toLowerCase().includes(needle)))
  const openProduct = products.find((product) => product.id === open)
  const incomplete = products.filter(missing).length

  return <div className="stack">
    <Guide id="setup" title="Getting products ready for the till" steps={[
      'Add new products (name, price, photo) in Website → Products. Untick “Show on website” for items sold only in the shop.',
      'Then come here and tap the product. Scan its barcode so the scanner finds it at the till.',
      'Type what one item costs you, so profit can be worked out.',
      'Set the low-stock level: when stock falls to this number it shows as Low.',
      'Record the stock you already have with Stock → Receive delivery.',
    ]} />
    <div className="toolbar">
      <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All', count: products.length }, { value: 'missing', label: 'Needs details', count: incomplete }]} />
      <label className="search grow"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" aria-label="Search products" /></label>
    </div>
    {!catalogLoaded ? <p className="muted">Loading…</p> : shown.length ? <ul className="card-list">{shown.map((product) => <li key={product.id}>
      <button type="button" className="sale-row" onClick={() => setOpen(product.id)}>
        <span className="sale-row-main sale-row-product">
          {product.image ? <img className="admin-product-thumb" src={product.image} alt="" referrerPolicy="no-referrer" /> : null}
          <span><b>{product.name}</b><span className="muted small">{[product.brand, product.size].filter(Boolean).join(' · ')} · price {(product.price ? formatMoney(product.price) : 'no price')}{product.visible === false ? ' · shop only' : ''}</span></span>
        </span>
        <span className="sale-row-side">
          <span className="small">{sellableFromSummary(product.stock, now)} in stock</span>
          {!product.setup.barcode ? <Pill tone="amber">No barcode</Pill> : null}
          {product.cost === null ? <Pill tone="amber">No cost</Pill> : null}
        </span>
      </button>
    </li>)}</ul> : <Empty title={products.length ? 'Nothing matches' : 'No products yet'}>{products.length ? null : 'Add products in Website → Products first.'}</Empty>}
    {openProduct ? <SetupDialog product={openProduct} onClose={() => setOpen(null)} /> : null}
  </div>
}

function SetupDialog({ product, onClose }) {
  const { call } = useOps()
  const [form, setForm] = useState({
    sku: product.setup.sku || '',
    barcode: product.setup.barcode || '',
    reorderPoint: String(product.setup.reorderPoint ?? 3),
    tracksExpiry: product.setup.tracksExpiry !== false,
    cost: product.cost === null ? '' : (product.cost / 100).toFixed(2),
  })
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  useHardwareScanner((code) => { beep(); setForm((current) => ({ ...current, barcode: code })) }, !camera)
  const cost = form.cost.trim() === '' ? null : parseCedis(form.cost)
  const price = product.price || 0
  const valid = /^\d{1,4}$/.test(form.reorderPoint) && (form.cost.trim() === '' || cost !== null)
  const submit = async (event) => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    const result = await call('saveProductSetup', { productId: product.id, sku: form.sku, barcode: form.barcode, reorderPoint: Number(form.reorderPoint), tracksExpiry: form.tracksExpiry, cost }, { success: `${product.name} saved.` })
    setBusy(false)
    if (result) onClose()
  }
  return <Dialog title={product.name} onClose={onClose} sheet>
    <form className="stack" onSubmit={submit}>
      <div className="admin-product-summary">{product.image ? <img className="admin-product-thumb large" src={product.image} alt="" referrerPolicy="no-referrer" /> : null}<p className="muted small">{[product.brand, product.size].filter(Boolean).join(' · ')} · selling price {formatMoney(price)}</p></div>
      <label className="field"><span>Barcode <em>scan it with the scanner or camera</em></span>
        <span className="row">
          <input className="grow mono" inputMode="numeric" value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value.trim() })} placeholder="Scan or type" />
          <button type="button" className="btn secondary" onClick={() => setCamera(true)} aria-label="Scan with camera"><Icon name="camera" size={16} /></button>
        </span>
      </label>
      <label className="field"><span>Shop code (SKU) <em>optional, for items without a barcode</em></span><input className="mono" value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value.toUpperCase() })} placeholder="e.g. CER-MC-340" /></label>
      <div className="field-row">
        <label className="field"><span>Cost of one (GHS)</span><input inputMode="decimal" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} /></label>
        <label className="field"><span>Warn when stock is at</span><input inputMode="numeric" value={form.reorderPoint} onChange={(event) => setForm({ ...form, reorderPoint: event.target.value.replace(/\D/g, '').slice(0, 4) })} /></label>
      </div>
      {cost !== null && price ? <p className="small muted">Profit per item: <b>{formatMoney(price - cost)}</b> ({Math.round(((price - cost) / price) * 100)}%)</p> : null}
      <label className="check"><input type="checkbox" checked={form.tracksExpiry} onChange={(event) => setForm({ ...form, tracksExpiry: event.target.checked })} /> This product has an expiry date (ask for it on deliveries)</label>
      <p className="muted small">To change the name, price or photo, use Website → Products.</p>
      <button type="submit" className="btn primary block" disabled={!valid || busy}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
    {camera ? <CameraScanner title="Scan the product barcode" onClose={() => setCamera(false)} onScan={(code) => { beep(); setForm((current) => ({ ...current, barcode: code })); setCamera(false) }} /> : null}
  </Dialog>
}
