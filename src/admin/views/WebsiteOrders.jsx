import { useEffect, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { liveDb } from '../live/firebase.js'
import { formatGhs } from '../../cloud/site.js'
import { useOps } from '../hooks.js'
import { Card, Empty, Icon, Pill, ReasonDialog, Segmented } from '../components/ui.jsx'
import { Guide } from '../components/guide.jsx'

export const WEB_STATUS = {
  new: { label: 'New', tone: 'blue' },
  confirmed: { label: 'Confirmed', tone: 'violet' },
  ready: { label: 'Ready for pickup', tone: 'teal' },
  out_for_delivery: { label: 'On the way', tone: 'teal' },
  completed: { label: 'Completed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'grey' },
}
const OPEN = ['new', 'confirmed', 'ready', 'out_for_delivery']

// A Paystack order whose payment has not come through yet: the customer may still be paying, or gave up.
export const awaitingPayment = (order) => order.payment?.method === 'paystack' && order.payment?.status === 'pending'
// New orders staff need to act on (the badge in the menu).
export const needsAction = (order) => order.status === 'new' && !awaitingPayment(order)

function nextSteps(order) {
  switch (order.status) {
    case 'new': return awaitingPayment(order) ? [] : [{ action: 'confirm', label: 'I called them · Confirm' }]
    case 'confirmed': return order.fulfilment?.method === 'pickup' ? [{ action: 'ready', label: 'Packed · Ready for pickup' }] : [{ action: 'out_for_delivery', label: 'Sent out for delivery' }]
    case 'ready': case 'out_for_delivery': return [{ action: 'complete', label: 'Customer has it · Complete' }]
    default: return []
  }
}

function paymentText(payment) {
  if (payment?.status === 'paid') return { tone: 'green', text: 'Paid · verified with Paystack' }
  if (payment?.status === 'pending') return { tone: 'grey', text: 'Waiting for Paystack payment' }
  if (payment?.status === 'mismatch') return { tone: 'red', text: 'Paystack amount is wrong' }
  if (payment?.status === 'confirmed') return { tone: 'green', text: 'Paid · Paystack check recorded' }
  if (payment?.status === 'reported') return { tone: 'amber', text: 'Paid online · check Paystack' }
  if (payment?.status === 'paid_offline') return { tone: 'green', text: 'Paid (cash or MoMo)' }
  return { tone: 'grey', text: 'Not paid yet' }
}

const when = (timestamp) => {
  const date = timestamp?.toDate ? timestamp.toDate() : null
  return date ? date.toLocaleString('en-GB', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
}

function PaymentRecord({ order }) {
  const payment = order.payment || {}
  const online = payment.method === 'paystack'
  const checked = payment.checkedAt || payment.checkedBy
  return <div className="web-payment-record">
    <span className="eyebrow">Payment record</span>
    <p><b>{online ? 'Paystack online payment' : payment.method === 'pay_later' ? 'Payment on delivery / pickup' : 'Offline payment'}</b></p>
    {payment.reference ? <p className="small">Reference: <span className="mono">{payment.reference}</span></p> : null}
    <p className="small">Order total: <b>{formatGhs(order.total)}</b></p>
    {payment.status === 'paid' ? <p className="small good-text">Paystack confirmed {formatGhs(payment.amountPaid)}{payment.channel ? ` by ${payment.channel.replace(/_/g, ' ')}` : ''}. No manual check needed.</p> : null}
    {payment.status === 'mismatch' ? <p className="small bad-text">Paystack received {Number.isInteger(payment.amountPaid) ? formatGhs(payment.amountPaid) : 'a different amount'} {payment.currency}, not {formatGhs(order.total)}. Call the customer before sending anything; a manager can accept it after checking Paystack.</p> : null}
    {payment.status === 'pending' ? <p className="small muted">The customer has not finished paying. If they gave up, call them or cancel the order.</p> : null}
    {online && payment.status === 'reported' && !checked ? <p className="small warn-text">Awaiting a manual Paystack dashboard check before dispatch.</p> : null}
    {checked ? <p className="small good-text">Checked by {payment.checkedBy?.name || 'staff'}{payment.checkedAt ? ` · ${new Date(payment.checkedAt).toLocaleString('en-GB', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</p> : null}
  </div>
}

export function useWebOrders() {
  const [orders, setOrders] = useState(null)
  useEffect(() => onSnapshot(query(collection(liveDb, 'orders'), orderBy('createdAt', 'desc'), limit(300)), (snap) => setOrders(snap.docs.map((item) => ({ id: item.id, ...item.data() }))), () => setOrders([])), [])
  return orders
}

export default function WebsiteOrders() {
  const { call } = useOps()
  const orders = useWebOrders()
  const [filter, setFilter] = useState('open')
  const [busy, setBusy] = useState(null)
  const [cancelling, setCancelling] = useState(null)

  const act = async (order, action, extra = {}, message) => {
    setBusy(order.id)
    const result = await call('updateWebOrder', { orderId: order.id, action, ...extra }, { success: message })
    setBusy(null)
    return result
  }

  if (!orders) return <p className="muted">Loading website orders…</p>
  const open = orders.filter((order) => OPEN.includes(order.status))
  const shown = filter === 'open' ? open : orders

  return <div className="stack">
    <Guide id="web-orders" title="How to handle a website order" steps={[
      'Call the customer on the number shown to check the order and the delivery address. Paystack payments are checked with Paystack automatically.',
      'Press Confirm. This takes the items out of shop stock. If something is out of stock you will be told before anything changes.',
      'Pack the order. For pickup press Ready for pickup; for delivery press Sent out for delivery.',
      'When the customer has it, press Complete. Mark the payment once it is checked.',
    ]} />
    <Segmented label="Which orders" value={filter} onChange={setFilter} options={[{ value: 'open', label: 'To do', count: open.length }, { value: 'all', label: 'All', count: orders.length }]} />
    {shown.length ? shown.map((order) => {
      const pay = paymentText(order.payment)
      const status = WEB_STATUS[order.status] || WEB_STATUS.new
      const phone = String(order.customer?.phone || '')
      return <Card key={order.id} title={<span className="web-order-title"><span className="mono">{order.ref}</span> <Pill tone={status.tone}>{status.label}</Pill> <Pill tone={pay.tone}>{pay.text}</Pill></span>} actions={<span className="muted small">{when(order.createdAt)}</span>}>
        <div className="web-order">
          <div className="stack">
            <div>
              <b>{order.customer?.name}</b>
              <div className="contact-links">
                <a className="chip small-chip" href={`tel:${phone.replace(/\s/g, '')}`}><Icon name="user" size={14} /> Call {phone}</a>
                <a className="chip small-chip" href={`https://wa.me/233${phone.replace(/\D/g, '').slice(1)}`} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={14} /> WhatsApp</a>
              </div>
            </div>
            <p className="small">{order.fulfilment?.method === 'delivery' ? <><Icon name="delivery" size={14} /> <b>Delivery</b><br />{order.fulfilment.address}</> : <><b>Pickup</b><br />Customer collects from the shop.</>}</p>
            {order.fulfilment?.notes ? <p className="small muted">Customer note: {order.fulfilment.notes}</p> : null}
            {order.cancel ? <p className="small muted">Cancelled by {order.cancel.by?.name}: “{order.cancel.reason}”</p> : null}
            <PaymentRecord order={order} />
          </div>
          <table className="table web-order-lines"><tbody>
            {(order.lines || []).map((line) => <tr key={line.id}><td>{line.image ? <img className="web-order-line-image" src={line.image} alt="" referrerPolicy="no-referrer" /> : <span className="web-order-line-image placeholder" aria-hidden="true" />}</td><td>{line.qty} × <b>{line.name}</b><span className="muted small block">{[line.brand, line.size].filter(Boolean).join(' · ')} · {formatGhs(line.price)} each</span></td><td className="nowrap">{formatGhs(line.lineTotal)}</td></tr>) }
            <tr><td /><td>{order.fulfilment?.method === 'delivery' ? 'Delivery' : 'Pickup'}</td><td className="nowrap">{order.deliveryFee === null ? 'Agree on phone' : formatGhs(order.deliveryFee || 0)}</td></tr>
            <tr className="strong"><td /><td>Total</td><td className="nowrap">{formatGhs(order.total)}</td></tr>
          </tbody></table>
        </div>
        {order.payment?.status === 'reported' ? <p className="small warn-text">Before you send it, open Paystack and check that reference <span className="mono">{order.payment.reference}</span> was paid {formatGhs(order.total)}.</p> : null}
        <div className="button-grid">
          {nextSteps(order).map((step) => <button key={step.action} type="button" className="btn primary" disabled={busy === order.id} onClick={() => act(order, step.action, {}, `${order.ref}: done.`)}>{step.label}</button>)}
          {['reported', 'mismatch'].includes(order.payment?.status) ? <button type="button" className="btn secondary" disabled={busy === order.id} onClick={() => act(order, 'payment_checked', {}, `${order.ref}: payment checked.`)}><Icon name="check" size={16} /> I checked Paystack</button> : null}
          {OPEN.includes(order.status) && (!order.payment || ['unpaid', 'pending'].includes(order.payment.status)) ? <button type="button" className="btn secondary" disabled={busy === order.id} onClick={() => act(order, 'paid_offline', {}, `${order.ref}: marked as paid.`)}><Icon name="check" size={16} /> Customer paid (cash or MoMo)</button> : null}
          {OPEN.includes(order.status) ? <button type="button" className="btn ghost" disabled={busy === order.id} onClick={() => setCancelling(order)}>Cancel order</button> : null}
        </div>
      </Card>
    }) : <Empty title={filter === 'open' ? 'Nothing to do' : 'No website orders yet'}>{filter === 'open' ? 'New website orders appear here as soon as they are placed.' : 'When customers order on the website, the orders appear here.'}</Empty>}
    {cancelling ? <ReasonDialog title={`Cancel order ${cancelling.ref}?`} destructive confirmLabel="Cancel order"
      intro={<p className="small">{cancelling.stockTaken?.length ? 'The items go back into shop stock. ' : ''}If the customer already paid, refund them (in Paystack for online payments).</p>}
      presets={['Customer cancelled', 'Could not reach the customer', 'Out of stock']}
      onConfirm={async (reason) => Boolean(await act(cancelling, 'cancel', { reason }, `${cancelling.ref} cancelled.`))}
      onClose={() => setCancelling(null)} /> : null}
  </div>
}
