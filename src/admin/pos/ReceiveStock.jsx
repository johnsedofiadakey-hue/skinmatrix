// Receive stock, the quick way: scan each box (or search), type how many and the expiry month, save.
// Scanning the same product again adds one more. Batch numbers, suppliers and invoices are optional extras
// in Stock → Receive delivery.
import { useCallback, useState } from 'react'
import { useOps } from '../hooks.js'
import { formatMoney, parseCedis } from '../lib/money.js'
import { Dialog, Icon } from '../components/ui.jsx'
import { beep, CameraScanner, useHardwareScanner } from '../components/scanner.jsx'

const toCedis = (pesewas) => (Number.isInteger(pesewas) ? (pesewas / 100).toFixed(2) : '')
const lastDayOf = (month) => {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return null
  const [year, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, '0')}`
}

export function ReceiveStock({ onClose }) {
  const { products, call, can, toast } = useOps()
  const [lines, setLines] = useState([])
  const [query, setQuery] = useState('')
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const seeCost = can('costs')

  const addProduct = useCallback((product) => {
    beep()
    setLines((list) => (list.some((line) => line.productId === product.id)
      ? list.map((line) => (line.productId === product.id ? { ...line, quantity: String((Number.parseInt(line.quantity, 10) || 0) + 1) } : line))
      : [{ productId: product.id, quantity: '1', expiry: '', cost: toCedis(product.cost) }, ...list]))
    setQuery('')
  }, [])

  const byCode = useCallback((code) => {
    const text = String(code).trim().toUpperCase()
    return products.find((product) => String(product.setup.barcode || '').toUpperCase() === text || String(product.setup.sku || '').toUpperCase() === text)
  }, [products])
  const scan = useCallback((code) => {
    const product = byCode(code)
    if (!product) { beep(false); toast(`No product has the barcode ${code}. Add it first with Add a product.`, 'error'); return }
    addProduct(product)
  }, [byCode, addProduct, toast])
  useHardwareScanner(scan, !camera)

  const needle = query.trim().toLowerCase()
  const matches = needle ? products.filter((product) => `${product.name} ${product.brand} ${product.setup.barcode || ''}`.toLowerCase().includes(needle)).slice(0, 6) : []
  const set = (productId, patch) => setLines((list) => list.map((line) => (line.productId === productId ? { ...line, ...patch } : line)))
  const remove = (productId) => setLines((list) => list.filter((line) => line.productId !== productId))

  const rows = lines.map((line) => ({ ...line, product: products.find((product) => product.id === line.productId) })).filter((line) => line.product)
  const problem = rows.map((row) => {
    const quantity = Number.parseInt(row.quantity, 10)
    if (!(quantity > 0)) return `${row.product.name}: type how many arrived.`
    if (row.product.setup.tracksExpiry !== false && !row.expiry) return `${row.product.name}: choose the expiry month on the box.`
    if (seeCost && row.cost.trim() && parseCedis(row.cost) === null) return `${row.product.name}: type the cost like 120.50.`
    return ''
  }).find(Boolean)
  const units = rows.reduce((sum, row) => sum + (Number.parseInt(row.quantity, 10) || 0), 0)

  const save = async () => {
    if (!rows.length || problem || busy) return
    setBusy(true)
    const result = await call('receiveDelivery', {
      lines: rows.map((row) => ({
        productId: row.productId,
        quantity: Number.parseInt(row.quantity, 10),
        lot: 'NONE',
        expiresOn: row.product.setup.tracksExpiry !== false ? lastDayOf(row.expiry) : null,
        unitCost: seeCost && row.cost.trim() ? parseCedis(row.cost) : (row.product.cost ?? 0),
      })),
    }, { success: `Added ${units} item${units === 1 ? '' : 's'} to stock.` })
    setBusy(false)
    if (result) onClose()
  }

  return <Dialog title="Receive stock" onClose={onClose} sheet wide>
    <div className="stack receive">
      <div className="receive-scan">
        <Icon name="search" size={20} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Scan a box, or type a product name" aria-label="Find a product"
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            const exact = byCode(query)
            if (exact) addProduct(exact)
            else if (matches.length === 1) addProduct(matches[0])
          }} />
        <button type="button" className="btn secondary" onClick={() => setCamera(true)}><Icon name="camera" size={16} /> Camera</button>
      </div>
      {matches.length ? <ul className="receive-matches">{matches.map((product) => <li key={product.id}><button type="button" onClick={() => addProduct(product)}>
        {product.image ? <img src={product.image} alt="" referrerPolicy="no-referrer" /> : <Icon name="products" />}<span><b>{product.name}</b><span className="muted small">{[product.brand, product.size].filter(Boolean).join(' · ')}</span></span><Icon name="plus" />
      </button></li>)}</ul> : null}

      {rows.length ? <ul className="receive-lines">{rows.map((row) => <li key={row.productId}>
        <span className="receive-name"><b>{row.product.name}</b><span className="muted small">{[row.product.brand, row.product.size].filter(Boolean).join(' · ')}</span></span>
        <label className="field"><span>How many</span>
          <span className="pos-stepper">
            <button type="button" onClick={() => set(row.productId, { quantity: String(Math.max(1, (Number.parseInt(row.quantity, 10) || 1) - 1)) })} aria-label="One less"><Icon name="minus" size={18} /></button>
            <input inputMode="numeric" value={row.quantity} onChange={(event) => set(row.productId, { quantity: event.target.value.replace(/\D/g, '') })} aria-label={`How many ${row.product.name}`} />
            <button type="button" onClick={() => set(row.productId, { quantity: String((Number.parseInt(row.quantity, 10) || 0) + 1) })} aria-label="One more"><Icon name="plus" size={18} /></button>
          </span>
        </label>
        {row.product.setup.tracksExpiry !== false ? <label className="field"><span>Expiry month</span><input type="month" value={row.expiry} onChange={(event) => set(row.productId, { expiry: event.target.value })} /></label> : <span className="muted small">No expiry</span>}
        {seeCost ? <label className="field"><span>Cost each (GHS)</span><input inputMode="decimal" value={row.cost} onChange={(event) => set(row.productId, { cost: event.target.value })} placeholder="0.00" /></label> : null}
        <button type="button" className="icon-button" onClick={() => remove(row.productId)} aria-label={`Remove ${row.product.name}`}><Icon name="trash" /></button>
      </li>)}</ul> : <div className="receive-empty">
        <Icon name="delivery" size={34} />
        <b>Scan the first box</b>
        <span className="muted small">Each scan adds one. Or type a name above and tap the product.</span>
      </div>}

      {problem ? <p className="warn-text small">{problem}</p> : null}
      <div className="row end">
        <span className="grow muted small">{rows.length ? `${rows.length} product${rows.length === 1 ? '' : 's'}, ${units} item${units === 1 ? '' : 's'}${seeCost ? ` · cost ${formatMoney(rows.reduce((sum, row) => sum + (Number.parseInt(row.quantity, 10) || 0) * (parseCedis(row.cost) || 0), 0))}` : ''}` : ''}</span>
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary large" disabled={!rows.length || Boolean(problem) || busy} onClick={save}>{busy ? 'Saving…' : 'Add to stock'}</button>
      </div>
      <p className="muted small">Need batch numbers, a supplier or an invoice number? Use <a href="#/stock/receive" onClick={onClose}>Stock → Receive delivery</a>.</p>
    </div>
    {camera ? <CameraScanner onClose={() => setCamera(false)} onScan={(code) => { setCamera(false); scan(code) }} /> : null}
  </Dialog>
}
