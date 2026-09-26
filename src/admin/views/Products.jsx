import { useMemo, useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { can } from '../lib/permissions.js'
import { onHand } from '../lib/stock.js'
import { readWalkInSheet, WALK_IN_TEMPLATE } from '../lib/walkInImport.js'
import { formatMoney, parseCedis } from '../lib/money.js'
import { isValidBarcode } from '../lib/pricing.js'
import { Card, Dialog, Empty, Icon, Money, Pill, Segmented, ServerNote } from '../components/ui.jsx'
import { downloadCsv, fmtExpiry, fmtWhen } from '../components/format.js'

const marginPct = (price, cost) => (cost === null || cost === undefined || !price ? null : Math.round(((price - cost) / price) * 1000) / 10)

export default function Products() {
  const { state, staff, shopId } = useOps()
  const now = useNow(60000)
  const [query, setQuery] = useState('')
  const [show, setShow] = useState('active')
  const [importing, setImporting] = useState(false)
  const [editing, setEditing] = useState(null)
  const owner = can(staff, 'manageCatalog')
  const costs = can(staff, 'viewCosts')

  const rows = state.catalog.flatMap((product) => product.variants.map((variant) => {
    const units = onHand(state, variant.id, shopId, now) ?? 0
    return { product, variant, units, worth: units * variant.price }
  }))
  const needle = query.trim().toLowerCase()
  const visible = rows.filter((row) => {
    const active = row.product.active !== false
    if (show === 'active' && !active) return false
    if (show === 'counter' && (!active || !row.product.walkInOnly)) return false
    if (show === 'archived' && active) return false
    return !needle || `${row.product.name} ${row.variant.name} ${row.variant.sku} ${row.variant.barcode || ''} ${row.product.category}`.toLowerCase().includes(needle)
  })

  return <div className="stack">
    <div className="toolbar">
      <Segmented label="Products shown" value={show} onChange={setShow} options={[
        { value: 'active', label: 'Active', count: rows.filter((row) => row.product.active !== false).length },
        { value: 'counter', label: 'Counter only', count: rows.filter((row) => row.product.active !== false && row.product.walkInOnly).length },
        { value: 'archived', label: 'Archived', count: rows.filter((row) => row.product.active === false).length },
      ]} />
      <label className="search grow"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Product, size, SKU, barcode or category" aria-label="Search products" /></label>
      {owner ? <>
        <button type="button" className="btn secondary small" onClick={() => setImporting(true)}>Import walk-in items</button>
        <button type="button" className="btn primary small" onClick={() => setEditing({})}><Icon name="plus" size={15} />New product</button>
      </> : null}
    </div>
    <div className="table-card">
      <table className="table">
        <thead><tr><th scope="col">Product</th><th scope="col">SKU · barcode</th><th scope="col" className="hide-md">Sells on</th><th scope="col" className="num">Price</th>{costs ? <><th scope="col" className="num">Cost</th><th scope="col" className="num">Margin</th></> : null}<th scope="col" className="num">On shelf</th>{owner ? <th scope="col"><span className="sr-only">Edit</span></th> : null}</tr></thead>
        <tbody>{visible.map((row) => {
          const margin = marginPct(row.variant.price, row.variant.cost)
          return <tr key={row.variant.id} className={row.product.active === false ? 'row-muted' : ''}>
            <td><b>{row.product.name}</b><span className="muted small block">{row.variant.name} · {row.product.category}{row.product.tracksExpiry ? '' : ' · no expiry'}</span></td>
            <td><span className="mono small">{row.variant.sku}</span><span className="mono muted small block">{row.variant.barcode || 'no barcode'}</span></td>
            <td className="hide-md">{row.product.active === false ? <Pill tone="grey">Archived</Pill> : row.product.walkInOnly ? <Pill tone="violet">Counter only</Pill> : <Pill tone="blue">Website + counter</Pill>}</td>
            <td className="num"><Money value={row.variant.price} /></td>
            {costs ? <>
              <td className="num">{row.variant.cost !== null && row.variant.cost !== undefined ? <Money value={row.variant.cost} /> : <span className="muted">—</span>}</td>
              <td className="num">{margin === null ? <span className="muted">—</span> : <span className={margin < 30 ? 'warn-text' : ''}>{margin}%</span>}</td>
            </> : null}
            <td className="num">{row.units}</td>
            {owner ? <td className="num"><button type="button" className="link-button" onClick={() => setEditing(row.product)}>Edit</button></td> : null}
          </tr>
        })}</tbody>
      </table>
      {!visible.length ? <Empty title="No products match" /> : null}
    </div>
    <p className="muted small">Cost is the last price paid to a supplier; margin reports use each batch's own cost. Orders keep the prices they were sold at, so editing a price never changes past sales.</p>

    {costs && state.priceHistory.length ? <Card title="Price changes" flush>
      <ul className="list">{state.priceHistory.slice(0, 8).map((entry, index) => <li key={index} className="list-row static">
        <span className="list-main"><span><span className="mono small">{entry.sku}</span> <Money value={entry.from} /> → <b><Money value={entry.to} /></b></span><span className="muted small">{entry.by.name} · {fmtWhen(entry.at, now)}</span></span>
      </li>)}</ul>
    </Card> : null}

    {importing ? <ImportDialog onClose={() => setImporting(false)} /> : null}
    {editing ? <ProductDialog product={editing} onClose={() => setEditing(null)} /> : null}
  </div>
}

const cedis = (pesewas) => (pesewas === null || pesewas === undefined ? '' : (pesewas / 100).toFixed(2))

function ProductDialog({ product, onClose }) {
  const { state, staff, run } = useOps()
  const isNew = !product.id
  const categories = [...new Set(state.catalog.map((entry) => entry.category))]
  const [form, setForm] = useState(() => ({
    id: product.id,
    name: product.name || '',
    category: product.category || categories[0] || '',
    reorderPoint: String(product.reorderPoint ?? 5),
    walkInOnly: Boolean(product.walkInOnly),
    tracksExpiry: product.tracksExpiry !== false,
    active: product.active !== false,
    variants: (product.variants || [{}]).map((variant) => ({ id: variant.id, name: variant.name || '', sku: variant.sku || '', barcode: variant.barcode || '', price: cedis(variant.price), cost: cedis(variant.cost) })),
  }))
  const [busy, setBusy] = useState(false)
  const set = (field, value) => setForm({ ...form, [field]: value })
  const setVariant = (index, field, value) => setForm({ ...form, variants: form.variants.map((variant, position) => (position === index ? { ...variant, [field]: value } : variant)) })

  const variantProblems = form.variants.map((variant) => {
    if (!variant.name.trim()) return 'Size needed'
    if (!/^[A-Za-z0-9-]{3,20}$/.test(variant.sku.trim())) return 'SKU needed'
    if (variant.barcode && !isValidBarcode(variant.barcode.trim())) return 'Barcode check digit is wrong'
    if (!parseCedis(variant.price)) return 'Price needed'
    if (variant.cost && parseCedis(variant.cost) === null) return 'Cost is not an amount'
    return ''
  })
  const valid = form.name.trim().length >= 2 && form.category.trim() && /^\d{1,3}$/.test(form.reorderPoint) && variantProblems.every((problem) => !problem)

  const submit = async (event) => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    const payload = {
      ...form,
      reorderPoint: Number(form.reorderPoint),
      variants: form.variants.map((variant) => ({ id: variant.id, name: variant.name, sku: variant.sku, barcode: variant.barcode.trim(), price: parseCedis(variant.price), cost: variant.cost === '' ? null : parseCedis(variant.cost) })),
    }
    const saved = await run((store) => store.saveProduct(staff, { product: payload }), `${form.name.trim()} saved.`)
    setBusy(false)
    if (saved) onClose()
  }

  return <Dialog title={isNew ? 'New product' : `Edit ${product.name}`} onClose={onClose} wide>
    <form className="stack" onSubmit={submit}>
      <div className="field-row three">
        <label className="field"><span>Product name</span><input data-autofocus value={form.name} onChange={(event) => set('name', event.target.value)} /></label>
        <label className="field"><span>Category</span><input list="categories" value={form.category} onChange={(event) => set('category', event.target.value)} /><datalist id="categories">{categories.map((category) => <option key={category} value={category} />)}</datalist></label>
        <label className="field"><span>Reorder when at or below</span><input inputMode="numeric" value={form.reorderPoint} onChange={(event) => set('reorderPoint', event.target.value.replace(/\D/g, '').slice(0, 3))} /></label>
      </div>
      <div className="row wrap">
        <label className="check"><input type="checkbox" checked={!form.walkInOnly} onChange={(event) => set('walkInOnly', !event.target.checked)} /> Show on the website</label>
        <label className="check"><input type="checkbox" checked={form.tracksExpiry} onChange={(event) => set('tracksExpiry', event.target.checked)} /> Has an expiry date</label>
        {!isNew ? <label className="check"><input type="checkbox" checked={!form.active} onChange={(event) => set('active', !event.target.checked)} /> Archived (hidden from the till and website)</label> : null}
      </div>
      <div className="table-card">
        <table className="table compact">
          <thead><tr><th scope="col">Size / pack</th><th scope="col">SKU</th><th scope="col">Barcode</th><th scope="col" className="num">Price (GHS)</th><th scope="col" className="num">Cost (GHS)</th><th scope="col" className="num">Margin</th></tr></thead>
          <tbody>{form.variants.map((variant, index) => {
            const margin = marginPct(parseCedis(variant.price), variant.cost === '' ? null : parseCedis(variant.cost))
            return <tr key={variant.id || index}>
              <td><input aria-label={`Size ${index + 1}`} value={variant.name} onChange={(event) => setVariant(index, 'name', event.target.value)} placeholder="e.g. 30 ml" />{variantProblems[index] ? <span className="bad-text small block">{variantProblems[index]}</span> : null}</td>
              <td><input aria-label={`SKU ${index + 1}`} value={variant.sku} onChange={(event) => setVariant(index, 'sku', event.target.value.toUpperCase())} placeholder="SM-XXX-00" /></td>
              <td><input aria-label={`Barcode ${index + 1}`} className="mono" value={variant.barcode} onChange={(event) => setVariant(index, 'barcode', event.target.value.replace(/\s/g, ''))} placeholder="Scan or type" /></td>
              <td className="num"><input aria-label={`Price ${index + 1}`} className="qty-input wide" inputMode="decimal" value={variant.price} onChange={(event) => setVariant(index, 'price', event.target.value)} /></td>
              <td className="num"><input aria-label={`Cost ${index + 1}`} className="qty-input wide" inputMode="decimal" value={variant.cost} onChange={(event) => setVariant(index, 'cost', event.target.value)} /></td>
              <td className="num">{margin === null ? '—' : `${margin}%`}</td>
            </tr>
          })}</tbody>
        </table>
      </div>
      <div className="row"><button type="button" className="btn ghost small" onClick={() => set('variants', [...form.variants, { name: '', sku: '', barcode: '', price: '', cost: '' }])}><Icon name="plus" size={15} />Add size</button><span className="muted small">Sizes can't be removed once saved — archive the product instead.</span></div>
      <ServerNote contract="saveProduct">owner only; SKUs and barcodes must be unique; every price change is kept in the price history</ServerNote>
      <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={!valid || busy}>{busy ? 'Saving…' : 'Save product'}</button></div>
    </form>
  </Dialog>
}

