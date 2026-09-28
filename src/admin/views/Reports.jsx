import { useEffect, useMemo, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { liveDb } from '../live/firebase.js'
import { useNow, useOps } from '../hooks.js'
import { formatMoney } from '../lib/money.js'
import { businessDay, DAY } from '../../../functions/src/core/time.js'
import { refundedAmount } from '../../../functions/src/core/sale.js'
import { Card, Empty, Icon, Money, Segmented, Stat } from '../components/ui.jsx'
import { Guide } from '../components/guide.jsx'
import { PrintArea, printNow } from '../components/receipt.jsx'
import { downloadCsv, fmtDayKey, fmtFull, fmtWhen } from '../components/format.js'
import { DrawerReport } from './Drawer.jsx'

const PERIODS = [
  { value: 'today', label: 'Today', days: 1 },
  { value: 'week', label: '7 days', days: 7 },
  { value: 'month', label: '30 days', days: 30 },
]
const PAID_BY = { cash: 'Cash', momo: 'MoMo', card: 'Card' }

function useRange(collectionName, from, to) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    setRows(null)
    return onSnapshot(query(collection(liveDb, collectionName), where('day', '>=', from), where('day', '<=', to)), (snap) => setRows(snap.docs.map((item) => ({ id: item.id, ...item.data() }))), () => setRows([]))
  }, [collectionName, from, to])
  return rows
}

export function summarizeSales(sales, costs = new Map()) {
  const result = { count: 0, gross: 0, refunds: 0, discounts: 0, voided: 0, voidedValue: 0, cost: 0, byMethod: { cash: 0, momo: 0, card: 0 }, refundsByMethod: { cash: 0, momo: 0, card: 0 }, products: new Map(), staff: new Map() }
  for (const sale of sales) {
    if (sale.status === 'voided') { result.voided += 1; result.voidedValue += sale.total; continue }
    const refunded = refundedAmount(sale)
    result.count += 1
    result.gross += sale.total
    result.refunds += refunded
    result.discounts += sale.discount?.amount || 0
    result.byMethod[sale.payment.method] += sale.total
    for (const entry of sale.returns || []) result.refundsByMethod[entry.refundMethod] += entry.amount
    // Cost of what was kept: the sale's cost, reduced in proportion to what came back.
    const cost = costs.get(sale.id)?.cost ?? 0
    result.cost += sale.total ? Math.round(cost * (1 - refunded / sale.total)) : cost
    for (const item of sale.items) {
      const row = result.products.get(item.productId) || { name: item.name, size: item.size, quantity: 0, value: 0 }
      row.quantity += item.quantity
      row.value += item.lineTotal
      result.products.set(item.productId, row)
    }
    const who = sale.cashier?.name || 'Unknown'
    const person = result.staff.get(who) || { count: 0, value: 0 }
    person.count += 1
    person.value += sale.total - refunded
    result.staff.set(who, person)
  }
  result.net = result.gross - result.refunds
  result.profit = result.net - result.cost
  return result
}

