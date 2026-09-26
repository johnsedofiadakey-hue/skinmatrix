import { useCallback, useEffect, useState } from 'react'
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore/lite'
import { db } from '../../cloud/firebase.js'
import { formatGhs } from '../../cloud/site.js'
import { EditorGate } from '../cloud.jsx'
import { Card, Empty, Icon, Pill, Segmented } from '../components/ui.jsx'
import { useOps } from '../hooks.js'

export const WEB_STATUS = {
  new: { label: 'New', tone: 'blue' },
  confirmed: { label: 'Confirmed', tone: 'violet' },
  ready: { label: 'Ready for pickup', tone: 'teal' },
  out_for_delivery: { label: 'On the way', tone: 'teal' },
  completed: { label: 'Completed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'grey' },
}
const OPEN = ['new', 'confirmed', 'ready', 'out_for_delivery']

// What the next sensible step is, in plain words.
function nextSteps(order) {
  switch (order.status) {
    case 'new': return [{ to: 'confirmed', label: 'I called them · Confirm order' }, { to: 'cancelled', label: 'Cancel order' }]
    case 'confirmed': return order.fulfilment.method === 'pickup'
      ? [{ to: 'ready', label: 'Ready for pickup' }, { to: 'cancelled', label: 'Cancel order' }]
      : [{ to: 'out_for_delivery', label: 'Sent out for delivery' }, { to: 'cancelled', label: 'Cancel order' }]
    case 'ready': case 'out_for_delivery': return [{ to: 'completed', label: 'Customer has it · Complete' }]
    default: return []
  }
}

function paymentText(payment) {
  if (payment?.status === 'confirmed') return { tone: 'green', text: 'Paid · checked in Paystack' }
  if (payment?.status === 'reported') return { tone: 'amber', text: 'Paid online · check in Paystack' }
  if (payment?.status === 'paid_offline') return { tone: 'green', text: 'Paid (cash or MoMo)' }
  return { tone: 'grey', text: 'Not paid yet' }
}

const when = (timestamp) => (timestamp?.toDate ? timestamp.toDate().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

export default function WebsiteOrders() {
  return <div className="stack">
    <p className="muted">Orders customers placed on the website. Call each new customer to confirm, then move the order along.</p>
    <EditorGate purpose="Website orders hold customers' names and phone numbers, so you need to sign in.">{(user) => <OrderList user={user} />}</EditorGate>
  </div>
}

function OrderList({ user }) {
  const { toast } = useOps()
  const [orders, setOrders] = useState(null)
  const [filter, setFilter] = useState('open')
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    try {
      const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(200)))
      setOrders(snap.docs.map((item) => ({ id: item.id, ...item.data() })))
    } catch {
      toast('Could not load website orders. Check your internet and try again.', 'error')
      setOrders([])
    }
  }, [toast])
  useEffect(() => { load() }, [load])

  const change = async (order, patch, message) => {
    setBusy(order.id)
    try {
      await updateDoc(doc(db, 'orders', order.id), { ...patch, updatedAt: serverTimestamp(), updatedBy: user.uid })
      setOrders((list) => list.map((item) => (item.id === order.id ? { ...item, ...patch } : item)))
      toast(message)
    } catch {
      toast('Could not update the order. Try again.', 'error')
    }
    setBusy(null)
  }

  if (!orders) return <p className="muted">Loading orders…</p>
  const open = orders.filter((order) => OPEN.includes(order.status))
  const shown = filter === 'open' ? open : orders

  return <>
    <div className="website-toolbar">
      <Segmented label="Which orders" value={filter} onChange={setFilter} options={[{ value: 'open', label: 'To do', count: open.length }, { value: 'all', label: 'All', count: orders.length }]} />
      <button type="button" className="btn ghost" onClick={load}><Icon name="reset" size={16} /> Refresh</button>
    </div>
    {shown.length ? shown.map((order) => {
      const pay = paymentText(order.payment)
      const status = WEB_STATUS[order.status] || WEB_STATUS.new
      return <Card key={order.id} title={<span className="web-order-title"><span className="mono">{order.ref}</span> <Pill tone={status.tone}>{status.label}</Pill> <Pill tone={pay.tone}>{pay.text}</Pill></span>} actions={<span className="muted small">{when(order.createdAt)}</span>}>
        <div className="web-order">
          <div className="stack">
            <div>
              <b>{order.customer?.name}</b>
              <div className="contact-links">
                <a href={`tel:${String(order.customer?.phone || '').replace(/\s/g, '')}`}><Icon name="customers" size={14} /> {order.customer?.phone}</a>
                {order.customer?.email ? <a href={`mailto:${order.customer.email}`}>{order.customer.email}</a> : null}
              </div>
            </div>
            <p className="small">{order.fulfilment?.method === 'delivery' ? <><Icon name="delivery" size={14} /> Deliver to: {order.fulfilment.address}</> : 'Pickup at the shop'}</p>
            {order.fulfilment?.notes ? <p className="small muted">Customer note: {order.fulfilment.notes}</p> : null}
          </div>
          <div>
            <table className="table web-order-lines"><tbody>
              {(order.lines || []).map((line) => <tr key={line.id}><td>{line.qty} ×</td><td>{line.name}<span className="muted small block">{line.brand}{line.size ? ` · ${line.size}` : ''} · {formatGhs(line.price)} each</span></td><td className="nowrap">{formatGhs(line.lineTotal)}</td></tr>)}
              <tr><td /><td>{order.fulfilment?.method === 'delivery' ? 'Delivery' : 'Pickup'}</td><td className="nowrap">{order.deliveryFee === null ? 'Agree on phone' : formatGhs(order.deliveryFee || 0)}</td></tr>
              <tr className="strong"><td /><td>Total</td><td className="nowrap">{formatGhs(order.total)}</td></tr>
            </tbody></table>
            {order.payment?.status === 'reported' ? <p className="small warn-text">Before you send this order, open Paystack and check that reference <span className="mono">{order.payment.reference}</span> was paid {formatGhs(order.total)}.</p> : null}
          </div>
        </div>
        <div className="row web-order-actions">
          {nextSteps(order).map((step) => <button key={step.to} type="button" className={`btn ${step.to === 'cancelled' ? 'ghost' : 'primary'}`} disabled={busy === order.id}
            onClick={() => { if (step.to !== 'cancelled' || window.confirm(`Cancel order ${order.ref}? If they paid, refund them in Paystack.`)) change(order, { status: step.to }, `${order.ref}: ${WEB_STATUS[step.to].label}.`) }}>{step.label}</button>)}
          {order.payment?.status === 'reported' ? <button type="button" className="btn" disabled={busy === order.id} onClick={() => change(order, { payment: { ...order.payment, status: 'confirmed' } }, `${order.ref}: payment checked.`)}><Icon name="check" size={16} /> I checked the payment in Paystack</button> : null}
          {!order.payment || order.payment.status === 'unpaid' ? <button type="button" className="btn" disabled={busy === order.id} onClick={() => change(order, { payment: { ...(order.payment || {}), status: 'paid_offline' } }, `${order.ref}: marked as paid.`)}><Icon name="check" size={16} /> Customer paid (cash or MoMo)</button> : null}
        </div>
      </Card>
    }) : <Empty title={filter === 'open' ? 'Nothing to do' : 'No website orders yet'}>{filter === 'open' ? 'New website orders appear here.' : 'When customers order on the website, the orders appear here.'}</Empty>}
  </>
}
