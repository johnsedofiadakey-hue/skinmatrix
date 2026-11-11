// Customers: everyone whose phone number was typed on a sale at the till, with how often they come, what they
// spend and what they bought. The records are kept by the server with each sale, cancel and return
// (functions/src/customers.js); this page only reads them.
import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { liveDb } from '../live/firebase.js'
import { useNow } from '../hooks.js'
import { formatMoney } from '../lib/money.js'
import { normalizePhone, refundedAmount } from '../../../functions/src/core/sale.js'
import { Dialog, Empty, Icon, Money, Pill, Stat } from '../components/ui.jsx'
import { downloadCsv, fmtDate, fmtFull } from '../components/format.js'

export function useCustomers() {
  const [customers, setCustomers] = useState(null)
  useEffect(() => onSnapshot(collection(liveDb, 'customers'),
    (snap) => setCustomers(snap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => b.lastVisit - a.lastVisit)),
    () => setCustomers([])), [])
  return customers
}

// One customer's sales, newest first.
function useCustomerSales(phone) {
  const [sales, setSales] = useState(null)
  useEffect(() => onSnapshot(query(collection(liveDb, 'sales'), where('customer.phone', '==', phone)),
    (snap) => setSales(snap.docs.map((item) => item.data()).sort((a, b) => b.at - a.at)),
    () => setSales([])), [phone])
  return sales
}

const whatsapp = (key) => `https://wa.me/${key}`

export default function Customers() {
  const customers = useCustomers()
  const now = useNow(60000)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('recent')
  const [open, setOpen] = useState(null)
  const list = useMemo(() => {
    const words = search.trim().toLowerCase()
    const phoneKey = normalizePhone(search)
    const digits = search.replace(/\D/g, '')
    const found = (customers || []).filter((customer) => !words
      || customer.name.toLowerCase().includes(words)
      || (phoneKey && customer.id === phoneKey)
      || (digits.length >= 3 && customer.phone.replace(/\D/g, '').includes(digits)))
    if (sort === 'spent') return [...found].sort((a, b) => b.totalSpent - a.totalSpent)
    if (sort === 'visits') return [...found].sort((a, b) => b.visits - a.visits)
    return found
  }, [customers, search, sort])
  const regulars = (customers || []).filter((customer) => customer.visits >= 3).length
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000
  const active = (customers || []).filter((customer) => customer.lastVisit >= monthAgo).length

  return <div className="stack">
    <p className="muted small">Customers appear here when the cashier types their phone number on a sale (POS → Customer). Next time, typing the number fills in their name.</p>
    <div className="stat-grid">
      <Stat label="Customers" value={customers ? customers.length : '…'} />
      <Stat label="Came in the last 30 days" value={customers ? active : '…'} />
      <Stat label="Regulars" value={customers ? regulars : '…'} sub="3 visits or more" />
    </div>
    <div className="toolbar">
      <label className="field grow"><span>Find a customer</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or phone number" /></label>
      <label className="field compact"><span>Sort by</span>
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="recent">Last visit</option>
          <option value="spent">Total spent</option>
          <option value="visits">Visits</option>
        </select>
      </label>
      {customers?.length ? <button type="button" className="btn ghost" onClick={() => downloadCsv('skinmatrix-customers.csv', [
        ['Name', 'Phone', 'Visits', 'Total spent (GHS)', 'First visit', 'Last visit'],
        ...list.map((customer) => [customer.name, customer.phone, customer.visits, (customer.totalSpent / 100).toFixed(2), fmtDate(customer.firstVisit), fmtDate(customer.lastVisit)]),
      ])}><Icon name="download" size={16} /> Download</button> : null}
    </div>
    {customers === null ? <p className="muted">Loading customers…</p>
      : !list.length ? <Empty title={customers.length ? 'No customer matches' : 'No customers yet'}>{customers.length ? 'Try part of the name or the phone number.' : 'On the POS, press Customer and type their phone number before taking payment.'}</Empty>
        : <ul className="customer-list">{list.map((customer) => <li key={customer.id}>
          <button type="button" className="customer-row" onClick={() => setOpen(customer)}>
            <span className="customer-initial" aria-hidden="true">{(customer.name || '#').slice(0, 1).toUpperCase()}</span>
            <span className="grow">
              <b>{customer.name || customer.phone}</b>
              <span className="muted small">{customer.name ? `${customer.phone} · ` : ''}{customer.visits} visit{customer.visits === 1 ? '' : 's'} · last came {fmtDate(customer.lastVisit)}</span>
            </span>
            {customer.visits >= 3 ? <Pill tone="green">Regular</Pill> : null}
            <Money value={customer.totalSpent} />
          </button>
        </li>)}</ul>}
    {open ? <CustomerDetail customer={open} onClose={() => setOpen(null)} /> : null}
  </div>
}

function CustomerDetail({ customer, onClose }) {
  const sales = useCustomerSales(customer.phone)
  const favourites = useMemo(() => {
    const count = new Map()
    for (const sale of sales || []) if (sale.status === 'completed') for (const item of sale.items) count.set(item.name, (count.get(item.name) || 0) + item.quantity)
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [sales])
  return <Dialog title={customer.name || customer.phone} onClose={onClose} wide>
    <div className="stack">
      <div className="row wrap">
        <span className="grow muted">{customer.phone} · customer since {fmtDate(customer.firstVisit)}</span>
        <a className="btn secondary" href={`tel:${customer.id}`}><Icon name="phone" size={16} /> Call</a>
        <a className="btn secondary" href={whatsapp(customer.id)} target="_blank" rel="noreferrer">WhatsApp</a>
      </div>
      <div className="stat-grid">
        <Stat label="Total spent" value={<Money value={customer.totalSpent} />} />
        <Stat label="Visits" value={customer.visits} />
        <Stat label="Average sale" value={<Money value={customer.visits ? Math.round(customer.totalSpent / customer.visits) : 0} />} />
      </div>
      {favourites.length ? <p><b>Buys most:</b> {favourites.map(([name, quantity]) => `${name} (${quantity})`).join(', ')}</p> : null}
      <h3>Purchases</h3>
      {sales === null ? <p className="muted">Loading…</p> : !sales.length ? <p className="muted">No sales found.</p>
        : <ul className="customer-sales">{sales.map((sale) => <li key={sale.id}>
          <span className="grow">
            <b>Receipt {sale.number}</b> <span className="muted small">{fmtFull(sale.at)}</span>
            <span className="muted small">{sale.items.map((item) => `${item.quantity}× ${item.name}`).join(', ')}</span>
          </span>
          {sale.status === 'voided' ? <Pill tone="red">Cancelled</Pill> : refundedAmount(sale) ? <Pill tone="amber">{formatMoney(refundedAmount(sale))} refunded</Pill> : null}
          <Money value={sale.total} />
        </li>)}</ul>}
    </div>
  </Dialog>
}