export default function Reports() {
  const now = useNow(60000)
  const today = businessDay(now)
  const [period, setPeriod] = useState('today')
  const [custom, setCustom] = useState({ from: today, to: today })
  const [tab, setTab] = useState('money')
  const range = period === 'custom' ? custom : { from: businessDay(now - (PERIODS.find((item) => item.value === period).days - 1) * DAY), to: today }
  const sales = useRange('sales', range.from, range.to)
  const saleCosts = useRange('saleCosts', range.from, range.to)
  const shifts = useRange('shifts', range.from, range.to)
  const costs = useMemo(() => new Map((saleCosts || []).map((row) => [row.id, row])), [saleCosts])
  const summary = useMemo(() => summarizeSales(sales || [], costs), [sales, costs])
  const label = range.from === range.to ? fmtDayKey(range.from) : `${fmtDayKey(range.from)} – ${fmtDayKey(range.to)}`

  const exportCsv = () => downloadCsv(`skinmatrix-sales-${range.from}-to-${range.to}.csv`, [
    ['Sale', 'Day', 'Time', 'Cashier', 'Status', 'Payment', 'Items', 'Subtotal GHS', 'Discount GHS', 'Total GHS', 'Refunded GHS', 'Customer'],
    ...(sales || []).sort((a, b) => a.at - b.at).map((sale) => [sale.number, sale.day, fmtFull(sale.at), sale.cashier?.name, sale.status, PAID_BY[sale.payment.method], sale.items.map((item) => `${item.quantity}x ${item.name}`).join('; '), (sale.subtotal / 100).toFixed(2), ((sale.discount?.amount || 0) / 100).toFixed(2), (sale.total / 100).toFixed(2), (refundedAmount(sale) / 100).toFixed(2), sale.customer?.name || '']),
  ])

  return <div className="stack">
    <Guide id="reports" title="Closing the day" steps={[
      'Each cashier counts and closes their own drawer (Cash drawer). Drawers shows every count and any difference.',
      'Check the MoMo total against the shop MoMo statement.',
      'Press Print day summary to keep a paper copy, or Download for Excel.',
      'Profit uses the cost you typed when receiving deliveries. Products with no cost count as zero cost.',
    ]} />
    <div className="toolbar">
      <Segmented label="Period" value={period} onChange={setPeriod} options={[...PERIODS.map(({ value, label: text }) => ({ value, label: text })), { value: 'custom', label: 'Pick dates' }]} />
      {period === 'custom' ? <div className="row">
        <label className="field compact"><span>From</span><input type="date" max={custom.to} value={custom.from} onChange={(event) => event.target.value && setCustom({ ...custom, from: event.target.value })} /></label>
        <label className="field compact"><span>To</span><input type="date" min={custom.from} max={today} value={custom.to} onChange={(event) => event.target.value && setCustom({ ...custom, to: event.target.value })} /></label>
      </div> : null}
    </div>
    <p className="muted">{label}</p>
    <Segmented label="Report" value={tab} onChange={setTab} options={[{ value: 'money', label: 'Money' }, { value: 'products', label: 'Products' }, { value: 'drawers', label: 'Drawers' }, { value: 'activity', label: 'Activity' }]} />
    {sales === null ? <p className="muted">Loading…</p> : null}
    {sales && tab === 'money' ? <MoneyReport summary={summary} label={label} onCsv={exportCsv} /> : null}
    {sales && tab === 'products' ? <ProductReport summary={summary} /> : null}
    {tab === 'drawers' ? <DrawerReport shifts={shifts} /> : null}
    {tab === 'activity' ? <Activity range={range} /> : null}
  </div>
}

function DaySummary({ summary, label, shop }) {
  const cashInDrawer = summary.byMethod.cash - summary.refundsByMethod.cash
  return <div className="receipt">
    <div className="receipt-head"><b className="receipt-shop">{shop?.legalName || 'SkinMatrix'}</b><span>Sales summary</span><span>{label}</span></div>
    <div className="receipt-totals">
      <div><span>Sales</span><span>{summary.count}</span></div>
      <div><span>Takings (after refunds)</span><span>{formatMoney(summary.net)}</span></div>
      <div><span>Cash taken</span><span>{formatMoney(summary.byMethod.cash)}</span></div>
      <div><span>Cash refunded</span><span>−{formatMoney(summary.refundsByMethod.cash)}</span></div>
      <div className="receipt-total"><span>CASH IN DRAWER</span><span>{formatMoney(cashInDrawer)}</span></div>
      <div><span>MoMo</span><span>{formatMoney(summary.byMethod.momo - summary.refundsByMethod.momo)}</span></div>
      <div><span>Card</span><span>{formatMoney(summary.byMethod.card - summary.refundsByMethod.card)}</span></div>
      <div><span>Discounts given</span><span>{formatMoney(summary.discounts)}</span></div>
      <div><span>Cancelled sales</span><span>{summary.voided}</span></div>
    </div>
    <p className="receipt-foot">Printed {fmtFull(Date.now())}<br />Counted by: ____________</p>
  </div>
}

