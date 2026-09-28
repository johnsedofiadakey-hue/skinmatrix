import { useEffect, useMemo, useState } from 'react'
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore'
import { liveDb } from '../live/firebase.js'
import { useNow, useOps } from '../hooks.js'
import { formatMoney, parseCedis } from '../lib/money.js'
import { businessDay, DAY } from '../../../functions/src/core/time.js'
import { expiryStatus, sellable, sellableFromSummary, stockLevel } from '../../../functions/src/core/stock.js'
import { Dialog, Empty, Icon, Pill, ReasonDialog, Segmented, Stat } from '../components/ui.jsx'
import { Guide } from '../components/guide.jsx'
import { beep, CameraScanner, useHardwareScanner } from '../components/scanner.jsx'
import { fmtExpiry, fmtWhen } from '../components/format.js'

const EXPIRY_TEXT = { expired: 'Expired', urgent: 'Expires within 30 days', soon: 'Expires within 90 days' }

export default function Stock({ tab = 'list' }) {
  const { can } = useOps()
  const tabs = [{ value: 'list', label: 'Stock' }, ...(can('deliveries') ? [{ value: 'receive', label: 'Receive delivery' }] : []), ...(can('stock') ? [{ value: 'count', label: 'Stock take' }] : [])]
  const current = tabs.some((item) => item.value === tab) ? tab : 'list'
  return <div className="stack">
    {tabs.length > 1 ? <Segmented label="Stock" value={current} onChange={(value) => { window.location.hash = `#/stock/${value}` }} options={tabs} /> : null}
    {current === 'list' ? <StockList /> : null}
    {current === 'receive' ? <Receive /> : null}
    {current === 'count' ? <Count /> : null}
  </div>
}

