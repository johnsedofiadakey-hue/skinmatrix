import { useMemo, useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { can } from '../lib/permissions.js'
import { buildCustomers, displayPhone } from '../lib/customers.js'
import { Card, ChannelTag, Empty, Icon, Money, PaymentPill, Segmented, Stat, StatusPill } from '../components/ui.jsx'
import { downloadCsv, fmtDate, fmtWhen } from '../components/format.js'
import { ContactLinks } from './OrderDetail.jsx'

// Customer records built from every order with a phone number. Branch staff see customers who bought at their branch.
export default function Customers({ customerKey }) {
  const { state, staff, inScope, branchName, multiBranch } = useOps()
  const now = useNow(60000)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('recent')

  const visibleOrders = useMemo(() => state.orders.filter((order) => inScope(order.branchId)), [state.orders, inScope])
  const customers = useMemo(() => [...buildCustomers(visibleOrders).values()], [visibleOrders])

  if (customerKey) {
    const customer = customers.find((candidate) => candidate.key === customerKey)
    if (!customer) return <Empty title="Customer not found">They may have bought only at another branch.<br /><a className="link" href="#/customers">Back to customers</a></Empty>
    const orders = visibleOrders.filter((order) => customer.orderIds.includes(order.id)).sort((a, b) => b.createdAt - a.createdAt)
    return <div className="stack gap-lg">
      <div className="detail-head">
        <a href="#/customers" className="back"><Icon name="back" size={16} />Customers</a>
        <div className="detail-title"><h2>{customer.name || displayPhone(customer.key)}</h2></div>
        <p className="muted"><ContactLinks phone={displayPhone(customer.key)} /></p>
      </div>
      <div className="stat-grid">
        <Stat label="Lifetime spend" value={<Money value={customer.spend} />} sub="Collected, not reversed" />
        <Stat label="Paid orders" value={customer.orders} sub={`${customer.channels.pos} counter · ${customer.channels.web} web`} />
        <Stat label="Average order" value={<Money value={customer.orders ? Math.round(customer.spend / customer.orders) : 0} />} />
        <Stat label="Customer since" value={fmtDate(customer.firstAt)} sub={`Last order ${fmtWhen(customer.lastAt, now)}`} />
      </div>
      <Card title="Orders" flush>
        <table className="table">
          <thead><tr><th scope="col">Order</th><th scope="col">Placed</th>{multiBranch ? <th scope="col" className="hide-md">Branch</th> : null}<th scope="col">Items</th><th scope="col" className="num">Total</th><th scope="col">Payment</th><th scope="col">Status</th></tr></thead>
          <tbody>{orders.map((order) => <tr key={order.id} className="clickable" onClick={() => { window.location.hash = `#/orders/${order.id}` }}>
            <td><a className="mono strong" href={`#/orders/${order.id}`} onClick={(event) => event.stopPropagation()}>{order.id}</a> <ChannelTag channel={order.channel} /></td>
            <td className="nowrap">{fmtWhen(order.createdAt, now)}</td>
            {multiBranch ? <td className="hide-md nowrap">{order.branchId ? branchName(order.branchId) : '—'}</td> : null}
            <td className="small">{order.items.map((item) => `${item.quantity}× ${item.name}`).join(', ')}</td>
            <td className="num"><Money value={order.total} /></td>
            <td><PaymentPill payment={order.payment} /></td>
            <td><StatusPill status={order.status} /></td>
          </tr>)}</tbody>
        </table>
      </Card>
      <p className="muted small">Sample customer · demo data. Customers are recognised by phone number, so “024…”, “+233 24…” and “0024…” are the same person.</p>
    </div>
  }

  const needle = query.trim().toLowerCase()
  const digits = needle.replace(/\D/g, '')
  const matches = (customer) => !needle || customer.name.toLowerCase().includes(needle) ||
    (digits.length >= 3 && (`0${customer.key.slice(3)}`.includes(digits) || customer.key.includes(digits)))
  const rows = customers
    .filter(matches)
    .sort((a, b) => (sort === 'spend' ? b.spend - a.spend : sort === 'orders' ? b.orders - a.orders : b.lastAt - a.lastAt))
  const repeat = customers.filter((customer) => customer.orders > 1)

  const exportCsv = () => downloadCsv('skinmatrix-DEMO-customers.csv', [
    ['DEMO DATA — not real customers'],
    ['Name', 'Phone', 'Paid orders', 'Lifetime spend (GHS)', 'First order', 'Last order'],
    // Cells starting with = + - @ are prefixed so a spreadsheet never runs them as formulas.
    ...rows.map((customer) => [customer.name, displayPhone(customer.key), customer.orders, (customer.spend / 100).toFixed(2), fmtDate(customer.firstAt), fmtDate(customer.lastAt)].map((cell) => (/^[=+\-@]/.test(String(cell)) ? `'${cell}` : cell))),
  ])

  return <div className="stack">
    <div className="stat-grid">
      <Stat label="Customers" value={customers.length} sub="With a phone number on an order" />
      <Stat label="Repeat customers" value={repeat.length} sub={`${customers.length ? Math.round((repeat.length / customers.length) * 100) : 0}% bought more than once`} />
      <Stat label="Repeat customers' spend" value={<Money value={repeat.reduce((sum, customer) => sum + customer.spend, 0)} />} />
    </div>
    <div className="toolbar">
      <Segmented label="Sort customers" value={sort} onChange={setSort} options={[{ value: 'recent', label: 'Recent' }, { value: 'spend', label: 'Top spend' }, { value: 'orders', label: 'Most orders' }]} />
      <label className="search grow"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or phone" aria-label="Search customers" /></label>
      {can(staff, 'viewLedger') ? <button type="button" className="btn secondary small" onClick={exportCsv}><Icon name="download" size={15} />Export</button> : null}
    </div>
    <div className="table-card">
      <table className="table">
        <thead><tr><th scope="col">Customer</th><th scope="col">Phone</th><th scope="col" className="num">Paid orders</th><th scope="col" className="num">Lifetime spend</th>{multiBranch ? <th scope="col" className="hide-md">Branches</th> : null}<th scope="col">Last order</th></tr></thead>
        <tbody>{rows.map((customer) => <tr key={customer.key} className="clickable" onClick={() => { window.location.hash = `#/customers/${customer.key}` }}>
          <td><a className="strong" href={`#/customers/${customer.key}`} onClick={(event) => event.stopPropagation()}>{customer.name || 'No name given'}</a>{customer.orders > 1 ? <span className="muted small block">Repeat customer</span> : null}</td>
          <td className="nowrap">{displayPhone(customer.key)}</td>
          <td className="num">{customer.orders}</td>
          <td className="num strong"><Money value={customer.spend} /></td>
          {multiBranch ? <td className="hide-md small">{[...customer.branches].map(branchName).join(', ')}</td> : null}
          <td className="nowrap">{fmtWhen(customer.lastAt, now)}</td>
        </tr>)}</tbody>
      </table>
      {!rows.length ? <Empty title="No customers match" /> : null}
    </div>
    <p className="muted small">Sample customers · demo data. Every counter sale with a phone number adds to the customer's record; in production the server keeps these totals.</p>
  </div>
}
