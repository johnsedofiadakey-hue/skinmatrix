import { useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { can } from '../lib/permissions.js'
import { Empty, Icon, Pill } from '../components/ui.jsx'
import { fmtWhen, ROLE_LABEL } from '../components/format.js'

const TYPES = {
  sale_created: { label: 'Sale created', tone: 'green' },
  status_change: { label: 'Status change', tone: 'blue' },
  void: { label: 'Void', tone: 'red' },
  pos_correction: { label: 'POS correction', tone: 'violet' },
  stock_adjustment: { label: 'Stock adjustment', tone: 'teal' },
  hold_created: { label: 'MoMo hold', tone: 'amber' },
  hold_released: { label: 'Hold released', tone: 'grey' },
  payment_exception: { label: 'Payment exception', tone: 'red' },
  exception_resolved: { label: 'Exception resolved', tone: 'green' },
  assignment: { label: 'Assignment', tone: 'grey' },
  note: { label: 'Note', tone: 'grey' },
  stock_take: { label: 'Stock take', tone: 'teal' },
  rider_assigned: { label: 'Rider', tone: 'violet' },
  web_order: { label: 'Web order', tone: 'blue' },
  walk_in_import: { label: 'Walk-in import', tone: 'teal' },
  approval: { label: 'Manager approval', tone: 'amber' },
  return: { label: 'Return', tone: 'red' },
  login: { label: 'Sign-in', tone: 'grey' },
  staff_added: { label: 'Staff added', tone: 'violet' },
  staff_updated: { label: 'Staff changed', tone: 'violet' },
  delivery_received: { label: 'Delivery', tone: 'teal' },
  supplier_saved: { label: 'Supplier', tone: 'grey' },
  product_saved: { label: 'Product', tone: 'blue' },
  price_change: { label: 'Price change', tone: 'amber' },
}

export default function Audit() {
  const { state, staff, branchIds, branchName, multiBranch } = useOps()
  const now = useNow(30000)
  const [type, setType] = useState('all')
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()

  const entries = state.audit.filter((entry) =>
    (entry.branchId ? branchIds.includes(entry.branchId) : can(staff, 'crossBranch')) &&
    (type === 'all' || entry.type === type) &&
    (!needle || `${entry.summary} ${entry.detail || ''} ${entry.actor.name} ${entry.ref || ''}`.toLowerCase().includes(needle)))
  const shown = entries.slice(0, 200)

  return <div className="stack">
    <div className="toolbar">
      <label className="field compact"><span>Event</span>
        <select value={type} onChange={(event) => setType(event.target.value)}>
          <option value="all">All events</option>
          {Object.entries(TYPES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
        </select>
      </label>
      <label className="search grow"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search staff, order, reference or reason" aria-label="Search audit log" /></label>
    </div>

    <div className="table-card">
      <table className="table">
        <thead><tr><th scope="col">When</th><th scope="col">Event</th><th scope="col">Who</th>{multiBranch ? <th scope="col" className="hide-md">Branch</th> : null}<th scope="col">What</th></tr></thead>
        <tbody>{shown.map((entry) => <tr key={entry.id}>
          <td className="nowrap">{fmtWhen(entry.at, now)}</td>
          <td><Pill tone={TYPES[entry.type]?.tone}>{TYPES[entry.type]?.label || entry.type}</Pill></td>
          <td>{entry.actor.name}<span className="muted small block">{ROLE_LABEL[entry.actor.role]}</span></td>
          {multiBranch ? <td className="hide-md nowrap">{entry.branchId ? branchName(entry.branchId) : '—'}</td> : null}
          <td>
            {/^(POS|WEB)-/.test(entry.ref || '') ? <a className="link" href={`#/orders/${entry.ref}`}>{entry.summary}</a> : entry.summary}
            {entry.detail ? <span className="muted small block">“{entry.detail}”</span> : null}
          </td>
        </tr>)}</tbody>
      </table>
      {!shown.length ? <Empty title="No matching events" /> : null}
    </div>
    <p className="muted small">{entries.length > shown.length ? `Showing the latest ${shown.length} of ${entries.length}. ` : ''}The audit log is append-only. In production it is written by the server in the same transaction as the change it records.</p>
  </div>
}