function StockList() {
  const { products, can, call } = useOps()
  const now = useNow(60000)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(null)
  const [writingOff, setWritingOff] = useState(false)
  const rows = products.map((product) => {
    const units = sellableFromSummary(product.stock, now)
    const expired = (product.stock?.batches || []).filter((batch) => !sellable(batch, now)).reduce((sum, batch) => sum + batch.quantity, 0)
    return { product, units, expired, level: stockLevel(units, product.setup.reorderPoint ?? 3), expiry: expiryStatus(product.stock?.nextExpiry, now) }
  })
  const counts = {
    low: rows.filter((row) => row.level === 'low').length,
    out: rows.filter((row) => row.level === 'out').length,
    expiring: rows.filter((row) => ['soon', 'urgent'].includes(row.expiry) || row.expired).length,
  }
  const needle = search.trim().toLowerCase()
  const shown = rows.filter((row) => (filter === 'all' || (filter === 'expiring' ? ['soon', 'urgent'].includes(row.expiry) || row.expired : row.level === filter))
    && (!needle || `${row.product.name} ${row.product.brand} ${row.product.setup.sku || ''} ${row.product.setup.barcode || ''}`.toLowerCase().includes(needle)))
    .sort((a, b) => a.units - b.units || a.product.name.localeCompare(b.product.name))
  const expiredTotal = rows.reduce((sum, row) => sum + row.expired, 0)
  const openRow = rows.find((row) => row.product.id === open)

  return <>
    <Guide id="stock" title="Reading the stock list" steps={[
      '“In stock” counts only items that have not expired. Expired items cannot be sold at the till.',
      'Low means it has reached the reorder level. Order more from the supplier.',
      'Tap a product to see each batch (lot number and expiry date).',
      ...(can('stock') ? ['New stock arrived? Use Receive delivery. Counting the shelves? Use Stock take.'] : []),
    ]} />
    <div className="stat-grid">
      <Stat label="Low stock" value={counts.low} tone={counts.low ? 'warn' : ''} onClick={() => setFilter('low')} />
      <Stat label="Out of stock" value={counts.out} tone={counts.out ? 'bad' : ''} onClick={() => setFilter('out')} />
      <Stat label="Expiring or expired" value={counts.expiring} tone={counts.expiring ? 'warn' : ''} onClick={() => setFilter('expiring')} />
    </div>
    {expiredTotal && can('stock') ? <div className="callout bad"><Icon name="alertCircle" /><p><b>{expiredTotal} expired item(s) are still counted on the shelf.</b> Take them off the shelf, then record the write-off.</p><button type="button" className="btn danger small" onClick={() => setWritingOff(true)}>Write off expired</button></div> : null}
    <div className="toolbar">
      <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'low', label: 'Low' }, { value: 'out', label: 'Out' }, { value: 'expiring', label: 'Expiring' }]} />
      <label className="search grow"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" aria-label="Search stock" /></label>
    </div>
    {shown.length ? <ul className="card-list">{shown.map((row) => <li key={row.product.id}>
      <button type="button" className="sale-row" onClick={() => setOpen(row.product.id)}>
        <span className="sale-row-main sale-row-product">{row.product.image ? <img className="admin-product-thumb" src={row.product.image} alt="" referrerPolicy="no-referrer" /> : null}<span><b>{row.product.name}</b><span className="muted small">{[row.product.brand, row.product.size].filter(Boolean).join(' · ')}{row.product.stock?.nextExpiry ? ` · next expiry ${fmtExpiry(row.product.stock.nextExpiry)}` : ''}</span></span></span>
        <span className="sale-row-side">
          <b className={row.level === 'out' ? 'bad-text' : row.level === 'low' ? 'warn-text' : ''}>{row.units} in stock</b>
          {row.expired ? <Pill tone="red">{row.expired} expired</Pill> : EXPIRY_TEXT[row.expiry] ? <Pill tone={row.expiry === 'urgent' ? 'red' : 'amber'}>{EXPIRY_TEXT[row.expiry]}</Pill> : null}
        </span>
      </button>
    </li>)}</ul> : <Empty title="Nothing to show">{products.length ? 'No products match.' : 'Products come from Website → Products.'}</Empty>}
    {openRow ? <ProductStock row={openRow} onClose={() => setOpen(null)} /> : null}
    {writingOff ? <ReasonDialog title="Write off expired stock" destructive confirmLabel="Write off"
      intro={<p className="small">Only do this after the expired items are physically off the shelf. They are removed from stock and recorded.</p>}
      presets={['Removed from shelf and thrown away', 'Returned to supplier']}
      onConfirm={async () => Boolean(await call('writeOffExpired', {}, { success: (result) => `Wrote off ${result.units} expired item(s).` }))}
      onClose={() => setWritingOff(false)} /> : null}
  </>
}

function ProductStock({ row, onClose }) {
  const { can, call } = useOps()
  const now = useNow(60000)
  const [adjusting, setAdjusting] = useState(false)
  const [history, setHistory] = useState(null)
  useEffect(() => {
    if (!can('stock')) return undefined
    return onSnapshot(query(collection(liveDb, 'movements'), where('productId', '==', row.product.id), limit(60)), (snap) => setHistory(snap.docs.map((item) => item.data()).sort((a, b) => b.at - a.at).slice(0, 15)), () => setHistory([]))
  }, [row.product.id, can])
  const KIND = { sale: 'Sold', void: 'Sale cancelled', return: 'Returned', delivery: 'Delivery', adjustment: 'Adjusted', count: 'Stock take', write_off: 'Written off', web_order: 'Website order', web_cancel: 'Website order cancelled' }
  return <Dialog title={row.product.name} onClose={onClose} sheet>
    <div className="stack">
      <div className="admin-product-summary">{row.product.image ? <img className="admin-product-thumb large" src={row.product.image} alt="" referrerPolicy="no-referrer" /> : null}<p className="muted">{[row.product.brand, row.product.size].filter(Boolean).join(' · ')} · shop code {row.product.setup.sku || '—'} · barcode {row.product.setup.barcode || '—'}</p></div>
      <p className="checkout-total"><span>In stock (not expired)</span><b>{row.units}</b></p>
      {(row.product.stock?.batches || []).length ? <table className="table compact">
        <thead><tr><th scope="col">Batch</th><th scope="col">Expires</th><th scope="col" className="num">Units</th></tr></thead>
        <tbody>{row.product.stock.batches.map((batch) => {
          const status = expiryStatus(batch.expiresOn, now)
          return <tr key={batch.id}><td className="mono">{batch.lot}</td><td>{fmtExpiry(batch.expiresOn)} {status === 'expired' ? <Pill tone="red">Expired</Pill> : ['urgent', 'soon'].includes(status) ? <Pill tone="amber">Soon</Pill> : null}</td><td className="num">{batch.quantity}</td></tr>
        })}</tbody>
      </table> : <p className="muted">No stock recorded yet.</p>}
      {can('stock') ? <button type="button" className="btn secondary" onClick={() => setAdjusting(true)}>Add or remove stock</button> : null}
      {history?.length ? <details><summary>Recent changes</summary><ul className="history">{history.map((move, index) => <li key={index}><b className={move.delta > 0 ? 'good-text' : 'bad-text'}>{move.delta > 0 ? '+' : ''}{move.delta}</b> {KIND[move.kind] || move.kind} · {move.by} · {fmtWhen(move.at, now)}{move.reason ? ` · ${move.reason}` : ''}</li>)}</ul></details> : null}
    </div>
    {adjusting ? <AdjustDialog product={row.product} onClose={() => setAdjusting(false)} onDone={() => setAdjusting(false)} call={call} /> : null}
  </Dialog>
}

