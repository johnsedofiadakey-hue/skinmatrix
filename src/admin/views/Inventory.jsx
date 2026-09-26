import { useMemo, useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { can, canAccessBranch } from '../lib/permissions.js'
import { batchesAt, daysUntil, expiredUnits, expiryStatus, heldUnits, isListed, onHand, stockStatus, stockValue } from '../lib/stock.js'
import { formatMoney } from '../lib/money.js'
import { Card, Dialog, Empty, Icon, Money, Pill, ReasonDialog, Segmented, ServerNote, Stat } from '../components/ui.jsx'
import { EXPIRY_LABEL, EXPIRY_TONE, fmtExpiry, fmtWhen } from '../components/format.js'

const KIND_LABEL = { sale: 'Sale', reserve: 'MoMo hold', release: 'Hold released', restock: 'Returned (cancel/void)', adjustment: 'Adjustment', correction: 'Sale correction', count: 'Stock take', write_off: 'Expired write-off', opening: 'Opening stock' }
const TABS = [
  { value: 'stock', label: 'Stock' },
  { value: 'expiry', label: 'Expiry' },
  { value: 'count', label: 'Stock take' },
  { value: 'value', label: 'Value' },
]

// Staff get a read-only stock lookup; expiry work, counts and stock value are for managers and the owner.
const TAB_CAPABILITY = { stock: 'viewInventory', expiry: 'adjustStock', count: 'countStock', value: 'viewCosts' }

export default function Inventory({ tab = 'stock' }) {
  const { staff } = useOps()
  const tabs = TABS.filter((item) => can(staff, TAB_CAPABILITY[item.value]))
  const current = tabs.some((item) => item.value === tab) ? tab : 'stock'
  return <div className="stack">
    {tabs.length > 1 ? <Segmented label="Inventory view" value={current} onChange={(value) => { window.location.hash = `#/inventory/${value}` }} options={tabs} /> : null}
    {current === 'stock' ? <StockTab /> : null}
    {current === 'expiry' ? <ExpiryTab /> : null}
    {current === 'count' ? <CountTab /> : null}
    {current === 'value' ? <ValueTab /> : null}
  </div>
}

// ── Stock ────────────────────────────────────────────────────────────────────────────────────────
function StockTab() {
  const { state, staff, branchIds, branchName } = useOps()
  const now = useNow(60000)
  const [query, setQuery] = useState('')
  const [show, setShow] = useState('all')
  const [selected, setSelected] = useState(null)
  const branches = state.branches.filter((branch) => branchIds.includes(branch.id))

  const rows = state.catalog.flatMap((product) => product.variants.map((variant) => {
    const cells = branches.map((branch) => {
      const quantity = onHand(state, variant.id, branch.id, now)
      return { branch, quantity, held: heldUnits(state.holds, variant.id, branch.id), expired: expiredUnits(state, variant.id, branch.id, now), status: stockStatus(quantity, product.reorderPoint) }
    })
    return { product, variant, cells, total: cells.reduce((sum, cell) => sum + (cell.quantity ?? 0), 0) }
  }))
  const flagged = (row, status) => row.cells.some((cell) => cell.status === status)
  const counts = { low: rows.filter((row) => flagged(row, 'low')).length, out: rows.filter((row) => flagged(row, 'out')).length }

  const needle = query.trim().toLowerCase()
  const visible = rows.filter((row) =>
    (show === 'all' || flagged(row, show)) &&
    (!needle || `${row.product.name} ${row.variant.name} ${row.variant.sku} ${row.product.category}`.toLowerCase().includes(needle)))

  return <>
    <div className="toolbar">
      <Segmented label="Stock filter" value={show} onChange={setShow} options={[
        { value: 'all', label: 'All lines', count: rows.length },
        { value: 'low', label: 'Low', count: counts.low },
        { value: 'out', label: 'Out', count: counts.out },
      ]} />
      <label className="search grow"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Product, size, SKU or category" aria-label="Search inventory" /></label>
    </div>

    <div className="table-card">
      <table className="table inventory-table">
        <thead><tr>
          <th scope="col">Product</th>
          <th scope="col" className="hide-sm">SKU</th>
          {branches.map((branch) => <th scope="col" key={branch.id} className="num">{branch.short}</th>)}
          {branches.length > 1 ? <th scope="col" className="num">Total</th> : null}
          <th scope="col"><span className="sr-only">Open</span></th>
        </tr></thead>
        <tbody>{visible.map((row) => <tr key={row.variant.id} className="clickable" onClick={() => setSelected(row.variant.id)}>
          <td><b>{row.product.name}</b>{row.product.walkInOnly ? <Pill tone="violet">Counter only</Pill> : null}<span className="muted small block">{row.variant.name} · reorder at {row.product.reorderPoint}</span></td>
          <td className="mono small hide-sm">{row.variant.sku}</td>
          {row.cells.map((cell) => <td key={cell.branch.id} className="num">
            <span className={`stock-cell ${cell.status}`}>{cell.quantity === null ? 'Not stocked' : cell.quantity}</span>
            {cell.held ? <span className="muted small block">{cell.held} held</span> : null}
            {cell.expired ? <span className="bad-text small block">{cell.expired} expired</span> : null}
          </td>)}
          {branches.length > 1 ? <td className="num strong">{row.total}</td> : null}
          <td className="num"><button type="button" className="link-button" onClick={(event) => { event.stopPropagation(); setSelected(row.variant.id) }}>Batches{can(staff, 'adjustStock') ? ' · Adjust' : ''}</button></td>
        </tr>)}</tbody>
      </table>
      {!visible.length ? <Empty title="No stock lines match" /> : null}
    </div>
    <p className="muted small">Numbers are sellable units: on the shelf and not expired. Units held for a pending MoMo prompt are already off the shelf. “Not stocked” means the branch does not carry the line; other branches' stock is never used instead. {can(staff, 'crossBranch') ? '' : `Showing ${branchName(staff.branchId)} only.`}</p>

    {selected ? <VariantPanel variantId={selected} onClose={() => setSelected(null)} /> : null}
  </>
}

function VariantPanel({ variantId, onClose }) {
  const { state, staff, run, branchIds, branchName } = useOps()
  const now = useNow(30000)
  const product = state.catalog.find((candidate) => candidate.variants.some((variant) => variant.id === variantId))
  const variant = product.variants.find((candidate) => candidate.id === variantId)
  const adjustable = state.branches.filter((branch) => canAccessBranch(staff, branch.id))
  const [branchId, setBranchId] = useState(branchIds[0] && canAccessBranch(staff, branchIds[0]) ? branchIds[0] : staff.branchId)
  const [direction, setDirection] = useState('add')
  const [target, setTarget] = useState('new')
  const [lot, setLot] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const branchBatches = batchesAt(state, variantId, branchId)
  const quantity = Number.parseInt(amount, 10)
  const delta = Number.isInteger(quantity) && quantity > 0 ? (direction === 'add' ? quantity : -quantity) : 0
  const chosenBatch = branchBatches.find((batch) => batch.id === target)
  const creating = direction === 'add' && target === 'new'
  const valid = delta !== 0 && reason.trim().length >= 5 && (creating
    ? lot.trim().length >= 2 && (!product.tracksExpiry || expiresOn)
    : chosenBatch && chosenBatch.quantity + delta >= 0)
  const movements = state.movements.filter((movement) => movement.variantId === variantId && branchIds.includes(movement.branchId)).slice(0, 30)

  const submit = async (event) => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    const payload = { variantId, branchId, delta, reason, ...(creating ? { newBatch: { lot, expiresOn: expiresOn || null } } : { batchId: target }) }
    const result = await run((store) => store.adjustStock(staff, payload), (outcome) => `${variant.sku} lot ${outcome.lot} at ${branchName(branchId)}: ${outcome.before} → ${outcome.after}.`)
    setBusy(false)
    if (result) { setAmount(''); setReason(''); setLot(''); setExpiresOn(''); setTarget('new') }
  }
  const presets = direction === 'add' ? ['Supplier delivery received', 'Stock count correction', 'Customer return, resaleable'] : ['Damaged — written off', 'Expired — written off', 'Tester opened for display', 'Stock count correction']

  return <Dialog title={`${product.name} · ${variant.name}`} onClose={onClose} wide>
    <div className="panel-grid">
      <div className="stack">
        <dl className="facts">
          <dt>SKU</dt><dd className="mono">{variant.sku}</dd>
          <dt>Price</dt><dd><Money value={variant.price} /></dd>
          <dt>Sold</dt><dd>{product.walkInOnly ? 'At the counter only (hidden from the website)' : 'Website and counter'}</dd>
          <dt>Expiry</dt><dd>{product.tracksExpiry ? 'Tracked per batch' : 'Does not expire'}</dd>
        </dl>
        {state.branches.filter((branch) => branchIds.includes(branch.id)).map((branch) => {
          const list = batchesAt(state, variantId, branch.id)
          return <div key={branch.id} className="batch-block">
            <p className="batch-head"><b>{branch.short}</b><span className="muted small">{isListed(state, variantId, branch.id) ? `${onHand(state, variantId, branch.id, now)} sellable` : 'Not stocked'}</span></p>
            {list.length ? <table className="table compact"><tbody>{list.map((batch) => {
              const status = expiryStatus(batch.expiresOn, now)
              return <tr key={batch.id}><td className="mono">{batch.lot}</td><td>{fmtExpiry(batch.expiresOn)}</td><td><Pill tone={EXPIRY_TONE[status]}>{EXPIRY_LABEL[status]}</Pill></td><td className="num strong">{batch.quantity}</td></tr>
            })}</tbody></table> : null}
          </div>
        })}

        {can(staff, 'adjustStock') ? <Card title="Adjust stock">
          <form className="stack" onSubmit={submit}>
            <div className="field-row">
              <label className="field"><span>Branch</span>
                <select value={branchId} onChange={(event) => { setBranchId(event.target.value); setTarget('new') }}>{adjustable.map((branch) => <option key={branch.id} value={branch.id}>{branch.short}</option>)}</select>
              </label>
              <label className="field"><span>Units</span><input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="0" /></label>
            </div>
            <Segmented label="Direction" value={direction} onChange={(value) => { setDirection(value); setTarget(value === 'add' ? 'new' : branchBatches[0]?.id || '') }} options={[{ value: 'add', label: 'Add to shelf' }, { value: 'remove', label: 'Remove from shelf' }]} />
            <label className="field"><span>Batch</span>
              <select value={target} onChange={(event) => setTarget(event.target.value)}>
                {direction === 'add' ? <option value="new">New delivery batch…</option> : null}
                {direction === 'remove' && !branchBatches.length ? <option value="">No batches here</option> : null}
                {branchBatches.map((batch) => <option key={batch.id} value={batch.id}>Lot {batch.lot} · {fmtExpiry(batch.expiresOn)} · {batch.quantity} units</option>)}
              </select>
            </label>
            {creating ? <div className="field-row">
              <label className="field"><span>Lot / batch no.</span><input value={lot} onChange={(event) => setLot(event.target.value)} placeholder="As printed on the box" /></label>
              <label className="field"><span>Expiry date {product.tracksExpiry ? '' : <em>optional</em>}</span><input type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} /></label>
            </div> : null}
            <div className="chip-row">{presets.map((preset) => <button type="button" key={preset} className="chip" onClick={() => setReason(preset)}>{preset}</button>)}</div>
            <label className="field"><span>Reason <em>required · audited</em></span><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} /></label>
            <button type="submit" className="btn primary" disabled={!valid || busy}>{busy ? 'Saving…' : 'Record adjustment'}</button>
            <ServerNote contract="adjustStock">applied to one batch in a server transaction, with a movement and audit entry</ServerNote>
          </form>
        </Card> : <p className="muted small">Your role can view stock but not adjust it.</p>}
      </div>

      <div>
        <h3 className="panel-subhead">Stock movements</h3>
        {movements.length ? <ul className="movements">
          {movements.map((movement) => <li key={movement.id}>
            <span className={`delta ${movement.delta > 0 ? 'up' : 'down'}`}>{movement.delta > 0 ? '+' : '−'}{Math.abs(movement.delta)}</span>
            <div>
              <p><b>{KIND_LABEL[movement.kind] || movement.kind}</b> · {branchName(movement.branchId)}{movement.lot ? <> · lot <span className="mono small">{movement.lot}</span></> : null}{movement.ref ? <> · <span className="mono small">{movement.ref}</span></> : null}</p>
              <p className="muted small">{movement.actorName} · {fmtWhen(movement.at, now)}{movement.reason ? ` · ${movement.reason}` : ''}</p>
            </div>
          </li>)}
        </ul> : <p className="muted small">No recorded movements for this line.</p>}
      </div>
    </div>
  </Dialog>
}