function ImportDialog({ onClose }) {
  const { state, staff, run } = useOps()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const existingSkus = useMemo(() => new Set(state.catalog.flatMap((product) => product.variants.map((variant) => variant.sku))), [state.catalog])
  const preview = text.trim() ? readWalkInSheet(text, { branches: state.branches, existingSkus }) : null
  const good = preview?.rows.filter((row) => row.ok) || []

  const loadFile = (event) => {
    const file = event.target.files?.[0]
    if (!file || file.size > 512 * 1024) return
    file.text().then(setText)
  }
  const submit = async () => {
    if (!good.length || busy) return
    setBusy(true)
    const outcome = await run((store) => store.importWalkInProducts(staff, { text }), (value) => `Imported ${value.imported} walk-in item${value.imported === 1 ? '' : 's'}.`)
    setBusy(false)
    if (outcome) setResult(outcome)
  }

  return <Dialog title="Import walk-in items" onClose={onClose} wide>
    {result ? <div className="stack">
      <div className="callout info"><p><b>{result.imported} item{result.imported === 1 ? '' : 's'} added</b> as counter-only products with their opening stock.{result.skipped.length ? ` ${result.skipped.length} row(s) were skipped.` : ''}</p></div>
      <div className="row end"><button type="button" className="btn primary" onClick={onClose}>Done</button></div>
    </div> : <div className="stack">
      <p className="small">Paste rows from Excel or Google Sheets, or upload a CSV. The first row must be the column names. New SKUs only — existing products are never edited. Put the shop's quantity in the “{state.branches[0].short}” column, with the lot and expiry printed on the stock. A Cost column is read as cost only, never as the price.</p>
      <div className="row wrap">
        <button type="button" className="btn secondary small" onClick={() => downloadCsv('skinmatrix-walk-in-template.csv', WALK_IN_TEMPLATE(state.branches).split('\n').map((line) => line.split(',')))}><Icon name="download" size={15} />Download template</button>
        <label className="btn secondary small file-button">Upload CSV<input type="file" accept=".csv,text/csv,text/plain" onChange={loadFile} /></label>
        <button type="button" className="btn ghost small" onClick={() => setText(WALK_IN_TEMPLATE(state.branches))}>Paste example</button>
      </div>
      <label className="field"><span>Sheet</span><textarea data-autofocus rows={6} className="mono small" value={text} onChange={(event) => setText(event.target.value)} placeholder={`Name,Size,SKU,Price,Cost,Category,Lot,Expiry,${state.branches[0].short}`} /></label>
      {preview?.problems.length ? <div className="callout bad"><Icon name="alert" /><p>{preview.problems.join(' ')}</p></div> : null}
      {preview && !preview.problems.length ? <div className="table-card">
        <table className="table compact">
          <thead><tr><th scope="col">Row</th><th scope="col">Item</th><th scope="col" className="num">Price</th><th scope="col">Lot · expiry</th><th scope="col">Stock</th><th scope="col">Check</th></tr></thead>
          <tbody>{preview.rows.map((row) => <tr key={row.line} className={row.ok ? '' : 'row-bad'}>
            <td className="mono">{row.line}</td>
            <td><b>{row.value.name || '—'}</b><span className="muted small block">{row.value.variantName} · <span className="mono">{row.value.sku || '—'}</span></span></td>
            <td className="num">{row.value.price ? formatMoney(row.value.price) : '—'}</td>
            <td className="small">{row.value.lot || '—'} · {row.value.tracksExpiry ? (row.value.expiresOn ? fmtExpiry(row.value.expiresOn) : '—') : 'no expiry'}</td>
            <td className="small">{Object.values(row.value.quantities).join(' · ') || '—'}</td>
            <td className="small">{row.ok ? <span className="good-text">Ready{row.warnings.length ? ` · ${row.warnings.join(' ')}` : ''}</span> : <span className="bad-text">{row.errors.join(' ')}</span>}</td>
          </tr>)}</tbody>
        </table>
      </div> : null}
      <ServerNote contract="importWalkInProducts">the server re-validates the sheet, adds new SKUs only and records each opening batch</ServerNote>
      <div className="row end">
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={!good.length || busy} onClick={submit}>{busy ? 'Importing…' : `Import ${good.length} item${good.length === 1 ? '' : 's'}`}</button>
      </div>
    </div>}
  </Dialog>
}
