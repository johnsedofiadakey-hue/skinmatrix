import { useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { ROLES, ROLE_ORDER } from '../lib/permissions.js'
import { Card, Dialog, Pill, ServerNote } from '../components/ui.jsx'
import { fmtWhen, ROLE_LABEL } from '../components/format.js'

const ROLE_SUMMARY = {
  staff: 'Point of sale and orders. Stock lookup. Voids, refunds, returns and discounts over 10% need a manager’s PIN.',
  manager: 'Everything staff can do, plus voids and corrections the same day, returns, any discount, stock work, deliveries, reports and the audit log. Approves staff with their PIN.',
  owner: 'Everything, including products and prices, staff accounts, and voids or returns on any day.',
}

// Owner only. Accounts are never deleted — deactivating keeps every name in the audit log.
export default function Staff() {
  const { state, staff, run } = useOps()
  const now = useNow(60000)
  const [adding, setAdding] = useState(false)
  const [resetting, setResetting] = useState(null)
  const people = [...state.staff].sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || ROLE_ORDER.indexOf(b.role) - ROLE_ORDER.indexOf(a.role))
  const activity = state.audit.filter((entry) => ['login', 'staff_added', 'staff_updated', 'approval'].includes(entry.type)).slice(0, 10)

  return <div className="stack gap-lg">
    <div className="toolbar">
      <p className="muted small grow">Each person has their own PIN, so every sale, void and approval is tied to a name. Deactivate people who leave; accounts are never deleted.</p>
      <button type="button" className="btn primary small" onClick={() => setAdding(true)}>Add staff member</button>
    </div>
    <div className="table-card">
      <table className="table">
        <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col" className="hide-md">Last signed in</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{people.map((member) => {
          const self = member.id === staff.id
          const active = member.active !== false
          return <tr key={member.id} className={active ? '' : 'row-muted'}>
            <td><b>{member.name}</b>{self ? <span className="muted small"> · you</span> : null}{member.phone ? <span className="muted small block">{member.phone}</span> : null}</td>
            <td>{self ? ROLE_LABEL[member.role] : <select className="inline-select" aria-label={`Role for ${member.name}`} value={member.role} disabled={!active}
              onChange={(event) => run((store) => store.updateStaff(staff, { staffId: member.id, role: event.target.value }), `${member.name} is now ${ROLES[event.target.value].label}.`)}>
              {ROLE_ORDER.map((role) => <option key={role} value={role}>{ROLES[role].label}</option>)}
            </select>}</td>
            <td>{active ? <Pill tone="green">Active</Pill> : <Pill tone="grey">Deactivated</Pill>}</td>
            <td className="hide-md nowrap">{member.lastActiveAt ? fmtWhen(member.lastActiveAt, now) : 'Never'}</td>
            <td className="num nowrap">{self ? null : <>
              <button type="button" className="btn ghost small" onClick={() => setResetting(member)} disabled={!active}>Reset PIN</button>
              <button type="button" className={`btn small ${active ? 'danger-outline' : 'secondary'}`} onClick={() => run((store) => store.updateStaff(staff, { staffId: member.id, active: !active }), `${member.name} ${active ? 'deactivated' : 'reactivated'}.`)}>{active ? 'Deactivate' : 'Reactivate'}</button>
            </>}</td>
          </tr>
        })}</tbody>
      </table>
    </div>

    <div className="grid-2">
      <Card title="What each role can do">
        <dl className="role-list">
          {ROLE_ORDER.map((role) => <div key={role}><dt>{ROLES[role].label}</dt><dd className="small">{ROLE_SUMMARY[role]}</dd></div>)}
        </dl>
      </Card>
      <Card title="Recent staff activity" flush>
        <ul className="list">{activity.map((entry) => <li key={entry.id} className="list-row static"><span className="list-main"><span className="small">{entry.summary}</span><span className="muted small">{fmtWhen(entry.at, now)}</span></span></li>)}</ul>
      </Card>
    </div>
    <ServerNote contract="createStaffAccount / updateStaffAccount">creates the sign-in and sets role claims; the owner can't lock themselves out and there is always an active owner</ServerNote>

    {adding ? <AddStaffDialog onClose={() => setAdding(false)} /> : null}
    {resetting ? <ResetPinDialog member={resetting} onClose={() => setResetting(null)} /> : null}
  </div>
}

function AddStaffDialog({ onClose }) {
  const { staff, run } = useOps()
  const [form, setForm] = useState({ name: '', phone: '', role: 'staff', pin: '' })
  const set = (field) => (event) => setForm({ ...form, [field]: field === 'pin' ? event.target.value.replace(/\D/g, '').slice(0, 6) : event.target.value })
  const valid = form.name.trim().length >= 2 && /^\d{4,6}$/.test(form.pin)
  const submit = async (event) => {
    event.preventDefault()
    if (!valid) return
    if (await run((store) => store.createStaff(staff, form), `${form.name.trim()} added. Give them their PIN in person.`)) onClose()
  }
  return <Dialog title="Add staff member" onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <div className="field-row">
        <label className="field"><span>Name</span><input data-autofocus value={form.name} onChange={set('name')} /></label>
        <label className="field"><span>Phone <em>optional</em></span><input inputMode="tel" value={form.phone} onChange={set('phone')} /></label>
      </div>
      <fieldset className="role-options">
        <legend>Role</legend>
        {ROLE_ORDER.map((role) => <label key={role} className={`branch-option ${form.role === role ? 'on' : ''}`}>
          <input type="radio" name="role" checked={form.role === role} onChange={() => setForm({ ...form, role })} />
          <span><b>{ROLES[role].label}</b><span className="muted small block">{ROLE_SUMMARY[role]}</span></span>
        </label>)}
      </fieldset>
      <label className="field"><span>Starting PIN (4–6 digits) <em>they can change it after signing in</em></span><input type="password" inputMode="numeric" value={form.pin} onChange={set('pin')} /></label>
      <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={!valid}>Add staff member</button></div>
    </form>
  </Dialog>
}

function ResetPinDialog({ member, onClose }) {
  const { staff, run } = useOps()
  const [pin, setPin] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    if (!/^\d{4,6}$/.test(pin)) return
    if (await run((store) => store.setStaffPin(staff, { staffId: member.id, pin }), `${member.name}’s PIN has been reset.`)) onClose()
  }
  return <Dialog title={`Reset PIN for ${member.name}`} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <label className="field"><span>New PIN (4–6 digits)</span><input data-autofocus type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
      <p className="muted small">Tell them the new PIN in person and ask them to change it from “My PIN”.</p>
      <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={!/^\d{4,6}$/.test(pin)}>Reset PIN</button></div>
    </form>
  </Dialog>
}
