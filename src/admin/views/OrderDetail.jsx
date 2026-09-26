import { useMemo, useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { can } from '../lib/permissions.js'
import { STATUS, transitionOptions } from '../lib/orderStates.js'
import { onHand, stockDeltas } from '../lib/stock.js'
import { formatMoney, sumPesewas } from '../lib/money.js'
import { buildCustomers, callLink, normalizePhone, whatsappLink } from '../lib/customers.js'
import { returnedQuantity, returnValue } from '../lib/pricing.js'
import { RIDER_VEHICLES } from '../demo/opsStore.js'
import { Card, ChannelTag, Dialog, Empty, Icon, Money, PaymentPill, Pill, ReasonDialog, Segmented, ServerNote, StatusPill } from '../components/ui.jsx'
import { fmtExpiryMonth, fmtFull, fmtWhen, paymentLabel, ROLE_LABEL } from '../components/format.js'

const countUnits = (lines) => lines.reduce((total, line) => total + line.quantity, 0)
const CANCEL_PRESETS = ['Customer changed their mind', 'Wrong item rung up', 'Payment not completed', 'Duplicate order']

export default function OrderDetail({ orderId }) {
  const { state, staff, run, branchName, staffName, multiBranch } = useOps()
  const now = useNow(30000)
  const [pending, setPending] = useState(null)
  const [dialog, setDialog] = useState(null) // 'correct' | 'branch' | 'rider' | 'return'
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const customers = useMemo(() => buildCustomers(state.orders), [state.orders])

  const order = state.orders.find((candidate) => candidate.id === orderId)
  if (!order) return <Empty title={`Order ${orderId} not found`}><a className="link" href="#/orders">Back to orders</a></Empty>
  if (!can(staff, 'crossBranch') && order.branchId !== staff.branchId) {
    return <Empty title={order.branchId ? 'This order belongs to another branch' : 'A manager is handling this order'}>{order.branchId ? `Your role can only open orders for ${branchName(staff.branchId)}.` : 'It is waiting for stock before it can be prepared.'}</Empty>
  }

  const options = transitionOptions({ order, staff, now })
  const forward = options.filter((option) => !option.destructive)
  const cancel = options.find((option) => option.destructive)
  const open = ![STATUS.FULFILLED, STATUS.CANCELLED].includes(order.status)

  const move = async (option, reason = '') => {
    setBusy(option.to)
    const result = await run((store, approval) => store.setOrderStatus(staff, { orderId: order.id, to: option.to, reason, approval }), (outcome) => {
      if (option.to !== STATUS.CANCELLED) return `${order.id}: ${option.to.toLowerCase()}.`
      return outcome.restocked ? `${order.id} cancelled. Recorded stock returned to its batches.` : `${order.id} cancelled. No stock had been taken, so none was returned.`
    })
    setBusy('')
    return Boolean(result)
  }

  const addNote = async (event) => {
    event.preventDefault()
    if (!note.trim()) return
    const result = await run((store) => store.addOrderNote(staff, { orderId: order.id, text: note }), 'Note added.')
    if (result) setNote('')
  }

  // Staff can start a correction, void or return; the server asks for a manager's PIN when their role isn't enough.
  const correctable = order.channel === 'pos' && order.status === STATUS.FULFILLED && !(order.returns || []).length && can(staff, 'pos')
  const returnable = order.status === STATUS.FULFILLED && ['paid', 'part_refunded'].includes(order.payment.state) && (can(staff, 'pos') || can(staff, 'returns'))
  const needsApproval = (option) => !option.allowed && option.to === STATUS.CANCELLED && !['Outside your branch', 'Assign a fulfilling branch first'].includes(option.why)
  const progress = can(staff, 'progressOrders') && open && order.branchId
  const branchStaff = state.staff.filter((member) => member.branchId === order.branchId && member.active !== false)
  const canChooseBranch = can(staff, 'crossBranch') && open && !order.stockDeductions
  const rider = order.fulfilment.rider
  const history = customers.get(normalizePhone(order.customer?.phone))
  const received = order.payment.method === 'cash' ? order.payment.tendered : order.payment.amountReceived
  const lots = new Map(state.batches.map((batch) => [batch.id, batch]))
  const skuOf = new Map(order.items.map((item) => [item.variantId, item.sku]))

  return <div className="stack gap-lg">
    <div className="detail-head">
      <a href="#/orders" className="back"><Icon name="back" size={16} />Orders</a>
      <div className="detail-title">
        <h2 className="mono">{order.id}</h2>
        <ChannelTag channel={order.channel} />
        <StatusPill status={order.status} />
        <PaymentPill payment={order.payment} />
        {order.needsBranch ? <Pill tone="red">Waiting for stock</Pill> : null}
      </div>
      <p className="muted">{order.channel === 'pos' ? 'Walk-in counter sale' : order.fulfilment.method === 'delivery' ? 'Online order · delivery' : 'Online order · pickup'} · placed {fmtFull(order.createdAt)}{multiBranch ? ` · ${order.branchId ? branchName(order.branchId) : 'no branch yet'}` : ''}</p>
    </div>

    {order.needsBranch ? <div className="callout bad">
      <Icon name="alert" />
      <p><b>Paid, but the shop didn't have enough stock for every item.</b> No stock has been taken yet. {can(staff, 'crossBranch') ? 'When the delivery is on the shelf, take the stock for this order.' : 'A manager will take the stock once it arrives.'}</p>
      {canChooseBranch ? <button type="button" className="btn primary small" onClick={() => setDialog('branch')}>{multiBranch ? 'Choose branch' : 'Take stock now'}</button> : null}
    </div> : null}

    <div className="detail-grid">
      <div className="stack gap-lg">
        <Card title={<>Ordered items <span className="snapshot-tag"><Icon name="lock" size={12} />Snapshot</span></>} flush>
          <table className="table">
            <thead><tr><th scope="col">Product</th><th scope="col" className="hide-sm">SKU</th><th scope="col" className="num">Unit</th><th scope="col" className="num">Qty</th><th scope="col" className="num">Line</th></tr></thead>
            <tbody>{order.items.map((item) => <tr key={item.variantId}>
              <td><b>{item.name}</b><span className="muted small block">{item.variantName}</span></td>
              <td className="mono small hide-sm">{item.sku}</td>
              <td className="num"><Money value={item.unitPrice} /></td>
              <td className="num">{item.quantity}</td>
              <td className="num"><Money value={item.lineTotal} /></td>
            </tr>)}</tbody>
            <tfoot>
              {order.discount ? <>
                <tr className="sub-row"><td className="hide-sm" /><td colSpan={3} className="num">Subtotal</td><td className="num"><Money value={order.subtotal} /></td></tr>
                <tr className="sub-row"><td className="hide-sm" /><td colSpan={3} className="num">Discount · {order.discount.reason}{order.discount.approvedBy ? ` · approved by ${order.discount.approvedBy.name}` : ''}</td><td className="num">−<Money value={order.discount.amount} /></td></tr>
              </> : null}
              <tr><td className="hide-sm" /><td colSpan={3} className="num">Total</td><td className="num strong"><Money value={order.total} /></td></tr>
            </tfoot>
          </table>
          <p className="card-foot muted small">Names and prices were captured when the order was placed. Catalog changes never alter this record.</p>
        </Card>

        {(order.returns || []).length ? <Card title="Returns">
          <ol className="corrections">
            {order.returns.map((entry) => <li key={entry.id}>
              <p><b>{entry.id}</b> <span className="muted">· {entry.by.name}{entry.approvedBy ? ` · approved by ${entry.approvedBy.name}` : ''} · {fmtFull(entry.at)}</span></p>
              <p className="small">{entry.lines.map((line) => `${line.quantity} × ${order.items.find((item) => item.variantId === line.variantId)?.name}`).join(', ')} · <Pill tone={entry.condition === 'resaleable' ? 'green' : 'red'}>{entry.condition === 'resaleable' ? 'Back on shelf' : 'Damaged'}</Pill></p>
              <p className="small">Refunded <b><Money value={entry.amount} /></b> by {entry.refundMethod === 'cash' ? 'cash' : `MoMo · ${entry.reference}`}</p>
              <p className="quote">{entry.reason}</p>
            </li>)}
          </ol>
        </Card> : null}

        {order.corrections.length ? <Card title="Corrections">
          <ol className="corrections">
            {order.corrections.map((correction, index) => <li key={index}>
              <p><b>{correction.by.name}</b> <span className="muted">· {ROLE_LABEL[correction.by.role]} · {fmtFull(correction.at)}</span></p>
              <p className="quote">{correction.reason}</p>
              <p className="small">Total <Money value={correction.before.total} /> → <Money value={correction.after.total} />
                {correction.balance ? <> · {correction.balance > 0 ? 'collect' : 'return'} <Money value={Math.abs(correction.balance)} /> at the counter</> : null}</p>
              <p className="small muted">Stock moved: {correction.stockDeltas.map((delta) => `${delta.delta > 0 ? '−' : '+'}${Math.abs(delta.delta)} ${state.catalog.flatMap((product) => product.variants).find((variant) => variant.id === delta.variantId)?.sku}`).join(', ')}</p>
            </li>)}
          </ol>
        </Card> : null}

        <Card title="Status history">
          <ol className="timeline">
            {order.statusHistory.map((entry, index) => <li key={index} className={entry.to === STATUS.CANCELLED ? 'bad' : ''}>
              <span className="dot" aria-hidden="true" />
              <div>
                <p><b>{entry.from ? `${entry.from} → ${entry.to}` : entry.to}</b></p>
                <p className="muted small">{entry.by.name}{entry.by.role !== 'system' ? ` · ${ROLE_LABEL[entry.by.role]}` : ''} · {fmtFull(entry.at)}</p>
                {entry.reason ? <p className="quote">{entry.reason}</p> : null}
              </div>
            </li>)}
          </ol>
          <p className="muted small">History is append-only. Entries cannot be edited or removed.</p>
        </Card>

        <Card title="Staff notes">
          {order.notes.length ? <ul className="notes">
            {order.notes.map((entry) => <li key={entry.id}><p>{entry.text}</p><span className="muted small">{entry.by.name} · {fmtWhen(entry.at, now)}</span></li>)}
          </ul> : <p className="muted small">No notes yet.</p>}
          <form className="note-form" onSubmit={addNote}>
            <label className="sr-only" htmlFor="note">Add a note</label>
            <input id="note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Add a note for the team" />
            <button type="submit" className="btn secondary" disabled={!note.trim()}>Add note</button>
          </form>
        </Card>
      </div>

      <div className="stack gap-lg">
        <Card title="Actions">
          <div className="stack">
            {forward.map((option) => <div key={option.to}>
              <button type="button" className="btn primary block" disabled={!option.allowed || Boolean(busy)} onClick={() => move(option)}>{busy === option.to ? 'Updating…' : option.label}</button>
              {!option.allowed ? <p className="why">{option.why}{option.why === 'Assign a rider first' && progress ? <> · <button type="button" className="link-button" onClick={() => setDialog('rider')}>Assign rider</button></> : null}</p> : null}
            </div>)}
            {order.status === STATUS.AWAITING_PAYMENT ? <p className="muted small">Only a verified payment can mark this order paid. Staff cannot set it by hand.</p> : null}
            {returnable ? <button type="button" className="btn secondary block" onClick={() => setDialog('return')}><Icon name="undo" size={16} />Return items{can(staff, 'returns') ? '' : ' (manager PIN)'}</button> : null}
            {correctable ? <button type="button" className="btn secondary block" onClick={() => setDialog('correct')}>Correct this sale{can(staff, 'correctPosSales') ? '' : ' (manager PIN)'}</button> : null}
            {cancel ? <div>
              <button type="button" className="btn danger-outline block" disabled={(!cancel.allowed && !needsApproval(cancel)) || Boolean(busy)} onClick={() => setPending(cancel)}>{cancel.label}{needsApproval(cancel) ? ' (manager PIN)' : ''}</button>
              {!cancel.allowed ? <p className="why">{cancel.why}{needsApproval(cancel) ? '. A manager can approve with their PIN.' : ''}</p> : null}
            </div> : null}
            {!options.length ? <p className="muted small">{order.status === STATUS.CANCELLED ? 'Cancelled is final. Make a new sale if needed.' : 'No further actions.'}</p> : null}
            <ServerNote contract="setOrderStatus">validates role, branch and current state; a cancellation restores the recorded batches once</ServerNote>
          </div>
        </Card>

        {order.fulfilment.method === 'delivery' ? <Card title="Delivery" actions={progress ? <button type="button" className="btn ghost small" onClick={() => setDialog('rider')}>{rider ? 'Change rider' : 'Assign rider'}</button> : null}>
          {rider ? <>
            <dl className="facts">
              <dt>Rider</dt><dd><b>{rider.name}</b>{rider.company ? <span className="muted"> · {rider.company}</span> : null}</dd>
              <dt>Phone</dt><dd><ContactLinks phone={rider.phone} /></dd>
              <dt>Vehicle</dt><dd>{rider.vehicle}{rider.plate ? <span className="mono"> · {rider.plate}</span> : null}</dd>
              <dt>Assigned</dt><dd className="small">{rider.assignedBy.name} · {fmtWhen(rider.assignedAt, now)}</dd>
            </dl>
          </> : <p className="muted small">No rider yet. A delivery can't go out without one.</p>}
        </Card> : null}

        <Card title="Payment">
          <dl className="facts">
            <dt>Method</dt><dd>{paymentLabel(order.payment)}{order.payment.network ? ` · ${order.payment.network}` : ''}</dd>
            <dt>State</dt><dd><PaymentPill payment={order.payment} /></dd>
            {order.payment.reference ? <><dt>{order.payment.mode === 'recorded' ? 'MoMo txn ID' : 'Reference'}</dt><dd className="mono small">{order.payment.reference}</dd></> : null}
            {received !== undefined ? <><dt>Received</dt><dd><Money value={received} /> · change <Money value={order.payment.change || 0} /></dd></> : null}
          </dl>
          {order.payment.mode === 'recorded' ? <p className="muted small">Recorded from the customer's transfer to the shop's MoMo number. Reconcile against the MoMo statement at close.</p> : null}
          {order.payment.state === 'refund_due' ? <div className="callout bad"><Icon name="alert" /><p><b>Refund due: {formatMoney(order.total)}.</b> Money goes back only through a controlled refund. This prototype does not move money.</p></div> : null}
          {order.payment.state === 'refunded' && order.payment.method === 'cash' ? <p className="muted small">Cash handed back at the counter, as recorded by staff.</p> : null}
        </Card>

        <Card title="Fulfilment">
          <dl className="facts">
            {multiBranch ? <><dt>Branch</dt><dd>{order.branchId ? branchName(order.branchId) : <Pill tone="red">None yet</Pill>}{canChooseBranch && order.branchId ? <button type="button" className="link-button" onClick={() => setDialog('branch')}>Move</button> : null}</dd></> : null}
            <dt>Method</dt><dd>{order.fulfilment.method === 'counter' ? 'Handed over at counter' : order.fulfilment.method === 'delivery' ? 'Delivery' : 'Customer pickup'}</dd>
            {order.fulfilment.method !== 'counter' ? <><dt>Prepared by</dt><dd>{progress
              ? <select className="inline-select" aria-label="Assign staff member" value={order.fulfilment.assigneeId || ''} onChange={(event) => run((store) => store.assignOrder(staff, { orderId: order.id, assigneeId: event.target.value }), 'Assignment updated.')}>
                <option value="" disabled>Unassigned</option>
                {branchStaff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
              : staffName(order.fulfilment.assigneeId)}</dd></> : null}
            <dt>Stock</dt><dd className="small">{order.stockDeductions
              ? order.restockedAt ? <>Taken, then returned {fmtWhen(order.restockedAt, now)}</> : <>Taken from {multiBranch ? branchName(order.branchId) : 'the shelf'} ({countUnits(order.stockDeductions)} units)</>
              : order.payment.state === 'paid' ? 'Not taken yet (waiting for stock)' : 'Not taken (unpaid)'}</dd>
          </dl>
          {order.stockDeductions?.length ? <ul className="lot-list">
            {order.stockDeductions.map((deduction, index) => {
              const batch = lots.get(deduction.batchId)
              return <li key={index}><span className="mono">{skuOf.get(deduction.variantId)}</span> × {deduction.quantity} <span className="muted">· lot {batch?.lot || '—'}{batch?.expiresOn ? ` · exp ${fmtExpiryMonth(batch.expiresOn)}` : ''}</span></li>
            })}
          </ul> : null}
          {order.stockDeductions?.length ? <p className="muted small">Lots are kept on every order so a product recall can find who received a batch.</p> : null}
        </Card>

        <Card title="Customer">
          {order.customer ? <>
            <dl className="facts">
              {order.customer.name ? <><dt>Name</dt><dd>{order.customer.name}</dd></> : null}
              {order.customer.phone ? <><dt>Phone</dt><dd><ContactLinks phone={order.customer.phone} /></dd></> : null}
              {order.customer.email ? <><dt>Email</dt><dd>{order.customer.email}</dd></> : null}
            </dl>
            {history && can(staff, 'viewCustomers') ? <a className="history-link" href={`#/customers/${history.key}`}>{history.orders} paid order{history.orders === 1 ? '' : 's'} · {formatMoney(history.spend)} lifetime →</a> : null}
          </> : <p className="muted small">Walk-in customer. No details taken.</p>}
          <p className="muted small">Sample customer · demo data</p>
        </Card>
      </div>
    </div>

    {pending ? <ReasonDialog
      title={`${pending.label} · ${order.id}`}
      destructive
      confirmLabel={pending.label}
      contract="setOrderStatus"
      presets={CANCEL_PRESETS}
      intro={<CancelImpact order={order} />}
      onConfirm={(reason) => move(pending, reason)}
      onClose={() => setPending(null)} /> : null}
    {dialog === 'correct' ? <CorrectionDialog order={order} onClose={() => setDialog(null)} /> : null}
    {dialog === 'branch' ? <BranchDialog order={order} onClose={() => setDialog(null)} /> : null}
    {dialog === 'rider' ? <RiderDialog order={order} onClose={() => setDialog(null)} /> : null}
    {dialog === 'return' ? <ReturnDialog order={order} onClose={() => setDialog(null)} /> : null}
  </div>
}

export function ContactLinks({ phone }) {
  const whatsapp = whatsappLink(phone)
  const call = callLink(phone)
  return <span className="contact-links">
    <span>{phone}</span>
    {call ? <a className="chip small-chip" href={call}>Call</a> : null}
    {whatsapp ? <a className="chip small-chip" href={whatsapp} target="_blank" rel="noreferrer">WhatsApp</a> : null}
  </span>
}

function CancelImpact({ order }) {
  const { branchName } = useOps()
  const willRestock = order.stockDeductions && !order.restockedAt
  return <ul className="impact">
    <li>{willRestock ? `${countUnits(order.stockDeductions)} recorded units go back to their batches at ${branchName(order.branchId)}, exactly once.` : 'No stock was taken, so nothing is returned.'}</li>
    <li>{order.payment.state === 'paid'
      ? order.payment.method === 'cash' ? `Hand ${formatMoney(order.total)} back in cash. It is recorded as refunded.` : `${formatMoney(order.total)} is flagged as a refund due.`
      : 'No money was collected.'}</li>
    <li>Cancelled is final. It cannot be reopened.</li>
  </ul>
}

function CorrectionDialog({ order, onClose }) {
  const { staff, run } = useOps()
  const [quantities, setQuantities] = useState(() => Object.fromEntries(order.items.map((item) => [item.variantId, item.quantity])))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const newItems = order.items.map((item) => ({ ...item, quantity: quantities[item.variantId], lineTotal: item.unitPrice * quantities[item.variantId] })).filter((item) => item.quantity > 0)
  const newSubtotal = sumPesewas(newItems, (item) => item.lineTotal)
  const total = newSubtotal - (order.discount ? (order.discount.type === 'percent' ? Math.round((newSubtotal * order.discount.value) / 100) : Math.min(order.discount.amount, newSubtotal)) : 0)
  const deltas = stockDeltas(order.items, newItems)
  const liveMomo = order.payment.method === 'momo' && order.payment.mode === 'live'
  const locked = liveMomo && total !== order.total
  const valid = deltas.length > 0 && newItems.length > 0 && reason.trim().length >= 5 && !locked

  const submit = async (event) => {
    event.preventDefault()
    if (!valid) return
    setBusy(true)
    const result = await run((store, approval) => store.correctPosSale(staff, { orderId: order.id, lines: newItems.map(({ variantId, quantity }) => ({ variantId, quantity })), reason, approval }), 'Sale corrected. Only the difference moved in stock.')
    setBusy(false)
    if (result) onClose()
  }

  return <Dialog title={`Correct ${order.id}`} onClose={onClose} wide>
    <form className="stack" onSubmit={submit}>
      <p className="muted small">Change quantities to match what actually left the counter. Set a line to 0 to remove it. Only the difference moves in stock, and returned units go back to the batches they came from.</p>
      <table className="table">
        <thead><tr><th scope="col">Product</th><th scope="col" className="num">Sold</th><th scope="col" className="num">Should be</th><th scope="col" className="num">Stock effect</th></tr></thead>
        <tbody>{order.items.map((item) => {
          const delta = (quantities[item.variantId] || 0) - item.quantity
          return <tr key={item.variantId}>
            <td><b>{item.name}</b><span className="muted small block">{item.variantName} · {formatMoney(item.unitPrice)}</span></td>
            <td className="num">{item.quantity}</td>
            <td className="num"><input className="qty-input" type="number" min={0} max={99} value={quantities[item.variantId]} aria-label={`Corrected quantity for ${item.name}`}
              onChange={(event) => setQuantities({ ...quantities, [item.variantId]: Math.max(0, Math.min(99, Number.parseInt(event.target.value || '0', 10) || 0)) })} /></td>
            <td className="num">{delta === 0 ? <span className="muted">—</span> : delta > 0 ? <span className="bad-text">−{delta} from shelf</span> : <span className="good-text">+{-delta} back</span>}</td>
          </tr>
        })}</tbody>
      </table>
      <div className="correction-summary">
        <span>Total <Money value={order.total} /> → <b><Money value={total} /></b></span>
        {total !== order.total && !liveMomo ? <span>{total > order.total ? 'Collect' : 'Return'} <b><Money value={Math.abs(total - order.total)} /></b> {order.payment.method === 'cash' ? 'in cash' : 'by MoMo'}</span> : null}
      </div>
      {locked ? <div className="callout bad"><Icon name="lock" /><p><b>This sale was charged by a live MoMo prompt.</b> Its total cannot be changed here. You can swap items at the same total, or void and refund.</p></div> : null}
      <label className="field"><span>Reason <em>required · recorded with before and after</em></span><textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} /></label>
      <ServerNote contract="correctPosSale">role and day limits, stock re-checked, before/after and stock difference recorded</ServerNote>
      <div className="row end">
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!valid || busy}>{busy ? 'Saving…' : 'Save correction'}</button>
      </div>
    </form>
  </Dialog>
}

function BranchDialog({ order, onClose }) {
  const { state, staff, run } = useOps()
  const now = useNow(60000)
  const [branchId, setBranchId] = useState(order.branchId || '')
  const [reason, setReason] = useState('')
  const coverage = state.branches.map((branch) => {
    const short = order.items.filter((item) => (onHand(state, item.variantId, branch.id, now) ?? 0) < item.quantity)
    return { branch, short }
  })
  const valid = branchId && branchId !== order.branchId && reason.trim().length >= 5
  const submit = async (event) => {
    event.preventDefault()
    if (!valid) return
    const result = await run((store) => store.assignOrderBranch(staff, { orderId: order.id, branchId, reason }), (updated) => `${order.id} now fulfilled by ${state.branches.find((branch) => branch.id === updated.branchId).short}.`)
    if (result) onClose()
  }
  const { multiBranch } = useOps()
  return <Dialog title={multiBranch ? `Fulfilling branch for ${order.id}` : `Take stock for ${order.id}`} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <div className="branch-options" role="radiogroup" aria-label="Branch">
        {coverage.map(({ branch, short }) => <label key={branch.id} className={`branch-option ${branchId === branch.id ? 'on' : ''}`}>
          <input type="radio" name="branch" value={branch.id} checked={branchId === branch.id} onChange={() => setBranchId(branch.id)} />
          <span><b>{branch.name}</b><span className={`small block ${short.length ? 'bad-text' : 'good-text'}`}>{short.length ? `Short of ${short.map((item) => item.sku).join(', ')}` : 'Has every item'}</span></span>
        </label>)}
      </div>
      {order.payment.state === 'paid' ? <p className="muted small">The order is paid, so its stock is taken from the chosen branch in the same step. A branch that is short will be refused.</p> : null}
      <label className="field"><span>Reason <em>required</em></span><textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <ServerNote contract="assignOrderBranch">allowed only before stock is taken; takes the stock from the chosen branch in one transaction</ServerNote>
      <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={!valid}>{multiBranch ? 'Assign branch' : 'Take stock'}</button></div>
    </form>
  </Dialog>
}

function RiderDialog({ order, onClose }) {
  const { staff, run } = useOps()
  const current = order.fulfilment.rider
  const [rider, setRider] = useState({ name: current?.name || '', phone: current?.phone || '', vehicle: current?.vehicle || 'Motorbike', plate: current?.plate || '', company: current?.company || '' })
  const valid = rider.name.trim().length >= 2 && normalizePhone(rider.phone)
  const set = (field) => (event) => setRider({ ...rider, [field]: event.target.value })
  const submit = async (event) => {
    event.preventDefault()
    if (!valid) return
    const result = await run((store) => store.assignRider(staff, { orderId: order.id, rider }), `Rider assigned to ${order.id}.`)
    if (result) onClose()
  }
  return <Dialog title={`Rider for ${order.id}`} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <div className="field-row">
        <label className="field"><span>Rider name</span><input data-autofocus value={rider.name} onChange={set('name')} /></label>
        <label className="field"><span>Phone</span><input inputMode="tel" value={rider.phone} onChange={set('phone')} placeholder="024 000 0000" /></label>
      </div>
      <div className="field-row">
        <label className="field"><span>Vehicle</span><select value={rider.vehicle} onChange={set('vehicle')}>{RIDER_VEHICLES.map((vehicle) => <option key={vehicle}>{vehicle}</option>)}</select></label>
        <label className="field"><span>Number plate <em>optional</em></span><input value={rider.plate} onChange={set('plate')} /></label>
      </div>
      <label className="field"><span>Dispatch company <em>optional</em></span><input value={rider.company} onChange={set('company')} /></label>
      <ServerNote contract="assignRider">stored on the order and audited</ServerNote>
      <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={!valid}>Save rider</button></div>
    </form>
  </Dialog>
}

function ReturnDialog({ order, onClose }) {
  const { staff, run } = useOps()
  const remaining = Object.fromEntries(order.items.map((item) => [item.variantId, item.quantity - returnedQuantity(order, item.variantId)]))
  const [quantities, setQuantities] = useState(() => Object.fromEntries(order.items.map((item) => [item.variantId, 0])))
  const [condition, setCondition] = useState('resaleable')
  const [refundMethod, setRefundMethod] = useState(order.payment.method === 'cash' ? 'cash' : 'momo')
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const lines = order.items.filter((item) => quantities[item.variantId] > 0).map((item) => ({ variantId: item.variantId, quantity: quantities[item.variantId] }))
  const amount = lines.reduce((sum, line) => sum + returnValue(order, line.variantId, line.quantity), 0)
  const valid = lines.length && reason.trim().length >= 5 && (refundMethod === 'cash' || /^[A-Za-z0-9.-]{6,30}$/.test(reference.trim()))

  const submit = async (event) => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    const result = await run((store, approval) => store.returnItems(staff, { orderId: order.id, lines, condition, refundMethod, reference, reason, approval }),
      (outcome) => `Return ${outcome.entry.id}: give back ${formatMoney(outcome.entry.amount)}${refundMethod === 'cash' ? ' in cash' : ' by MoMo'}.`)
    setBusy(false)
    if (result) onClose()
  }

  return <Dialog title={`Return items · ${order.id}`} onClose={onClose} wide>
    <form className="stack" onSubmit={submit}>
      <table className="table">
        <thead><tr><th scope="col">Product</th><th scope="col" className="num">Sold</th><th scope="col" className="num">Can return</th><th scope="col" className="num">Returning</th><th scope="col" className="num">Refund</th></tr></thead>
        <tbody>{order.items.map((item) => <tr key={item.variantId}>
          <td><b>{item.name}</b><span className="muted small block">{item.variantName}</span></td>
          <td className="num">{item.quantity}</td>
          <td className="num">{remaining[item.variantId]}</td>
          <td className="num"><input className="qty-input" type="number" min={0} max={remaining[item.variantId]} value={quantities[item.variantId]} disabled={!remaining[item.variantId]} aria-label={`Returning ${item.name}`}
            onChange={(event) => setQuantities({ ...quantities, [item.variantId]: Math.max(0, Math.min(remaining[item.variantId], Number.parseInt(event.target.value || '0', 10) || 0)) })} /></td>
          <td className="num"><Money value={returnValue(order, item.variantId, quantities[item.variantId])} /></td>
        </tr>)}</tbody>
      </table>
      {order.discount ? <p className="muted small">Refunds are after the {formatMoney(order.discount.amount)} discount on this sale, so the customer gets back what they actually paid for each item.</p> : null}
      <div className="field-row">
        <fieldset className="choice"><legend>Condition</legend>
          <Segmented label="Condition" value={condition} onChange={setCondition} options={[{ value: 'resaleable', label: 'Back on the shelf' }, { value: 'damaged', label: 'Damaged / opened' }]} />
        </fieldset>
        <fieldset className="choice"><legend>Money back by</legend>
          <Segmented label="Refund method" value={refundMethod} onChange={setRefundMethod} options={[{ value: 'cash', label: 'Cash' }, { value: 'momo', label: 'MoMo' }]} />
        </fieldset>
      </div>
      {refundMethod === 'momo' ? <label className="field"><span>Transaction ID of the MoMo you sent back</span><input value={reference} onChange={(event) => setReference(event.target.value)} autoComplete="off" /></label> : null}
      <div className="chip-row">{['Changed mind, unopened', 'Wrong product bought', 'Damaged on arrival', 'Allergic reaction'].map((preset) => <button type="button" key={preset} className="chip" onClick={() => setReason(preset)}>{preset}</button>)}</div>
      <label className="field"><span>Reason <em>required · audited</em></span><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} /></label>
      <div className="correction-summary"><span>Refund to customer</span><b><Money value={amount} /></b></div>
      <ServerNote contract="returnItems">staff need a manager's PIN; resaleable units go back to the batches they came from; damaged units stay off the shelf</ServerNote>
      <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={!valid || busy}>{busy ? 'Recording…' : `Record return · ${formatMoney(amount)}`}</button></div>
    </form>
  </Dialog>
}
