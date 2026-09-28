import { useNow, useOps } from '../hooks.js'
import { formatMoney } from '../lib/money.js'
import { businessDay } from '../../../functions/src/core/time.js'
import { expiryStatus, sellable, sellableFromSummary, stockLevel } from '../../../functions/src/core/stock.js'
import { Card, Icon, Money, Stat } from '../components/ui.jsx'
import { fmtTime } from '../components/format.js'
import { dayTotals, useSalesForDay } from './Sales.jsx'
import { useWebOrders } from './WebsiteOrders.jsx'

const hello = (ms) => {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Accra', hour: 'numeric', hour12: false }).format(ms))
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

export default function Home() {
  const { me, can, products, staffList } = useOps()
  const now = useNow(60000)
  const sales = useSalesForDay(businessDay(now))
  const orders = useWebOrders()
  const totals = dayTotals(sales || [])
  const openOrders = (orders || []).filter((order) => ['new', 'confirmed', 'ready', 'out_for_delivery'].includes(order.status))
  const newOrders = openOrders.filter((order) => order.status === 'new').length
  const low = products.filter((product) => stockLevel(sellableFromSummary(product.stock, now), product.setup.reorderPoint ?? 3) !== 'ok')
  const expired = products.filter((product) => (product.stock?.batches || []).some((batch) => batch.quantity > 0 && !sellable(batch, now)))
  const expiringSoon = products.filter((product) => expiryStatus(product.stock?.nextExpiry, now) === 'urgent')
  const mine = (sales || []).filter((sale) => sale.cashier?.uid === me.uid && sale.status !== 'voided')

  const todo = [
    newOrders ? { href: '#/orders', tone: 'bad', text: `${newOrders} new website order${newOrders === 1 ? '' : 's'} to call and confirm` } : null,
    can('approve') && !me.hasPin ? { href: '#/account', tone: 'warn', text: 'Set your approval PIN so you can approve refunds at the till' } : null,
    can('stock') && expired.length ? { href: '#/stock', tone: 'bad', text: `${expired.length} product(s) have expired items on the shelf. Remove and write them off.` } : null,
    expiringSoon.length ? { href: '#/stock', tone: 'warn', text: `${expiringSoon.length} product(s) expire within 30 days. Sell these first.` } : null,
    low.length ? { href: can('deliveries') ? '#/stock/receive' : '#/stock', tone: 'warn', text: `${low.length} product(s) are low or out of stock` } : null,
    can('products') && products.some((product) => !product.setup.barcode) ? { href: '#/setup', tone: '', text: `${products.filter((product) => !product.setup.barcode).length} product(s) have no barcode yet` } : null,
    can('staff') && staffList.length < 2 ? { href: '#/team', tone: '', text: 'Add your staff so each person signs in with their own account' } : null,
  ].filter(Boolean)

  return <div className="stack">
    <div className="home-hello">
      <h2>{hello(now)}, {me.name.split(' ')[0]}.</h2>
      <p className="muted">Here is the shop today.</p>
    </div>
    <div className="quick-actions">
      <a className="quick primary" href="#/sell"><Icon name="pos" size={22} /><span>New sale</span></a>
      <a className="quick" href="#/orders"><Icon name="cart" size={22} /><span>Website orders{openOrders.length ? ` (${openOrders.length})` : ''}</span></a>
      <a className="quick" href="#/sales"><Icon name="sale" size={22} /><span>Sales & refunds</span></a>
      <a className="quick" href={can('deliveries') ? '#/stock/receive' : '#/stock'}><Icon name="inventory" size={22} /><span>{can('deliveries') ? 'Receive stock' : 'Check stock'}</span></a>
    </div>
    <div className="stat-grid">
      <Stat label="Takings today" value={<Money value={totals.net} />} sub={`${totals.count} sale(s)`} href="#/sales" />
      <Stat label="Cash" value={<Money value={totals.byMethod.cash} />} sub={`MoMo ${formatMoney(totals.byMethod.momo)} · Card ${formatMoney(totals.byMethod.card)}`} />
      <Stat label="My sales today" value={mine.length} sub={<Money value={mine.reduce((sum, sale) => sum + sale.total, 0)} />} />
      <Stat label="Low stock" value={low.length} tone={low.length ? 'warn' : ''} href="#/stock" />
    </div>
    <Card title="To do">
      {todo.length ? <ul className="todo">{todo.map((item) => <li key={item.text}><a className={`todo-item ${item.tone}`} href={item.href}><span>{item.text}</span><Icon name="back" size={16} className="flip" /></a></li>)}</ul>
        : <p className="muted">All clear. Nothing needs attention right now.</p>}
    </Card>
    {sales?.length ? <Card title="Latest sales">
      <ul className="history">{sales.slice(0, 5).map((sale) => <li key={sale.id}><span>{fmtTime(sale.at)} · Sale {sale.number} · {sale.cashier?.name}</span><b>{sale.status === 'voided' ? 'Cancelled' : <Money value={sale.total} />}</b></li>)}</ul>
      <a className="btn ghost small" href="#/sales">See all sales</a>
    </Card> : null}
  </div>
}