function AdjustDialog({ product, onClose, onDone, call }) {
  const [direction, setDirection] = useState('remove')
  const [batchId, setBatchId] = useState(product.stock?.batches?.[0]?.id || 'new')
  const [amount, setAmount] = useState('')
  const [lot, setLot] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [reason, setReason] = useState('')
  const quantity = Number.parseInt(amount, 10)
  const newBatch = direction === 'add' && batchId === 'new'
  const valid = quantity > 0 && reason.trim().length >= 3 && (newBatch ? (product.setup.tracksExpiry === false || expiresOn) : batchId !== 'new')
  const submit = async (event) => {
    event.preventDefault()
    if (!valid) return
    const result = await call('adjustStock', { productId: product.id, change: direction === 'add' ? quantity : -quantity, reason, ...(newBatch ? { lot: lot || 'NONE', expiresOn: expiresOn || null } : { batchId }) }, { success: 'Stock updated.' })
    if (result) onDone()
  }
  return <Dialog title={`Adjust ${product.name}`} onClose={onClose} sheet>
    <form className="stack" onSubmit={submit}>
      <Segmented label="Add or remove" value={direction} onChange={(value) => { setDirection(value); setBatchId(value === 'add' ? 'new' : product.stock?.batches?.[0]?.id || 'new') }} options={[{ value: 'remove', label: 'Remove' }, { value: 'add', label: 'Add' }]} />
      <label className="field"><span>Which batch</span>
        <select value={batchId} onChange={(event) => setBatchId(event.target.value)}>
          {direction === 'add' ? <option value="new">New batch (opening stock or found items)</option> : null}
          {(product.stock?.batches || []).map((batch) => <option key={batch.id} value={batch.id}>Batch {batch.lot} · expires {fmtExpiry(batch.expiresOn)} · {batch.quantity} units</option>)}
        </select>
      </label>
      {newBatch ? <div className="field-row">
        <label className="field"><span>Batch (lot) number</span><input value={lot} onChange={(event) => setLot(event.target.value.toUpperCase())} placeholder="On the box" /></label>
        <label className="field"><span>Expiry date</span><input type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} /></label>
      </div> : null}
      <label className="field"><span>How many</span><input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
      <div className="chip-row">{(direction === 'add' ? ['Opening stock', 'Found during count', 'Customer return'] : ['Damaged', 'Used as tester', 'Lost or stolen']).map((preset) => <button type="button" key={preset} className="chip" onClick={() => setReason(preset)}>{preset}</button>)}</div>
      <label className="field"><span>Reason</span><input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <p className="muted small">For supplier deliveries use Receive delivery instead, so the cost is recorded.</p>
      <button type="submit" className="btn primary block" disabled={!valid}>Save</button>
    </form>
  </Dialog>
}