// ── Expiry ───────────────────────────────────────────────────────────────────────────────────────
function ExpiryTab() {
  const { state, staff, run, branchIds, branchName } = useOps()
  const now = useNow(60000)
  const [show, setShow] = useState('attention')
  const [writingOff, setWritingOff] = useState(null)
  const index = useMemo(() => new Map(state.catalog.flatMap((product) => product.variants.map((variant) => [variant.id, { product, variant }]))), [state.catalog])

  const batches = state.batches
    .filter((batch) => branchIds.includes(batch.branchId) && batch.quantity > 0 && batch.expiresOn && index.has(batch.variantId))
    .map((batch) => ({ ...batch, status: expiryStatus(batch.expiresOn, now), ...index.get(batch.variantId) }))
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
  const counts = { expired: 0, urgent: 0, soon: 0 }
  for (const batch of batches) if (counts[batch.status] !== undefined) counts[batch.status] += batch.quantity
  const visible = batches.filter((batch) => show === 'all' || (show === 'attention' ? batch.status !== 'ok' : batch.status === show))
  const expiredByBranch = branchIds.map((id) => ({ id, units: batches.filter((batch) => batch.branchId === id && batch.status === 'expired').reduce((sum, batch) => sum + batch.quantity, 0) })).filter((entry) => entry.units)

  return <>
    <div className="stat-grid">
      <Stat label="Expired on shelf" value={counts.expired} tone={counts.expired ? 'bad' : ''} sub="Cannot be sold — write off" />
      <Stat label="Expiring ≤30 days" value={counts.urgent} tone={counts.urgent ? 'bad' : ''} sub="Sold first automatically" />
      <Stat label="Expiring ≤90 days" value={counts.soon} tone={counts.soon ? 'warn' : ''} sub="Consider promoting" />
    </div>
    {expiredByBranch.length && can(staff, 'adjustStock') ? <div className="callout bad">
      <Icon name="alert" />
      <p><b>Expired stock is still on the shelf.</b> The POS already refuses to sell it. Pull it and record the write-off.</p>
      <div className="row">{expiredByBranch.map((entry) => canAccessBranch(staff, entry.id) ? <button key={entry.id} type="button" className="btn danger small" onClick={() => setWritingOff(entry)}>Write off {entry.units} at {branchName(entry.id)}</button> : null)}</div>
    </div> : null}
    <Segmented label="Expiry filter" value={show} onChange={setShow} options={[
      { value: 'attention', label: 'Needs attention' }, { value: 'expired', label: 'Expired' }, { value: 'urgent', label: '≤30 days' }, { value: 'soon', label: '≤90 days' }, { value: 'all', label: 'All batches' },
    ]} />
    <div className="table-card">
      <table className="table">
        <thead><tr><th scope="col">Product</th><th scope="col">Lot</th><th scope="col" className="hide-md">Branch</th><th scope="col">Expires</th><th scope="col">Status</th><th scope="col" className="num">Units</th><th scope="col" className="num hide-sm">Worth</th></tr></thead>
        <tbody>{visible.map((batch) => {
          const days = daysUntil(batch.expiresOn, now)
          return <tr key={batch.id}>
            <td><b>{batch.product.name}</b><span className="muted small block">{batch.variant.name} · {batch.variant.sku}</span></td>
            <td className="mono">{batch.lot}</td>
            <td className="hide-md nowrap">{branchName(batch.branchId)}</td>
            <td className="nowrap">{fmtExpiry(batch.expiresOn)}<span className="muted small block">{days < 0 ? `${-days} days ago` : days === 0 ? 'today' : `in ${days} days`}</span></td>
            <td><Pill tone={EXPIRY_TONE[batch.status]}>{EXPIRY_LABEL[batch.status]}</Pill></td>
            <td className="num strong">{batch.quantity}</td>
            <td className="num hide-sm"><Money value={batch.quantity * batch.variant.price} /></td>
          </tr>
        })}</tbody>
      </table>
      {!visible.length ? <Empty title="Nothing here">No batches match this filter.</Empty> : null}
    </div>
    <p className="muted small">Every sale takes the soonest-expiring batch first. A batch stops being sellable the day after its expiry date.</p>
    {writingOff ? <ReasonDialog
      title={`Write off expired stock at ${branchName(writingOff.id)}`}
      intro={<p className="small">{writingOff.units} expired unit{writingOff.units === 1 ? '' : 's'} will be removed from their batches and recorded as “Expired — written off”. Confirm the units have been physically pulled from the shelf.</p>}
      presets={['Pulled from shelf and destroyed', 'Pulled from shelf, returned to supplier']}
      confirmLabel="Write off"
      destructive
      contract="writeOffExpired"
      onConfirm={async () => Boolean(await run((store) => store.writeOffExpired(staff, { branchId: writingOff.id }), (result) => `Wrote off ${result.units} units (${formatMoney(result.worth)} at selling price).`))}
      onClose={() => setWritingOff(null)} /> : null}
  </>
}

