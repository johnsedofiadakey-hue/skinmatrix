import { Fragment, useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { groupByDay, isCountedSale, ledgerTotals } from '../lib/ledger.js'
import { businessDayKey, DAY } from '../lib/time.js'
import { formatMoney } from '../lib/money.js'
import { Empty, Icon, MethodSplit, Money, Pill, Segmented, Stat } from '../components/ui.jsx'
import { downloadCsv, fmtDayKey, paymentLabel } from '../components/format.js'
import { can } from '../lib/permissions.js'
import { marginTotals, productPerformance } from '../lib/margin.js'

// Business-day presets, all in Ghana time (UTC+0).
function presetRange(preset, now) {
  const today = businessDayKey(now)
  if (preset === 'today') return [today, today]
  if (preset === 'yesterday') { const day = businessDayKey(now - DAY); return [day, day] }
  if (preset === '7d') return [businessDayKey(now - 6 * DAY), today]
  if (preset === 'month') return [`${today.slice(0, 7)}-01`, today]
  return ['', today]
}

export default function Ledger() {
  const { state, staff, branchIds, branchName, inScope, multiBranch } = useOps()
  const now = useNow(60000)
  const [preset, setPreset] = useState('7d')
  const [[from, to], setRange] = useState(() => presetRange('7d', now))
  const [channel, setChannel] = useState('all')
  const [view, setView] = useState(multiBranch ? 'branch' : 'method')
  const [productSort, setProductSort] = useState('revenue')
  const [openDay, setOpenDay] = useState(null)

  const choosePreset = (value) => { setPreset(value); setRange(presetRange(value, now)) }
  const orders = state.orders.filter((order) => {
    const day = businessDayKey(order.createdAt)
    return inScope(order.branchId) && (!from || day >= from) && (!to || day <= to) && (channel === 'all' || order.channel === channel)
  })
  const totals = ledgerTotals(orders)
  const days = groupByDay(orders)
  const average = totals.count ? Math.round(totals.gross / totals.count) : 0
  const columns = [...branchIds, ...(orders.some((order) => !order.branchId) ? [null] : [])]
  const branchTotal = (list, branchId) => ledgerTotals(list.filter((order) => order.branchId === branchId))
  const best = days.reduce((top, day) => (!top || day.totals.net > top.totals.net ? day : top), null)
  const costs = can(staff, 'viewCosts')
  const performance = productPerformance(orders, state.batches)
  const margin = marginTotals(performance)
  const sortedProducts = [...performance].sort((a, b) => b[productSort] - a[productSort])

  const exportCsv = () => downloadCsv(`skinmatrix-DEMO-ledger-${from || 'start'}-to-${to || 'today'}.csv`, [
    ['DEMO DATA — not real sales'],
    ['Business day', 'Order', 'Channel', 'Staff', 'Status', 'Payment', 'Payment state', 'Reference', 'Subtotal (GHS)', 'Discount (GHS)', 'Total (GHS)', 'Returned (GHS)'],
    ...orders.map((order) => [businessDayKey(order.createdAt), order.id, order.channel === 'pos' ? 'Counter' : 'Web', order.createdBy?.name || 'Website', order.status, paymentLabel(order.payment), order.payment.state, order.payment.reference || '', (order.subtotal / 100).toFixed(2), ((order.discount?.amount || 0) / 100).toFixed(2), (order.total / 100).toFixed(2), ((order.returns || []).reduce((sum, entry) => sum + entry.amount, 0) / 100).toFixed(2)]),
  ])

  return <div className="stack gap-lg">
    <div className="filter-bar">
      <div className="field compact"><span>Period</span>
        <Segmented label="Period" value={preset} onChange={choosePreset} options={[{ value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: '7d', label: '7 days' }, { value: 'month', label: 'This month' }, { value: 'all', label: 'All' }]} />
      </div>
      <label className="field compact"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(event) => { setPreset('custom'); setRange([event.target.value, to]) }} /></label>
      <label className="field compact"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(event) => { setPreset('custom'); setRange([from, event.target.value]) }} /></label>
      <div className="field compact"><span>Channel</span>
        <Segmented label="Channel" value={channel} onChange={setChannel} options={[{ value: 'all', label: 'All' }, { value: 'pos', label: 'Counter' }, { value: 'web', label: 'Web' }]} />
      </div>
      <button type="button" className="btn secondary small push" onClick={exportCsv} disabled={!orders.length}><Icon name="download" size={15} />Export CSV</button>
    </div>

    <div className="stat-grid">
      <Stat label="Net sales" value={<Money value={totals.net} />} sub={`${totals.count} paid orders · avg ${formatMoney(average)}`} />
      <Stat label="Discounts · returns" value={<MethodSplit rows={[['Discounts', totals.discounts], ['Returns', totals.returns]]} />} sub={`${totals.returnCount} return${totals.returnCount === 1 ? '' : 's'}`} />
      {costs ? <Stat label="Gross margin" value={<Money value={margin.margin} />} tone={margin.marginPct < 30 ? 'warn' : ''} sub={`${margin.marginPct}% · cost of goods ${formatMoney(margin.cost)}`} /> : null}
      <Stat label="By payment method" value={<MethodSplit rows={[['Cash', totals.byMethod.cash], ['MoMo', totals.byMethod.momo], ['Card', totals.byMethod.card]]} />} />
      <Stat label="Best day" value={best ? <Money value={best.totals.net} /> : '—'} sub={best ? fmtDayKey(best.day) : 'No sales in this period'} />
      <Stat label="Voids and refunds" value={totals.reversedCount} tone={totals.reversedCount ? 'warn' : ''} sub={`${formatMoney(totals.reversedValue)} reversed · ${totals.refundsDue} refund due`} />
    </div>

    <div className="row wrap">
      <Segmented label="Ledger layout" value={view} onChange={setView} options={[
        ...(multiBranch ? [{ value: 'branch', label: 'Days × branches' }] : []),
        { value: 'method', label: 'By day' },
        ...(costs ? [{ value: 'products', label: 'Products & margin' }] : []),
        { value: 'staff', label: 'By staff' },
      ]} />
      {view === 'branch' ? <span className="muted small">Select a day to see how each branch was paid.</span> : null}
    </div>

    <div className="table-card">
      {view === 'branch' ? <table className="table ledger-table">
        <thead><tr>
          <th scope="col">Business day</th>
          {columns.map((id) => <th scope="col" key={id || 'none'} className="num">{id ? branchName(id) : 'No branch'}</th>)}
          <th scope="col" className="num">Orders</th>
          <th scope="col" className="num">Total</th>
        </tr></thead>
        <tbody>{days.map(({ day, orders: list, totals: dayTotals }) => <Fragment key={day}>
          <tr className="clickable" onClick={() => setOpenDay(openDay === day ? null : day)} aria-expanded={openDay === day}>
            <td className="nowrap"><span className="disclosure-mark inline">{openDay === day ? '−' : '+'}</span>{fmtDayKey(day)}{day === businessDayKey(now) ? <span className="muted small"> · today</span> : null}{best?.day === day && days.length > 1 ? <> <Pill tone="green">Best</Pill></> : null}</td>
            {columns.map((id) => <td key={id || 'none'} className="num"><Money value={branchTotal(list, id).gross} /></td>)}
            <td className="num">{dayTotals.count}</td>
            <td className="num strong"><Money value={dayTotals.gross} /></td>
          </tr>
          {openDay === day ? <tr className="detail-row"><td colSpan={columns.length + 3}>
            <div className="day-breakdown">
              {columns.map((id) => {
                const branch = branchTotal(list, id)
                return <div key={id || 'none'} className="day-branch">
                  <b>{id ? branchName(id) : 'No branch'}</b>
                  <MethodSplit rows={[['Cash', branch.byMethod.cash], ['MoMo', branch.byMethod.momo], ['Card', branch.byMethod.card]]} />
                  <span className="muted small">{branch.count} paid · {branch.reversedCount} reversed</span>
                </div>
              })}
            </div>
          </td></tr> : null}
        </Fragment>)}</tbody>
        {days.length > 1 ? <tfoot><tr>
          <td>Period</td>
          {columns.map((id) => <td key={id || 'none'} className="num"><Money value={branchTotal(orders, id).gross} /></td>)}
          <td className="num">{totals.count}</td>
          <td className="num strong"><Money value={totals.gross} /></td>
        </tr></tfoot> : null}
      </table> : view === 'products' ? <ProductTable rows={sortedProducts} sort={productSort} setSort={setProductSort} total={margin} /> : view === 'staff' ? <StaffTable orders={orders} /> : <table className="table ledger-table">
        <thead><tr>
          <th scope="col">Business day</th>
          <th scope="col" className="num">Paid orders</th>
          <th scope="col" className="num">Cash</th>
          <th scope="col" className="num">MoMo</th>
          <th scope="col" className="num hide-md">Card</th>
          <th scope="col" className="num hide-md">Discounts</th>
          <th scope="col" className="num">Returns · voids</th>
          <th scope="col" className="num">Net</th>
        </tr></thead>
        <tbody>{days.map(({ day, totals: dayTotals }) => <tr key={day}>
          <td className="nowrap">{fmtDayKey(day)}{day === businessDayKey(now) ? <span className="muted small"> · today</span> : null}</td>
          <td className="num">{dayTotals.count}</td>
          <td className="num"><Money value={dayTotals.byMethod.cash} /></td>
          <td className="num"><Money value={dayTotals.byMethod.momo} /></td>
          <td className="num hide-md"><Money value={dayTotals.byMethod.card} /></td>
          <td className="num hide-md">{dayTotals.discounts ? formatMoney(dayTotals.discounts) : <span className="muted">—</span>}</td>
          <td className="num">{dayTotals.returns || dayTotals.reversedCount ? <span className="warn-text">{dayTotals.returns ? formatMoney(dayTotals.returns) : ''}{dayTotals.returns && dayTotals.reversedCount ? ' · ' : ''}{dayTotals.reversedCount ? `${dayTotals.reversedCount} void` : ''}</span> : <span className="muted">—</span>}</td>
          <td className="num strong"><Money value={dayTotals.net} /></td>
        </tr>)}</tbody>
      </table>}
      {!days.length ? <Empty title="No orders in this period" /> : null}
    </div>
    <p className="muted small">Net is money collected minus returns. Discounts are already taken off each sale. Margin uses the cost of the exact batches each sale took. Unpaid orders are excluded; voided and cancelled sales stay in the record but never count as money. Business days follow Ghana time (UTC+0). In production these figures come from server-side aggregates.</p>
  </div>
}

