import { useMemo, useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { can } from '../lib/permissions.js'
import { STATUS_ORDER, isOpen } from '../lib/orderStates.js'
import { orderAttention } from '../lib/attention.js'
import { businessDayKey } from '../lib/time.js'
import { ChannelTag, Empty, Icon, Money, PaymentPill, Pill, Segmented, StatusPill } from '../components/ui.jsx'
import { fmtWhen, PAYMENT_STATE } from '../components/format.js'

const FILTERS_KEY = 'skinmatrix-ops-order-filters'

function initialFilters() {
  const defaults = { view: 'open', search: '', status: 'all', payment: 'all', channel: 'all', from: '', to: '' }
  try { return { ...defaults, ...JSON.parse(sessionStorage.getItem(FILTERS_KEY) || '{}') } } catch { return defaults }
}

export default function Orders() {
  const { state, staff, run, inScope, branchFilter, setBranchFilter, branchName, multiBranch } = useOps()
  const now = useNow(30000)
  const [filters, setFiltersState] = useState(initialFilters)
  const setFilters = (patch) => setFiltersState((current) => {
    const next = { ...current, ...patch }
    try { sessionStorage.setItem(FILTERS_KEY, JSON.stringify(next)) } catch { /* convenience only */ }
    return next
  })

  const scoped = useMemo(() => state.orders.filter((order) => inScope(order.branchId)), [state.orders, inScope])
  const counts = {
    open: scoped.filter(isOpen).length,
    attention: scoped.filter((order) => orderAttention(order, now)).length,
    all: scoped.length,
  }

  const needle = filters.search.trim().toLowerCase()
  const rows = scoped.filter((order) => {
    if (filters.view === 'open' && !isOpen(order)) return false
    if (filters.view === 'attention' && !orderAttention(order, now)) return false
    if (filters.status !== 'all' && order.status !== filters.status) return false
    if (filters.payment !== 'all' && order.payment.state !== filters.payment) return false
    if (filters.channel !== 'all' && order.channel !== filters.channel) return false
    const day = businessDayKey(order.createdAt)
    if (filters.from && day < filters.from) return false
    if (filters.to && day > filters.to) return false
    if (needle) {
      const haystack = `${order.id} ${order.customer?.name || ''} ${order.customer?.phone || ''} ${order.payment.reference || ''}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    return true
  })

  const clear = () => setFilters({ search: '', status: 'all', payment: 'all', channel: 'all', from: '', to: '' })
  const filtered = filters.search || filters.status !== 'all' || filters.payment !== 'all' || filters.channel !== 'all' || filters.from || filters.to

  return <div className="stack">
    <div className="toolbar">
      <Segmented label="Order queue" value={filters.view} onChange={(view) => setFilters({ view })} options={[
        { value: 'open', label: 'Open', count: counts.open },
        { value: 'attention', label: 'Needs attention', count: counts.attention },
        { value: 'all', label: 'All', count: counts.all },
      ]} />
      <button type="button" className="btn secondary small" title="Demo: a customer pays on the website and the shop's stock is reserved"
        onClick={() => run((store) => store.simulateWebOrder(), (order) => order.branchId ? `${order.id} paid online; its stock is reserved.` : `${order.id} paid online, but the shop is short of stock. It is waiting for stock.`)}>
        <Pill tone="amber">Demo</Pill> Simulate web order
      </button>
      <label className="search grow">
        <Icon name="search" />
        <input value={filters.search} onChange={(event) => setFilters({ search: event.target.value })} placeholder="Order number, customer, phone or payment reference" aria-label="Search orders" />
      </label>
    </div>

    <div className="filter-bar">
      <label className="field compact"><span>Status</span>
        <select value={filters.status} onChange={(event) => setFilters({ status: event.target.value })}>
          <option value="all">Any status</option>
          {STATUS_ORDER.map((status) => <option key={status}>{status}</option>)}
        </select>
      </label>
      <label className="field compact"><span>Payment</span>
        <select value={filters.payment} onChange={(event) => setFilters({ payment: event.target.value })}>
          <option value="all">Any payment</option>
          {Object.entries(PAYMENT_STATE).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
        </select>
      </label>
      <label className="field compact"><span>Channel</span>
        <select value={filters.channel} onChange={(event) => setFilters({ channel: event.target.value })}>
          <option value="all">Counter and web</option>
          <option value="pos">Counter (POS)</option>
          <option value="web">Web</option>
        </select>
      </label>
      {multiBranch && can(staff, 'crossBranch') ? <label className="field compact"><span>Branch</span>
        <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
          <option value="all">All branches</option>
          {state.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.short}</option>)}
        </select>
      </label> : null}
      <label className="field compact"><span>From</span><input type="date" value={filters.from} onChange={(event) => setFilters({ from: event.target.value })} /></label>
      <label className="field compact"><span>To</span><input type="date" value={filters.to} onChange={(event) => setFilters({ to: event.target.value })} /></label>
      {filtered ? <button type="button" className="btn ghost small" onClick={clear}>Clear filters</button> : null}
    </div>

    <div className="table-card">
      <table className="table orders-table">
        <thead><tr>
          <th scope="col">Order</th>
          <th scope="col">Placed</th>
          <th scope="col">Customer</th>
          {multiBranch ? <th scope="col" className="hide-md">Branch</th> : null}
          <th scope="col" className="num hide-md">Items</th>
          <th scope="col" className="num">Total</th>
          <th scope="col">Payment</th>
          <th scope="col">Status</th>
        </tr></thead>
        <tbody>
          {rows.map((order) => {
            const flag = orderAttention(order, now)
            return <tr key={order.id} className="clickable" onClick={() => { window.location.hash = `#/orders/${order.id}` }}>
              <td><a href={`#/orders/${order.id}`} className="mono strong" onClick={(event) => event.stopPropagation()}>{order.id}</a> <ChannelTag channel={order.channel} /></td>
              <td className="nowrap">{fmtWhen(order.createdAt, now)}</td>
              <td>{order.customer?.name || <span className="muted">Walk-in</span>}{order.customer?.phone ? <span className="muted small block">{order.customer.phone}</span> : null}</td>
              {multiBranch ? <td className="hide-md nowrap">{order.branchId ? branchName(order.branchId) : <span className="muted">None yet</span>}</td> : null}
              <td className="num hide-md">{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td>
              <td className="num"><Money value={order.total} /></td>
              <td><PaymentPill payment={order.payment} /></td>
              <td><span className="status-cell"><StatusPill status={order.status} />{flag ? <Pill tone={flag.level === 'high' ? 'red' : 'amber'}>{flag.text}</Pill> : null}</span></td>
            </tr>
          })}
        </tbody>
      </table>
      {!rows.length ? <Empty title="No orders match">{filtered ? 'Try clearing a filter.' : 'Nothing in this queue right now.'}</Empty> : null}
    </div>
    <p className="muted small">{rows.length} of {scoped.length} orders.</p>
  </div>
}