// ── Stock take ───────────────────────────────────────────────────────────────────────────────────
function CountTab() {
  const { state, staff, store, toast, branchIds, branchName } = useOps()
  const now = useNow(60000)
  const countable = state.branches.filter((branch) => branchIds.includes(branch.id) && canAccessBranch(staff, branch.id))
  const [branchId, setBranchId] = useState(countable[0]?.id || staff.branchId)
  const [sheet, setSheet] = useState(null) // { branchId, lines: [{ batchId, expected }] } frozen when counting starts
  const [counts, setCounts] = useState({})
  const [blind, setBlind] = useState(true)
  const [note, setNote] = useState('')
  const [stale, setStale] = useState([])
  const [busy, setBusy] = useState(false)
  const index = useMemo(() => new Map(state.catalog.flatMap((product) => product.variants.map((variant) => [variant.id, { product, variant }]))), [state.catalog])

  const start = () => {
    const lines = state.batches.filter((batch) => batch.branchId === branchId && batch.quantity > 0 && index.has(batch.variantId))
      .sort((a, b) => index.get(a.variantId).product.name.localeCompare(index.get(b.variantId).product.name) || (a.expiresOn || '').localeCompare(b.expiresOn || ''))
      .map((batch) => ({ batchId: batch.id, expected: batch.quantity }))
    setSheet({ branchId, lines, startedAt: Date.now() })
    setCounts({})
    setStale([])
    setNote('')
  }
  const batch = (id) => state.batches.find((candidate) => candidate.id === id)
  const entered = sheet ? sheet.lines.filter((line) => counts[line.batchId] !== undefined && counts[line.batchId] !== '') : []
  const differing = entered.filter((line) => Number(counts[line.batchId]) !== line.expected)
  const allCounted = sheet && entered.length === sheet.lines.length

  const submit = async () => {
    if (!allCounted || busy) return
    setBusy(true)
    try {
      const lines = sheet.lines.map((line) => ({ batchId: line.batchId, expected: line.expected, counted: Number(counts[line.batchId]) }))
      const record = await store.submitStockCount(staff, { branchId: sheet.branchId, lines, note })
      toast(differing.length ? `Stock take ${record.id} saved. ${differing.length} line${differing.length === 1 ? '' : 's'} adjusted.` : `Stock take ${record.id} saved. Everything matched.`)
      setSheet(null)
    } catch (error) {
      if (error.code === 'stale_count') {
        // Refresh only the lines that moved and ask for a recount of those.
        const moved = new Map(error.stale.map((entry) => [entry.batchId, entry.now]))
        setSheet({ ...sheet, lines: sheet.lines.map((line) => (moved.has(line.batchId) ? { ...line, expected: moved.get(line.batchId) } : line)) })
        setCounts((current) => { const next = { ...current }; for (const id of moved.keys()) delete next[id]; return next })
        setStale([...moved.keys()])
      }
      toast(error.message, 'error')
    }
    setBusy(false)
  }

  const history = state.stockCounts.filter((record) => branchIds.includes(record.branchId)).slice(0, 8)

  if (!can(staff, 'countStock')) return <Empty title="Stock takes are done by branch managers and inventory staff" />

  if (!sheet) return <div className="stack gap-lg">
    <Card title="Start a stock take">
      <p className="small">Count what is physically on the shelf, batch by batch. Differences are applied when you submit, with your note, and kept as a record. If a sale happens while you count, those lines are refreshed for a recount.</p>
      <div className="row wrap">
        {countable.length > 1 ? <label className="field compact"><span>Branch</span>
          <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>{countable.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>
        </label> : null}
        <button type="button" className="btn primary" onClick={start}>Open count sheet</button>
      </div>
    </Card>
    <Card title="Recent stock takes" flush>
      {history.length ? <table className="table">
        <thead><tr><th scope="col">Count</th><th scope="col">When</th><th scope="col" className="hide-md">By</th><th scope="col" className="num">Lines</th><th scope="col" className="num">Differed</th><th scope="col">Note</th></tr></thead>
        <tbody>{history.map((record) => {
          const diff = record.lines.filter((line) => line.counted !== line.expected)
          const net = diff.reduce((sum, line) => sum + line.counted - line.expected, 0)
          return <tr key={record.id}>
            <td className="mono">{record.id}<span className="muted small block">{branchName(record.branchId)}</span></td>
            <td className="nowrap">{fmtWhen(record.at, now)}</td>
            <td className="hide-md">{record.by.name}</td>
            <td className="num">{record.lines.length}</td>
            <td className="num">{diff.length ? <span className={net < 0 ? 'bad-text' : 'good-text'}>{diff.length} ({net > 0 ? '+' : ''}{net})</span> : <span className="good-text">All matched</span>}</td>
            <td className="small">{record.note || '—'}</td>
          </tr>
        })}</tbody>
      </table> : <Empty title="No stock takes yet" />}
    </Card>
  </div>

  return <div className="stack">
    <div className="toolbar">
      <div><b>Counting {branchName(sheet.branchId)}</b><span className="muted small block">{entered.length} of {sheet.lines.length} lines counted · sheet opened {fmtWhen(sheet.startedAt, now)}</span></div>
      <label className="check push"><input type="checkbox" checked={blind} onChange={(event) => setBlind(event.target.checked)} /> Blind count (hide system numbers)</label>
      <button type="button" className="btn ghost small" onClick={() => setSheet(null)}>Discard sheet</button>
    </div>
    {stale.length ? <div className="callout warn"><Icon name="alert" /><p><b>{stale.length} line{stale.length === 1 ? '' : 's'} changed while you were counting</b> (probably a sale). Recount the highlighted lines.</p></div> : null}
    <div className="table-card">
      <table className="table count-table">
        <thead><tr><th scope="col">Product</th><th scope="col">Lot · expiry</th>{blind ? null : <th scope="col" className="num">System</th>}<th scope="col" className="num">Counted</th><th scope="col" className="num">Difference</th></tr></thead>
        <tbody>{sheet.lines.map((line) => {
          const info = index.get(batch(line.batchId)?.variantId)
          const value = counts[line.batchId] ?? ''
          const diff = value === '' ? null : Number(value) - line.expected
          return <tr key={line.batchId} className={stale.includes(line.batchId) ? 'row-warn' : ''}>
            <td><b>{info?.product.name}</b><span className="muted small block">{info?.variant.name} · {info?.variant.sku}</span></td>
            <td><span className="mono">{batch(line.batchId)?.lot}</span><span className="muted small block">{fmtExpiry(batch(line.batchId)?.expiresOn)}</span></td>
            {blind ? null : <td className="num">{line.expected}</td>}
            <td className="num"><input className="qty-input" inputMode="numeric" value={value} aria-label={`Counted units of ${info?.product.name} ${info?.variant.name} (${info?.variant.sku}) lot ${batch(line.batchId)?.lot}`} onChange={(event) => setCounts({ ...counts, [line.batchId]: event.target.value.replace(/\D/g, '').slice(0, 4) })} /></td>
            <td className="num">{diff === null ? <span className="muted">—</span> : blind && diff !== 0 ? <span className="warn-text">Differs</span> : diff === 0 ? <span className="good-text">✓</span> : <span className={diff < 0 ? 'bad-text' : 'good-text'}>{diff > 0 ? '+' : ''}{diff}</span>}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
    <Card>
      <div className="stack">
        <p className="small">{allCounted ? (differing.length ? <b className="warn-text">{differing.length} line{differing.length === 1 ? '' : 's'} differ from the system.</b> : <b className="good-text">Everything matches.</b>) : `Count every line to submit (${sheet.lines.length - entered.length} left).`}</p>
        {differing.length ? <label className="field"><span>Note <em>required when lines differ · audited</em></span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Monthly count; 1 SPF found damaged" /></label> : null}
        <div className="row"><button type="button" className="btn primary" disabled={!allCounted || busy || (differing.length > 0 && note.trim().length < 5)} onClick={submit}>{busy ? 'Submitting…' : 'Submit stock take'}</button></div>
        <ServerNote contract="submitStockCount">refused if any batch moved since the sheet opened; differences applied as audited count movements</ServerNote>
      </div>
    </Card>
  </div>
}

// ── Value ────────────────────────────────────────────────────────────────────────────────────────
function ValueTab() {
  const { state, branchIds, branchName } = useOps()
  const now = useNow(60000)
  const value = stockValue(state, branchIds, now)
  const categories = [...new Set(state.catalog.map((product) => product.category))].map((category) => {
    const products = state.catalog.filter((product) => product.category === category)
    const row = { category, units: 0, worth: 0, byBranch: Object.fromEntries(branchIds.map((id) => [id, 0])), low: 0, out: 0 }
    for (const product of products) {
      for (const variant of product.variants) {
        for (const id of branchIds) {
          const units = onHand(state, variant.id, id, now)
          if (units === null) continue
          row.units += units
          row.worth += units * variant.price
          row.byBranch[id] += units
          const status = stockStatus(units, product.reorderPoint)
          if (status === 'low') row.low += 1
          if (status === 'out') row.out += 1
        }
      }
    }
    return row
  }).sort((a, b) => b.worth - a.worth)

  return <>
    <div className="stat-grid">
      <Stat label="Sellable stock" value={<Money value={value.total.worth} />} sub={`${value.total.units} units at selling price`} />
      {branchIds.map((id) => <Stat key={id} label={branchName(id)} value={<Money value={value.byBranch[id].worth} />} sub={`${value.byBranch[id].units} units · ${value.total.worth ? Math.round((value.byBranch[id].worth / value.total.worth) * 100) : 0}%`} />)}
      <Stat label="Expiring ≤90 days" value={<Money value={value.total.soonWorth} />} tone={value.total.soonUnits ? 'warn' : ''} sub={`${value.total.soonUnits} units`} />
      <Stat label="Expired on shelf" value={<Money value={value.total.expiredWorth} />} tone={value.total.expiredUnits ? 'bad' : ''} sub={`${value.total.expiredUnits} units — not sellable`} />
    </div>
    <div className="table-card">
      <table className="table">
        <thead><tr><th scope="col">Category</th>{branchIds.map((id) => <th scope="col" key={id} className="num hide-sm">{branchName(id)}</th>)}<th scope="col" className="num">Units</th><th scope="col" className="num">Worth</th><th scope="col" className="num">Share</th><th scope="col">Attention</th></tr></thead>
        <tbody>{categories.map((row) => <tr key={row.category}>
          <td><b>{row.category}</b></td>
          {branchIds.map((id) => <td key={id} className="num hide-sm">{row.byBranch[id]}</td>)}
          <td className="num">{row.units}</td>
          <td className="num strong"><Money value={row.worth} /></td>
          <td className="num">{value.total.worth ? Math.round((row.worth / value.total.worth) * 100) : 0}%</td>
          <td>{row.out ? <Pill tone="red">{row.out} out</Pill> : null} {row.low ? <Pill tone="amber">{row.low} low</Pill> : null}{!row.out && !row.low ? <span className="muted small">—</span> : null}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="muted small">Worth is units × selling price. Cost prices are not recorded, so margin is not shown.</p>
  </>
}
