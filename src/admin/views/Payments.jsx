import { useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { can } from '../lib/permissions.js'
import { Card, Empty, Money, Pill, ReasonDialog, ServerNote } from '../components/ui.jsx'
import { fmtCountdown, fmtTime, fmtWhen } from '../components/format.js'
import { businessDayKey } from '../lib/time.js'
import { formatMoney } from '../lib/money.js'

const EXCEPTION_LABEL = { hold_released: 'Paid after hold released', amount_mismatch: 'Amount mismatch', no_hold: 'No matching hold' }
const HOLD_OUTCOME = { consumed: { label: 'Sale recorded', tone: 'green' }, released: { label: 'Released', tone: 'grey' }, reserved: { label: 'Holding stock', tone: 'amber' } }

export default function Payments() {
  const { state, staff, run, inScope: scope, branchName, multiBranch } = useOps()
  const now = useNow(1000)
  const [resolving, setResolving] = useState(null)
  const inScope = (branchId) => scope(branchId)

  const holds = state.holds.filter((hold) => inScope(hold.branchId))
  const live = holds.filter((hold) => hold.status === 'reserved')
  const recent = holds.filter((hold) => hold.status !== 'reserved').slice(0, 12)
  const exceptions = state.exceptions.filter((exception) => inScope(exception.branchId))
  const refundsDue = state.orders.filter((order) => inScope(order.branchId) && order.payment.state === 'refund_due')
  const today = businessDayKey(now)
  const recorded = state.orders.filter((order) => inScope(order.branchId) && order.payment.mode === 'recorded' && businessDayKey(order.createdAt) === today)

  return <div className="stack gap-lg">
    <Card title="Payment exceptions" actions={<Pill tone={exceptions.some((exception) => exception.status === 'open') ? 'red' : 'green'}>{exceptions.filter((exception) => exception.status === 'open').length} open</Pill>} flush>
      {exceptions.length ? <ul className="list">
        {exceptions.map((exception) => <li key={`${exception.reference}-${exception.kind}`} className="list-row static exception-row">
          <span className="list-main">
            <span><b className="mono">{exception.reference}</b> <Pill tone={exception.status === 'open' ? 'red' : 'grey'}>{exception.status === 'open' ? EXCEPTION_LABEL[exception.kind] : 'Resolved'}</Pill></span>
            <span className="small">{exception.message}</span>
            <span className="muted small">{fmtWhen(exception.at, now)}</span>
            {exception.resolution ? <span className="small">Resolved by <b>{exception.resolution.by.name}</b>: “{exception.resolution.note}”</span> : null}
          </span>
          <span className="list-side">
            <Money value={exception.amount} />
            {exception.status === 'open' && can(staff, 'resolveExceptions') ? <button type="button" className="btn secondary small" onClick={() => setResolving(exception)}>Record resolution</button> : null}
          </span>
        </li>)}
      </ul> : <Empty title="No payment exceptions">Payments that do not match a live stock hold appear here. They never become sales on their own.</Empty>}
      {exceptions.some((exception) => exception.status === 'open') && !can(staff, 'resolveExceptions') ? <p className="card-foot muted small">An operations manager resolves exceptions.</p> : null}
    </Card>

    <div className="grid-2">
      <Card title="Live MoMo prompts (stock on hold)" flush>
        {live.length ? <ul className="list">
          {live.map((hold) => <li key={hold.reference} className="list-row static">
            <span className="list-main"><b className="mono">{hold.reference}</b><span className="muted small">{hold.createdBy.name} · {hold.payer.network} {hold.payer.phone}</span></span>
            <span className="list-side"><Money value={hold.amount} /><Pill tone="amber">{fmtCountdown(hold.expiresAt - now)}</Pill>
              {can(staff, 'pos') ? <button type="button" className="btn ghost small" onClick={() => run((store) => store.releaseMomoHold(staff, { reference: hold.reference, reason: 'cancelled' }), 'Hold released. Stock returned.')}>Release</button> : null}
            </span>
          </li>)}
        </ul> : <Empty title="Nothing on hold" />}
      </Card>

      <Card title="Refunds due" flush>
        {refundsDue.length ? <ul className="list">
          {refundsDue.map((order) => <li key={order.id}><a className="list-row" href={`#/orders/${order.id}`}>
            <span className="list-main"><b className="mono">{order.id}</b><span className="muted small">{order.customer?.name || 'Walk-in'}</span></span>
            <span className="list-side"><Money value={order.total} /><Pill tone="red">Refund due</Pill></span>
          </a></li>)}
        </ul> : <Empty title="No refunds waiting" />}
        <p className="card-foot muted small">Refunds are paid through the provider's controlled refund flow. Not built in this prototype.</p>
      </Card>
    </div>

    <Card title="MoMo paid to shop numbers · today" actions={<span className="small muted">{recorded.length} payment{recorded.length === 1 ? '' : 's'} · {formatMoney(recorded.filter((order) => order.status !== 'Cancelled').reduce((sum, order) => sum + order.payment.amountReceived, 0))}</span>} flush>
      {recorded.length ? <table className="table">
        <thead><tr><th scope="col">Time</th><th scope="col">Sale</th>{multiBranch ? <th scope="col" className="hide-md">Branch</th> : null}<th scope="col">Network</th><th scope="col">Transaction ID</th><th scope="col" className="num">Received</th><th scope="col">Status</th></tr></thead>
        <tbody>{recorded.map((order) => <tr key={order.id}>
          <td className="nowrap">{fmtTime(order.createdAt)}</td>
          <td><a className="mono link" href={`#/orders/${order.id}`}>{order.id}</a><span className="muted small block">{order.createdBy.name}</span></td>
          {multiBranch ? <td className="hide-md nowrap">{branchName(order.branchId)}</td> : null}
          <td>{order.payment.network}</td>
          <td className="mono">{order.payment.reference}</td>
          <td className="num"><Money value={order.payment.amountReceived} /></td>
          <td>{order.status === 'Cancelled' ? <Pill tone="grey">Voided</Pill> : <Pill tone="green">Sale</Pill>}</td>
        </tr>)}</tbody>
      </table> : <Empty title="No MoMo recorded today" />}
      <p className="card-foot muted small">Tick these off against each branch's MoMo statement at close. A transaction ID can only be recorded once.</p>
    </Card>

    <Card title="Recent prompts" flush>
      {recent.length ? <table className="table">
        <thead><tr><th scope="col">Reference</th><th scope="col">Started</th><th scope="col" className="hide-md">By</th><th scope="col" className="num">Amount</th><th scope="col">Outcome</th><th scope="col">Sale</th></tr></thead>
        <tbody>{recent.map((hold) => <tr key={hold.reference}>
          <td className="mono">{hold.reference}</td>
          <td className="nowrap">{fmtWhen(hold.createdAt, now)}</td>
          <td className="hide-md">{hold.createdBy.name}</td>
          <td className="num"><Money value={hold.amount} /></td>
          <td><Pill tone={HOLD_OUTCOME[hold.status].tone}>{hold.status === 'released' ? `Released · ${hold.releaseReason}` : HOLD_OUTCOME[hold.status].label}</Pill></td>
          <td>{hold.orderId ? <a className="mono link" href={`#/orders/${hold.orderId}`}>{hold.orderId}</a> : <span className="muted">None</span>}</td>
        </tr>)}</tbody>
      </table> : <Empty title="No closed holds yet" />}
    </Card>

    <ServerNote contract="payment webhook + expiry sweep">a verified payment consumes its hold exactly once; late, unmatched or wrong-amount payments become exceptions and never move stock</ServerNote>

    {resolving ? <ReasonDialog
      title={`Resolve ${resolving.reference}`}
      intro={<p className="small">Record what was done, for example “refunded payer through the provider dashboard” or “customer collected goods; sale entered as a new order”. <b>Recording this does not create a sale or move stock.</b></p>}
      confirmLabel="Record resolution"
      contract="resolvePaymentException"
      presets={['Refunded payer via provider', 'Customer collected goods; new sale entered', 'Duplicate notification, no money received']}
      onConfirm={async (note) => Boolean(await run((store) => store.resolveException(staff, { reference: resolving.reference, kind: resolving.kind, note }), 'Resolution recorded.'))}
      onClose={() => setResolving(null)} /> : null}
  </div>
}