function ProductTable({ rows, sort, setSort, total }) {
  const head = (key, label) => <th scope="col" className="num"><button type="button" className={`sort-button ${sort === key ? 'on' : ''}`} onClick={() => setSort(key)}>{label}{sort === key ? ' ↓' : ''}</button></th>
  return <table className="table">
    <thead><tr><th scope="col">Product</th>{head('units', 'Units')}{head('revenue', 'Revenue')}{head('cost', 'Cost')}{head('margin', 'Margin')}{head('marginPct', 'Margin %')}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.variantId}>
      <td><b>{row.name}</b><span className="muted small block">{row.variantName} · {row.sku}</span></td>
      <td className="num">{row.units}</td>
      <td className="num"><Money value={row.revenue} /></td>
      <td className="num"><Money value={row.cost} /></td>
      <td className="num strong"><Money value={row.margin} /></td>
      <td className="num"><span className={row.marginPct < 30 ? 'warn-text' : ''}>{row.marginPct}%</span></td>
    </tr>)}</tbody>
    <tfoot><tr><td>All products</td><td className="num">{rows.reduce((sum, row) => sum + row.units, 0)}</td><td className="num"><Money value={total.revenue} /></td><td className="num"><Money value={total.cost} /></td><td className="num strong"><Money value={total.margin} /></td><td className="num">{total.marginPct}%</td></tr></tfoot>
  </table>
}

