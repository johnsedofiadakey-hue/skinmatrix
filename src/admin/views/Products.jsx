// Products: everything about a product in one place and one form (src/admin/pos/ProductForm.jsx).
// Scan any box here: a product the shop has opens; a new barcode opens "New product" with the barcode filled in.
// "Receive stock" adds new boxes by scanning them.
import { useCallback, useMemo, useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { formatMoney } from '../lib/money.js'
import { sellableFromSummary, stockLevel } from '../../../functions/src/core/stock.js'
import { Empty, Icon, Pill, Segmented } from '../components/ui.jsx'
import { beep, CameraScanner, useHardwareScanner } from '../components/scanner.jsx'
import { ReceiveStock } from '../pos/ReceiveStock.jsx'
import { ProductForm } from '../pos/ProductForm.jsx'

export default function Products() {
  const { products, catalogLoaded, can } = useOps()
  const now = useNow(60000)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null) // product id, or 'new'
  const [scanned, setScanned] = useState('') // the barcode of a new product being added from a scan
  const [receiving, setReceiving] = useState(false)
  const [camera, setCamera] = useState(false)

  // A scan anywhere on the page (USB scanner, or the camera): open that product, or add it as a new one.
  const findOrAdd = useCallback((raw) => {
    const code = String(raw).trim()
    if (!code) return
    const known = products.find((product) => [product.setup.barcode, product.setup.sku].some((value) => value && String(value).toUpperCase() === code.toUpperCase()))
    beep()
    if (known) { setEditing(known.id); return }
    setScanned(code)
    setEditing('new')
  }, [products])
  useHardwareScanner(findOrAdd, !editing && !receiving && !camera)

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
      <button type="button" className="btn primary large" onClick={() => { setScanned(''); setEditing('new') }}><Icon name="plus" size={18} /> Add a product</button>
      <button type="button" className="btn secondary large" onClick={() => setCamera(true)}><Icon name="camera" size={18} /> Scan with camera</button>
      {can('deliveries') ? <button type="button" className="btn secondary large" onClick={() => setReceiving(true)}><Icon name="delivery" size={18} /> Receive stock</button> : null}
    </div>
    <p className="callout small products-scan-hint"><Icon name="search" /> <span><b>Scan any box with the barcode scanner.</b> If the shop has it, it opens. If not, a new product opens with the barcode filled in: add the name, price and how many you have.</span></p>
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

    {editing === 'new' ? <ProductForm barcode={scanned} onClose={() => { setEditing(null); setScanned('') }} /> : null}
    {editingProduct ? <ProductForm product={editingProduct} onClose={() => setEditing(null)} onReceive={() => { setEditing(null); setReceiving(true) }} /> : null}
    {receiving ? <ReceiveStock onClose={() => setReceiving(false)} /> : null}
    {camera ? <CameraScanner onClose={() => setCamera(false)} onScan={(code) => { setCamera(false); findOrAdd(code) }} /> : null}
  </div>
}