const blankLine = () => ({ key: Math.random().toString(36).slice(2), productId: '', lot: '', expiresOn: '', quantity: '', cost: '' })

function Receive() {
  const { products, call, toast } = useOps()
  const now = useNow(60000)
  const [suppliers, setSuppliers] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [lines, setLines] = useState([blankLine()])
  const [camera, setCamera] = useState(null)
  const [busy, setBusy] = useState(false)
  const [addingSupplier, setAddingSupplier] = useState(false)
  useEffect(() => onSnapshot(collection(liveDb, 'suppliers'), (snap) => setSuppliers(snap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => a.name.localeCompare(b.name))), () => {}), [])
  const byCode = useMemo(() => new Map(products.flatMap((product) => [product.setup.barcode, product.setup.sku].filter(Boolean).map((code) => [String(code).toUpperCase(), product]))), [products])
  const productFor = (id) => products.find((product) => product.id === id)

  const addProduct = (product) => {
    setLines((list) => {
      const empty = list.find((line) => !line.productId)
      const filled = { productId: product.id, cost: product.cost ? (product.cost / 100).toFixed(2) : '' }
      return empty ? list.map((line) => (line.key === empty.key ? { ...line, ...filled } : line)) : [...list, { ...blankLine(), ...filled }]
    })
  }
  const scan = (raw) => {
    const product = byCode.get(String(raw).trim().toUpperCase())
    if (!product) { beep(false); toast(`No product has the code ${raw}. Link it in Products first.`, 'error'); return }
    beep()
    addProduct(product)
  }
  useHardwareScanner(scan, !camera)
  const update = (key, field, value) => setLines(lines.map((line) => {
    if (line.key !== key) return line
    const next = { ...line, [field]: value }
    if (field === 'productId' && !line.cost && productFor(value)?.cost) next.cost = (productFor(value).cost / 100).toFixed(2)
    return next
  }))
  const lowOnes = () => {
    const low = products.filter((product) => stockLevel(sellableFromSummary(product.stock, now), product.setup.reorderPoint ?? 3) !== 'ok')
    low.forEach(addProduct)
    if (!low.length) toast('Nothing is low right now.')
  }

  const parsed = lines.map((line) => ({ ...line, quantityValue: Number.parseInt(line.quantity, 10), costValue: parseCedis(line.cost), needsExpiry: productFor(line.productId)?.setup.tracksExpiry !== false }))
  const complete = (line) => line.productId && line.quantityValue > 0 && line.costValue !== null && (!line.needsExpiry || line.expiresOn)
  const filled = parsed.filter((line) => line.productId)
  const ready = filled.length && filled.every(complete) && !busy
  const total = filled.reduce((sum, line) => sum + (complete(line) ? line.quantityValue * line.costValue : 0), 0)

  const submit = async (event) => {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    const result = await call('receiveDelivery', { supplierId: supplierId || null, invoiceRef, lines: filled.map((line) => ({ productId: line.productId, lot: line.lot || 'NONE', expiresOn: line.expiresOn || null, quantity: line.quantityValue, unitCost: line.costValue })) }, { success: (value) => `Delivery saved: ${value.lines} product line(s) added to stock.` })
    setBusy(false)
    if (result) { setLines([blankLine()]); setInvoiceRef('') }
  }

  return <form className="stack" onSubmit={submit}>
    <Guide id="receive" title="How to record a delivery" steps={[
      'Check the boxes against the supplier’s invoice.',
      'Scan each product (or pick it from the list). Type the batch number and expiry date printed on the box.',
      'Type how many arrived and what you paid for ONE item. This is how profit is worked out.',
      'Press Save delivery. The stock is available at the till straight away.',
      'Recording stock you already had on day one? Use this too, and choose “Opening stock” as the supplier note.',
    ]} />
    <div className="field-row">
      <label className="field"><span>Supplier</span>
        <select value={supplierId} onChange={(event) => (event.target.value === '__add' ? setAddingSupplier(true) : setSupplierId(event.target.value))}>
          <option value="">No supplier / opening stock</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          <option value="__add">+ Add a supplier…</option>
        </select>
      </label>
      <label className="field"><span>Invoice number <em>optional</em></span><input value={invoiceRef} onChange={(event) => setInvoiceRef(event.target.value)} /></label>
    </div>
    <ul className="card-list">{parsed.map((line, index) => {
      const product = productFor(line.productId)
      return <li key={line.key} className="delivery-card">
        <div className="row">
          <select className="grow" aria-label={`Product ${index + 1}`} value={line.productId} onChange={(event) => update(line.key, 'productId', event.target.value)}>
            <option value="">Choose a product…</option>
            {products.map((option) => <option key={option.id} value={option.id}>{option.name}{option.size ? ` · ${option.size}` : ''}{option.brand ? ` (${option.brand})` : ''}</option>)}
          </select>
          <button type="button" className="icon-button" aria-label={`Remove line ${index + 1}`} onClick={() => setLines(lines.length > 1 ? lines.filter((candidate) => candidate.key !== line.key) : [blankLine()])}><Icon name="trash" size={16} /></button>
        </div>
        {product ? <><div className="delivery-product-picked">{product.image ? <img className="admin-product-thumb" src={product.image} alt="" referrerPolicy="no-referrer" /> : null}<span><b>{product.name}</b><small>{[product.brand, product.size].filter(Boolean).join(' · ')}</small></span></div><div className="delivery-fields">
          <label className="field"><span>Batch no.</span><input value={line.lot} onChange={(event) => update(line.key, 'lot', event.target.value.toUpperCase())} placeholder="On the box" /></label>
          <label className="field"><span>Expiry{line.needsExpiry ? '' : ' (none)'}</span><input type="date" min={businessDay(Date.now() + DAY)} disabled={!line.needsExpiry} value={line.expiresOn} onChange={(event) => update(line.key, 'expiresOn', event.target.value)} /></label>
          <label className="field"><span>How many</span><input inputMode="numeric" value={line.quantity} onChange={(event) => update(line.key, 'quantity', event.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
          <label className="field"><span>Cost of one (GHS)</span><input inputMode="decimal" value={line.cost} onChange={(event) => update(line.key, 'cost', event.target.value)} /></label>
        </div></> : null}
      </li>
    })}</ul>
    <div className="button-grid">
      <button type="button" className="btn secondary" onClick={() => setCamera(true)}><Icon name="camera" size={16} /> Scan a product</button>
      <button type="button" className="btn secondary" onClick={() => setLines([...lines, blankLine()])}><Icon name="plus" size={16} /> Add a line</button>
      <button type="button" className="btn ghost" onClick={lowOnes}>Add everything that is low</button>
    </div>
    <p className="checkout-total"><span>Total cost</span><b>{formatMoney(total)}</b></p>
    <button type="submit" className="btn primary block large" disabled={!ready}>{busy ? 'Saving…' : 'Save delivery'}</button>
    {camera ? <CameraScanner onClose={() => setCamera(null)} onScan={(code) => { setCamera(null); scan(code) }} /> : null}
    {addingSupplier ? <SupplierDialog onClose={() => setAddingSupplier(false)} onSaved={(id) => { setSupplierId(id); setAddingSupplier(false) }} /> : null}
  </form>
}

function SupplierDialog({ onClose, onSaved }) {
  const { call } = useOps()
  const [form, setForm] = useState({ name: '', contact: '', phone: '' })
  const submit = async (event) => {
    event.preventDefault()
    const result = await call('saveSupplier', form, { success: 'Supplier saved.' })
    if (result) onSaved(result.id)
  }
  return <Dialog title="Add a supplier" onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <label className="field"><span>Name</span><input data-autofocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <div className="field-row">
        <label className="field"><span>Contact person</span><input value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} /></label>
        <label className="field"><span>Phone</span><input inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
      </div>
      <button type="submit" className="btn primary" disabled={form.name.trim().length < 2}>Save supplier</button>
    </form>
  </Dialog>
}