function StaffTable({ orders }) {
  const rows = new Map()
  for (const order of orders) {
    if (order.channel !== 'pos') continue
    const key = order.createdBy?.id || 'unknown'
    if (!rows.has(key)) rows.set(key, { name: order.createdBy?.name || 'Unknown', sales: 0, count: 0, discounts: 0, voids: 0 })
    const row = rows.get(key)
    if (isCountedSale(order)) { row.sales += order.total - (order.returns || []).reduce((sum, entry) => sum + entry.amount, 0); row.count += 1; row.discounts += order.discount?.amount || 0 }
    else if (order.status === 'Cancelled') row.voids += 1
  }
  return <table className="table">
    <thead><tr><th scope="col">Staff member</th><th scope="col" className="num">Counter sales</th><th scope="col" className="num">Net value</th><th scope="col" className="num">Discounts given</th><th scope="col" className="num">Voided</th></tr></thead>
    <tbody>{[...rows.values()].sort((a, b) => b.sales - a.sales).map((row) => <tr key={row.name}>
      <td><b>{row.name}</b></td><td className="num">{row.count}</td><td className="num strong"><Money value={row.sales} /></td><td className="num"><Money value={row.discounts} /></td><td className="num">{row.voids || '—'}</td>
    </tr>)}</tbody>
  </table>
}