function MoneyReport({ summary, label, onCsv }) {
  const { shop } = useOps()
  const cashInDrawer = summary.byMethod.cash - summary.refundsByMethod.cash
  const margin = summary.net ? Math.round((summary.profit / summary.net) * 100) : 0
  return <>
    <div className="stat-grid">
      <Stat label="Takings" value={<Money value={summary.net} />} sub={`${summary.count} sale(s)${summary.refunds ? ` · ${formatMoney(summary.refunds)} refunded` : ''}`} />
      <Stat label="Cash in the drawer" value={<Money value={cashInDrawer} />} sub="Cash taken minus cash refunds" />
      <Stat label="Profit (approx.)" value={<Money value={summary.profit} />} sub={`${margin}% of takings`} tone={summary.profit < 0 ? 'bad' : ''} />
      <Stat label="Discounts given" value={<Money value={summary.discounts} />} sub={summary.voided ? `${summary.voided} sale(s) cancelled` : undefined} />
    </div>
    <Card title="By payment">
      <table className="table compact"><thead><tr><th scope="col">Method</th><th scope="col" className="num">Taken</th><th scope="col" className="num">Refunded</th><th scope="col" className="num">Kept</th></tr></thead>
        <tbody>{['cash', 'momo', 'card'].map((method) => <tr key={method}><td>{PAID_BY[method]}</td><td className="num">{formatMoney(summary.byMethod[method])}</td><td className="num">{formatMoney(summary.refundsByMethod[method])}</td><td className="num"><b>{formatMoney(summary.byMethod[method] - summary.refundsByMethod[method])}</b></td></tr>)}</tbody>
      </table>
    </Card>
    {summary.staff.size ? <Card title="By staff">
      <table className="table compact"><tbody>{[...summary.staff].sort((a, b) => b[1].value - a[1].value).map(([name, row]) => <tr key={name}><td>{name}</td><td className="num">{row.count} sale(s)</td><td className="num">{formatMoney(row.value)}</td></tr>)}</tbody></table>
    </Card> : null}
    <div className="button-grid">
      <button type="button" className="btn primary" onClick={printNow}><Icon name="printer" size={16} /> Print day summary</button>
      <button type="button" className="btn secondary" onClick={onCsv}><Icon name="download" size={16} /> Download (Excel)</button>
    </div>
    <PrintArea><DaySummary summary={summary} label={label} shop={shop} /></PrintArea>
  </>
}

function ProductReport({ summary }) {
  const rows = [...summary.products.values()].sort((a, b) => b.value - a.value)
  if (!rows.length) return <Empty title="No sales in this period" />
  return <Card title="Best sellers" flush>
    <table className="table compact"><thead><tr><th scope="col">Product</th><th scope="col" className="num">Sold</th><th scope="col" className="num">Value</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={`${row.name}-${row.size}`}><td>{row.name}{row.size ? <span className="muted small"> · {row.size}</span> : null}</td><td className="num">{row.quantity}</td><td className="num">{formatMoney(row.value)}</td></tr>)}</tbody>
    </table>
  </Card>
}

const AUDIT_LABEL = { shift: 'Cash drawer', settings: 'Settings', web_payment: 'Website payment', sale: 'Sale', void: 'Sale cancelled', return: 'Return', web_order: 'Website order', delivery: 'Delivery', stock_adjustment: 'Stock adjusted', write_off: 'Write-off', stock_count: 'Stock take', product_setup: 'Product setup', supplier: 'Supplier', staff: 'Team' }

function Activity({ range }) {
  const now = useNow(60000)
  const [rows, setRows] = useState(null)
  const [type, setType] = useState('all')
  useEffect(() => {
    setRows(null)
    return onSnapshot(query(collection(liveDb, 'audit'), where('day', '>=', range.from), where('day', '<=', range.to), orderBy('day', 'desc'), limit(500)), (snap) => setRows(snap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => b.at - a.at)), () => setRows([]))
  }, [range.from, range.to])
  if (!rows) return <p className="muted">Loading…</p>
  const types = [...new Set(rows.map((row) => row.type))]
  const shown = type === 'all' ? rows : rows.filter((row) => row.type === type)
  return <>
    <p className="muted small">Everything that changed money or stock, with who did it. Nobody can edit or delete this list.</p>
    {types.length > 1 ? <label className="field compact"><span>Show</span><select value={type} onChange={(event) => setType(event.target.value)}><option value="all">Everything</option>{types.map((item) => <option key={item} value={item}>{AUDIT_LABEL[item] || item}</option>)}</select></label> : null}
    {shown.length ? <ul className="history card">{shown.map((row) => <li key={row.id}>
      <span className="muted small">{fmtWhen(row.at, now)} · {row.actor?.name}</span>
      <span><b>{AUDIT_LABEL[row.type] || row.type}:</b> {row.summary}{row.detail ? <span className="muted"> — {row.detail}</span> : null}</span>
    </li>)}</ul> : <Empty title="Nothing recorded in this period" />}
  </>
}