function Count() {
  const { products, call, toast } = useOps()
  const now = useNow(60000)
  const [sheet, setSheet] = useState(null)
  const [counts, setCounts] = useState({})
  const [note, setNote] = useState('')
  const [stale, setStale] = useState([])
  const [busy, setBusy] = useState(false)
  const allBatches = products.flatMap((product) => (product.stock?.batches || []).map((batch) => ({ ...batch, product })))

  const start = () => { setSheet(allBatches.map((batch) => ({ batchId: batch.id, expected: batch.quantity }))); setCounts({}); setStale([]); setNote('') }
  const batchInfo = (id) => allBatches.find((batch) => batch.id === id)
  const entered = sheet ? sheet.filter((line) => counts[line.batchId] !== undefined && counts[line.batchId] !== '') : []
  const differing = entered.filter((line) => Number(counts[line.batchId]) !== line.expected)
  const allCounted = sheet && entered.length === sheet.length

  const submit = async () => {
    setBusy(true)
    try {
      const result = await call('submitStockCount', { lines: sheet.map((line) => ({ ...line, counted: Number(counts[line.batchId]) })), note }, { quiet: true })
      if (result) {
        toast(result.differing ? `Stock take saved. ${result.differing} line(s) corrected.` : 'Stock take saved. Everything matched.')
        setSheet(null)
      }
      return result
    } catch (error) {
      if (error.code === 'stale_count') {
        const moved = new Set(error.details?.stale || [])
        setSheet(sheet.map((line) => (moved.has(line.batchId) ? { ...line, expected: batchInfo(line.batchId)?.quantity ?? line.expected } : line)))
        setCounts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !moved.has(id))))
        setStale([...moved])
      }
      toast(error.message, 'error')
    } finally { setBusy(false) }
    return null
  }

  if (!sheet) return <div className="stack">
    <Guide id="count" title="How to do a stock take" steps={[
      'Press Start. You get a list of every batch on the shelves.',
      'Count each one and type the number. The system number is hidden so you count honestly.',
      'If a number is different, write a short note (for example “1 damaged box found”).',
      'Press Submit. If a sale happens while you count, only the changed lines come back to recount.',
    ]} />
    <p>{allBatches.length} batches to count.</p>
    <button type="button" className="btn primary large" disabled={!allBatches.length} onClick={start}>Start stock take</button>
  </div>

  return <div className="stack">
    {stale.length ? <p className="callout warn">{stale.length} line(s) changed while you counted. Count them again.</p> : null}
    <p className="muted">{entered.length} of {sheet.length} counted</p>
    <ul className="card-list">{sheet.map((line) => {
      const info = batchInfo(line.batchId)
      return <li key={line.batchId} className={`count-row ${stale.includes(line.batchId) ? 'row-warn' : ''}`}>
        <span><b>{info?.product.name}</b><span className="muted small block">{info?.product.size} · batch {info?.lot} · {fmtExpiry(info?.expiresOn)}</span></span>
        <input className="qty-input" inputMode="numeric" aria-label={`Counted ${info?.product.name} batch ${info?.lot}`} value={counts[line.batchId] ?? ''} onChange={(event) => setCounts({ ...counts, [line.batchId]: event.target.value.replace(/\D/g, '').slice(0, 5) })} />
      </li>
    })}</ul>
    {allCounted && differing.length ? <label className="field"><span>{differing.length} line(s) differ. What happened?</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. 1 damaged, 1 missing" /></label> : null}
    <div className="button-grid">
      <button type="button" className="btn primary" disabled={!allCounted || busy || (differing.length > 0 && note.trim().length < 3)} onClick={submit}>{busy ? 'Saving…' : 'Submit stock take'}</button>
      <button type="button" className="btn ghost" onClick={() => setSheet(null)}>Stop without saving</button>
    </div>
    <p className="muted small">Counted on {fmtWhen(now, now)}.</p>
  </div>
}
