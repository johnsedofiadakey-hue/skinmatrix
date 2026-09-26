import { useMemo, useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { onHand, stockStatus } from '../lib/stock.js'
import { formatMoney, parseCedis } from '../lib/money.js'
import { businessDayKey, DAY } from '../lib/time.js'
import { Card, Dialog, Empty, Icon, Money, ServerNote } from '../components/ui.jsx'
import { fmtDate, fmtExpiry, fmtWhen } from '../components/format.js'

// Supplier deliveries: every line becomes a batch with its lot, expiry and cost per unit, which is what margin uses.
export default function Deliveries() {
  const { state } = useOps()
  const now = useNow(60000)
  const [receiving, setReceiving] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const [open, setOpen] = useState(null)
  const supplierName = (id) => state.suppliers.find((supplier) => supplier.id === id)?.name || '—'
  const variantInfo = useMemo(() => new Map(state.catalog.flatMap((product) => product.variants.map((variant) => [variant.id, { product, variant }]))), [state.catalog])

  return <div className="stack gap-lg">
    <div className="toolbar">
      <p className="muted small grow">Check the goods against the supplier's invoice, then record each line with the lot, expiry and cost printed on it. Refuse anything already expired.</p>
      <button type="button" className="btn primary" onClick={() => setReceiving(true)}><Icon name="plus" size={16} />Receive delivery</button>
    </div>

    <Card title="Deliveries" flush>
      {state.deliveries.length ? <table className="table">
        <thead><tr><th scope="col">Delivery</th><th scope="col">Received</th><th scope="col">Supplier</th><th scope="col" className="hide-md">Invoice</th><th scope="col" className="num">Lines</th><th scope="col" className="num">Cost</th></tr></thead>
        <tbody>{state.deliveries.map((delivery) => <FragmentDelivery key={delivery.id} delivery={delivery} open={open === delivery.id} onToggle={() => setOpen(open === delivery.id ? null : delivery.id)} supplierName={supplierName} variantInfo={variantInfo} now={now} />)}</tbody>
      </table> : <Empty title="No deliveries yet" />}
    </Card>

    <Card title="Suppliers" actions={<button type="button" className="btn ghost small" onClick={() => setEditingSupplier({})}>Add supplier</button>} flush>
      <ul className="list">{state.suppliers.map((supplier) => {
        const last = state.deliveries.find((delivery) => delivery.supplierId === supplier.id)
        return <li key={supplier.id} className="list-row static">
          <span className="list-main"><b>{supplier.name}</b><span className="muted small">{[supplier.contact, supplier.phone].filter(Boolean).join(' · ') || 'No contact details'}</span></span>
          <span className="list-side"><span className="muted small">{last ? `Last delivery ${fmtDate(last.at)}` : 'No deliveries yet'}</span><button type="button" className="btn ghost small" onClick={() => setEditingSupplier(supplier)}>Edit</button></span>
        </li>
      })}</ul>
    </Card>
    <p className="muted small">Sample suppliers and costs · demo data.</p>

    {receiving ? <ReceiveDialog onClose={() => setReceiving(false)} /> : null}
    {editingSupplier ? <SupplierDialog supplier={editingSupplier} onClose={() => setEditingSupplier(null)} /> : null}
  </div>
}

function FragmentDelivery({ delivery, open, onToggle, supplierName, variantInfo, now }) {
  return <>
    <tr className="clickable" onClick={onToggle} aria-expanded={open}>
      <td className="nowrap"><span className="disclosure-mark inline">{open ? '−' : '+'}</span><span className="mono">{delivery.id}</span></td>
      <td className="nowrap">{fmtWhen(delivery.at, now)}<span className="muted small block">{delivery.by.name}</span></td>
      <td>{supplierName(delivery.supplierId)}</td>
      <td className="hide-md mono small">{delivery.invoiceRef || '—'}</td>
      <td className="num">{delivery.lines.length}</td>
      <td className="num strong"><Money value={delivery.totalCost} /></td>
    </tr>
    {open ? <tr className="detail-row"><td colSpan={6}>
      <table className="table compact"><tbody>{delivery.lines.map((line) => {
        const info = variantInfo.get(line.variantId)
        return <tr key={line.batchId}>
          <td><b>{info?.product.name}</b><span className="muted small"> {info?.variant.name}</span></td>
          <td className="mono">{line.lot}</td>
          <td>{fmtExpiry(line.expiresOn)}</td>
          <td className="num">{line.quantity} × <Money value={line.unitCost} /></td>
          <td className="num strong"><Money value={line.quantity * line.unitCost} /></td>
        </tr>
      })}</tbody></table>
    </td></tr> : null}
  </>
}

const blankLine = () => ({ key: Math.random().toString(36).slice(2), variantId: '', lot: '', expiresOn: '', quantity: '', cost: '' })

function ReceiveDialog({ onClose }) {
  const { state, staff, run, shopId } = useOps()
  const now = useNow(60000)
  const [supplierId, setSupplierId] = useState(state.suppliers[0]?.id || '')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [lines, setLines] = useState([blankLine()])
  const [busy, setBusy] = useState(false)
  const products = state.catalog.filter((product) => product.active !== false)
  const info = new Map(products.flatMap((product) => product.variants.map((variant) => [variant.id, { product, variant }])))
  const minExpiry = businessDayKey(now + DAY)

  const update = (key, field, value) => setLines(lines.map((line) => {
    if (line.key !== key) return line
    const next = { ...line, [field]: value }
    // Pre-fill the last cost paid when a product is chosen.
    if (field === 'variantId' && info.get(value)?.variant.cost && !line.cost) next.cost = (info.get(value).variant.cost / 100).toFixed(2)
    return next
  }))
  const suggestLowStock = () => {
    const low = products.flatMap((product) => product.variants
      .filter((variant) => ['low', 'out'].includes(stockStatus(onHand(state, variant.id, shopId, now), product.reorderPoint)))
      .map((variant) => ({ ...blankLine(), variantId: variant.id, cost: variant.cost ? (variant.cost / 100).toFixed(2) : '' })))
    setLines([...lines.filter((line) => line.variantId), ...low])
  }

  const parsed = lines.map((line) => ({ ...line, quantityValue: Number.parseInt(line.quantity, 10), costValue: parseCedis(line.cost), needsExpiry: info.get(line.variantId)?.product.tracksExpiry !== false }))
  const complete = (line) => line.variantId && line.lot.trim().length >= 2 && line.quantityValue > 0 && line.costValue !== null && (!line.needsExpiry || line.expiresOn)
  const ready = parsed.length > 0 && parsed.every(complete) && supplierId
  const total = parsed.reduce((sum, line) => sum + (complete(line) ? line.quantityValue * line.costValue : 0), 0)

  const submit = async (event) => {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    const payload = { branchId: shopId, supplierId, invoiceRef, lines: parsed.map((line) => ({ variantId: line.variantId, lot: line.lot, expiresOn: line.expiresOn || null, quantity: line.quantityValue, unitCost: line.costValue })) }
    const delivery = await run((store) => store.receiveDelivery(staff, payload), (result) => `Delivery ${result.id} recorded: ${result.lines.length} line${result.lines.length === 1 ? '' : 's'}, ${formatMoney(result.totalCost)}.`)
    setBusy(false)
    if (delivery) onClose()
  }

  return <Dialog title="Receive delivery" onClose={onClose} wide>
    <form className="stack" onSubmit={submit}>
      <div className="field-row">
        <label className="field"><span>Supplier</span><select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>{state.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        <label className="field"><span>Invoice / delivery note no. <em>optional</em></span><input value={invoiceRef} onChange={(event) => setInvoiceRef(event.target.value)} /></label>
      </div>
      <div className="table-card">
        <table className="table compact delivery-lines">
          <thead><tr><th scope="col">Product</th><th scope="col">Lot</th><th scope="col">Expiry</th><th scope="col" className="num">Qty</th><th scope="col" className="num">Cost/unit (GHS)</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>{parsed.map((line, index) => <tr key={line.key}>
            <td><select aria-label={`Product for line ${index + 1}`} value={line.variantId} onChange={(event) => update(line.key, 'variantId', event.target.value)}>
              <option value="">Choose…</option>
              {products.map((product) => <optgroup key={product.id} label={product.name}>{product.variants.map((variant) => <option key={variant.id} value={variant.id}>{product.name} · {variant.name}</option>)}</optgroup>)}
            </select></td>
            <td><input aria-label={`Lot for line ${index + 1}`} value={line.lot} onChange={(event) => update(line.key, 'lot', event.target.value.toUpperCase())} placeholder="On the box" /></td>
            <td><input aria-label={`Expiry for line ${index + 1}`} type="date" min={minExpiry} value={line.expiresOn} disabled={!line.needsExpiry} onChange={(event) => update(line.key, 'expiresOn', event.target.value)} /></td>
            <td className="num"><input aria-label={`Quantity for line ${index + 1}`} className="qty-input" inputMode="numeric" value={line.quantity} onChange={(event) => update(line.key, 'quantity', event.target.value.replace(/\D/g, '').slice(0, 4))} /></td>
            <td className="num"><input aria-label={`Cost per unit for line ${index + 1}`} className="qty-input wide" inputMode="decimal" value={line.cost} onChange={(event) => update(line.key, 'cost', event.target.value)} placeholder="0.00" /></td>
            <td><button type="button" className="icon-button subtle" aria-label={`Remove line ${index + 1}`} onClick={() => setLines(lines.filter((candidate) => candidate.key !== line.key))} disabled={lines.length === 1}><Icon name="trash" size={16} /></button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="row wrap">
        <button type="button" className="btn ghost small" onClick={() => setLines([...lines, blankLine()])}><Icon name="plus" size={15} />Add line</button>
        <button type="button" className="btn ghost small" onClick={suggestLowStock}>Add low-stock items</button>
        <span className="push strong">Total cost <Money value={total} /></span>
      </div>
      <ServerNote contract="receiveDelivery">each line becomes a batch with lot, expiry and unit cost; refused as a whole if any line is invalid or already expired</ServerNote>
      <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={!ready || busy}>{busy ? 'Recording…' : 'Record delivery'}</button></div>
    </form>
  </Dialog>
}

function SupplierDialog({ supplier, onClose }) {
  const { staff, run } = useOps()
  const [form, setForm] = useState({ id: supplier.id, name: supplier.name || '', contact: supplier.contact || '', phone: supplier.phone || '' })
  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value })
  const submit = async (event) => {
    event.preventDefault()
    if (form.name.trim().length < 2) return
    if (await run((store) => store.saveSupplier(staff, { supplier: form }), 'Supplier saved.')) onClose()
  }
  return <Dialog title={supplier.id ? `Edit ${supplier.name}` : 'Add supplier'} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <label className="field"><span>Supplier name</span><input data-autofocus value={form.name} onChange={set('name')} /></label>
      <div className="field-row">
        <label className="field"><span>Contact person</span><input value={form.contact} onChange={set('contact')} /></label>
        <label className="field"><span>Phone</span><input inputMode="tel" value={form.phone} onChange={set('phone')} /></label>
      </div>
      <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={form.name.trim().length < 2}>Save supplier</button></div>
    </form>
  </Dialog>
}
