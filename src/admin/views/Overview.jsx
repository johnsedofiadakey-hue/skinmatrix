import { useOps, useNow } from '../hooks.js'
import { can } from '../lib/permissions.js'
import { orderAttention } from '../lib/attention.js'
import { ledgerTotals } from '../lib/ledger.js'
import { expiryStatus, heldUnits, onHand, stockStatus, stockValue } from '../lib/stock.js'
import { businessDayKey } from '../lib/time.js'
import { formatMoney, sumPesewas } from '../lib/money.js'
import { Card, ChannelTag, Empty, MethodSplit, Money, Pill, Stat, StatusPill } from '../components/ui.jsx'
import { EXPIRY_LABEL, EXPIRY_TONE, fmtCountdown, fmtDate, fmtExpiry, fmtWhen } from '../components/format.js'

export default function Overview() {
  const { state, staff, branchIds, branchName, inScope } = useOps()
  const now = useNow(5000)
  const today = businessDayKey(now)

  const orders = state.orders.filter((order) => inScope(order.branchId))
  const todays = orders.filter((order) => businessDayKey(order.createdAt) === today)
  const totals = ledgerTotals(todays)
  const attention = orders
    .map((order) => ({ order, flag: orderAttention(order, now) }))
    .filter((entry) => entry.flag)
    .sort((a, b) => (a.flag.level === b.flag.level ? a.order.createdAt - b.order.createdAt : a.flag.level === 'high' ? -1 : 1))

  const lowStock = []
  for (const product of state.catalog) {
    for (const variant of product.variants) {
      for (const branchId of branchIds) {
        const quantity = onHand(state, variant.id, branchId, now)
        const status = stockStatus(quantity, product.reorderPoint)
        if (status === 'low' || status === 'out') lowStock.push({ product, variant, branchId, quantity, status })
      }
    }
  }
  lowStock.sort((a, b) => a.quantity - b.quantity)

  const holds = state.holds.filter((hold) => hold.status === 'reserved' && inScope(hold.branchId))
  const exceptions = state.exceptions.filter((exception) => exception.status === 'open' && inScope(exception.branchId))
  const value = stockValue(state, branchIds, now)
  const variantInfo = new Map(state.catalog.flatMap((product) => product.variants.map((variant) => [variant.id, { product, variant }])))
  const expiring = state.batches
    .filter((batch) => branchIds.includes(batch.branchId) && batch.quantity > 0 && batch.expiresOn && ['expired', 'urgent', 'soon'].includes(expiryStatus(batch.expiresOn, now)))
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
  const activity = state.audit.filter((entry) => !entry.branchId || inScope(entry.branchId)).slice(0, 7)
  const staleSeed = businessDayKey(state.seededAt) !== today

  return <div className="stack gap-lg">
    {staleSeed ? <div className="callout info"><p>Demo data was generated on {fmtDate(state.seededAt)}, so today's figures only include what you have done since. Use <b>Reset demo data</b> in the banner for a fresh sample day.</p></div> : null}

    <div className="stat-grid">
      <Stat label="Sales today" value={<Money value={totals.net} />} sub={`${totals.count} paid order${totals.count === 1 ? '' : 's'}${totals.returns ? ` · ${formatMoney(totals.returns)} returned` : ''} · counter ${formatShare(totals.byChannel.pos, totals.gross)}`} href={can(staff, 'viewLedger') ? '#/ledger' : undefined} />
      <Stat label="By payment method" value={<MethodSplit rows={[['Cash', totals.byMethod.cash], ['MoMo', totals.byMethod.momo], ['Card', totals.byMethod.card]]} />} sub="Collected today by method" />
      <Stat label="Orders needing attention" value={attention.length} tone={attention.length ? 'warn' : ''} sub={`${attention.filter((entry) => entry.flag.level === 'high').length} urgent`} href={can(staff, 'viewOrders') ? '#/orders' : undefined} />
      <Stat label="Low or out of stock" value={lowStock.length} tone={lowStock.some((line) => line.status === 'out') ? 'bad' : lowStock.length ? 'warn' : ''} sub={`${lowStock.filter((line) => line.status === 'out').length} out of stock`} href="#/inventory" />
      <Stat label="Expiry" value={value.total.expiredUnits ? `${value.total.expiredUnits} expired` : `${value.total.soonUnits} soon`} tone={value.total.expiredUnits ? 'bad' : value.total.soonUnits ? 'warn' : ''} sub={`${value.total.soonUnits} units expire within 90 days`} href="#/inventory/expiry" />
      <Stat label="Payment exceptions" value={exceptions.length} tone={exceptions.length ? 'bad' : ''} sub={totals.refundsDue ? `${totals.refundsDue} refund due today` : 'Needs a person to resolve'} href={can(staff, 'viewPayments') ? '#/payments' : undefined} />
    </div>

    <div className="grid-2">
      {can(staff, 'viewOrders') ? <Card title="Needs attention" actions={<a className="link" href="#/orders">All orders →</a>} flush>
        {attention.length ? <ul className="list">
          {attention.slice(0, 7).map(({ order, flag }) => <li key={order.id}>
            <a className="list-row" href={`#/orders/${order.id}`}>
              <span className="list-main"><span className="id-line"><b className="mono">{order.id}</b><ChannelTag channel={order.channel} /></span><span className="muted small">{order.customer?.name || 'Walk-in'}{order.needsBranch ? ' · waiting for stock' : ''}</span></span>
              <span className="list-side"><Pill tone={flag.level === 'high' ? 'red' : 'amber'}>{flag.text}</Pill><StatusPill status={order.status} /></span>
            </a>
          </li>)}
        </ul> : <Empty title="Nothing waiting">Every open order is moving.</Empty>}
      </Card> : null}

      <Card title="Low stock" actions={<a className="link" href="#/inventory">Inventory →</a>} flush>
        {lowStock.length ? <ul className="list">
          {lowStock.slice(0, 7).map((line) => <li key={`${line.variant.id}-${line.branchId}`} className="list-row static">
            <span className="list-main"><b>{line.product.name}</b><span className="muted small">{line.variant.name} · {line.variant.sku}</span></span>
            <span className="list-side"><Pill tone={line.status === 'out' ? 'red' : 'amber'}>{line.status === 'out' ? 'Out' : `${line.quantity} left`}</Pill>{heldUnits(state.holds, line.variant.id, line.branchId) ? <span className="muted small">+{heldUnits(state.holds, line.variant.id, line.branchId)} held</span> : null}</span>
          </li>)}
        </ul> : <Empty title="Shelves are healthy" />}
      </Card>

      <Card title="Expiring stock" actions={<a className="link" href="#/inventory/expiry">Expiry →</a>} flush>
        {expiring.length ? <ul className="list">
          {expiring.slice(0, 6).map((batch) => {
            const status = expiryStatus(batch.expiresOn, now)
            return <li key={batch.id} className="list-row static">
              <span className="list-main"><b>{variantInfo.get(batch.variantId)?.product.name}</b><span className="muted small">Lot {batch.lot} · {fmtExpiry(batch.expiresOn)}</span></span>
              <span className="list-side"><span className="small strong">{batch.quantity} units</span><Pill tone={EXPIRY_TONE[status]}>{EXPIRY_LABEL[status]}</Pill></span>
            </li>
          })}
        </ul> : <Empty title="Nothing expiring within 90 days" />}
      </Card>

      <Card title={`Live MoMo prompts${holds.length ? ` · ${formatMoney(sumPesewas(holds, (hold) => hold.amount))}` : ''}`} flush>
        {holds.length ? <ul className="list">
          {holds.map((hold) => <li key={hold.reference} className="list-row static">
            <span className="list-main"><b className="mono">{hold.reference}</b><span className="muted small">{hold.createdBy.name} · {hold.items.length} line{hold.items.length === 1 ? '' : 's'}</span></span>
            <span className="list-side"><Money value={hold.amount} /><Pill tone="amber">Expires in {fmtCountdown(hold.expiresAt - now)}</Pill></span>
          </li>)}
        </ul> : <Empty title="No stock is on hold">Holds appear while a customer approves a MoMo payment.</Empty>}
      </Card>

      <Card title="Recent activity" actions={can(staff, 'viewAudit') ? <a className="link" href="#/audit">Audit log →</a> : null} flush>
        <ul className="list">
          {activity.map((entry) => <li key={entry.id} className="list-row static">
            <span className="list-main"><span>{entry.summary}</span><span className="muted small">{entry.actor.name} · {fmtWhen(entry.at, now)}</span></span>
          </li>)}
        </ul>
      </Card>
    </div>
  </div>
}

function formatShare(part, whole) {
  return whole ? `${Math.round((part / whole) * 100)}%` : '—'
}
