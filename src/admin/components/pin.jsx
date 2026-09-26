import { useState } from 'react'
import { can } from '../lib/permissions.js'
import { DEMO_PINS } from '../demo/seed.js'
import { Dialog, Pill } from './ui.jsx'
import { ROLE_LABEL } from './format.js'

// PIN entry for a shared till. The PIN goes to the (demo) server, which checks it; the screen never compares PINs.

function PinField({ value, onChange }) {
  return <label className="field">
    <span>PIN</span>
    <input className="big-input pin-input" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={value} onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))} />
  </label>
}

function DemoPinHint({ member }) {
  return DEMO_PINS[member.id] ? <span className="demo-pin">Demo PIN {DEMO_PINS[member.id]}</span> : null
}

// Choose who you are and enter your PIN (sign-in on the till, and "Switch user").
export function PinDialog({ title, staff, onSubmit, onClose, initialId = null }) {
  const people = staff.filter((member) => member.active !== false)
  const [staffId, setStaffId] = useState(initialId || people[0]?.id)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    if (pin.length < 4 || busy) return
    setBusy(true)
    await onSubmit(staffId, pin)
    setBusy(false)
    setPin('')
  }
  return <Dialog title={title} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <div className="people" role="radiogroup" aria-label="Who is signing in">
        {people.map((member) => <label key={member.id} className={`person ${staffId === member.id ? 'on' : ''}`}>
          <input type="radio" name="person" checked={staffId === member.id} onChange={() => { setStaffId(member.id); setPin('') }} />
          <span className="avatar" aria-hidden="true">{member.name.slice(0, 1)}</span>
          <span><b>{member.name}</b><span className="muted small block">{ROLE_LABEL[member.role]}</span></span>
          <DemoPinHint member={member} />
        </label>)}
      </div>
      <PinField value={pin} onChange={setPin} />
      <button type="submit" className="btn primary block large" disabled={pin.length < 4 || busy}>{busy ? 'Checking…' : 'Sign in'}</button>
    </form>
  </Dialog>
}

// A manager or the owner approves an action for the person signed in, without taking over the session.
export function ApprovalDialog({ message, staff, currentId, onDone }) {
  const approvers = staff.filter((member) => member.active !== false && member.id !== currentId && can(member, 'approve'))
  const [approverId, setApproverId] = useState(approvers[0]?.id)
  const [pin, setPin] = useState('')
  const submit = (event) => {
    event.preventDefault()
    if (pin.length >= 4 && approverId) onDone({ approverId, pin })
  }
  return <Dialog title="Manager approval" onClose={() => onDone(null)}>
    <form className="stack" onSubmit={submit}>
      <div className="callout warn"><p>{message}</p></div>
      {approvers.length ? <>
        <div className="people" role="radiogroup" aria-label="Who is approving">
          {approvers.map((member) => <label key={member.id} className={`person ${approverId === member.id ? 'on' : ''}`}>
            <input type="radio" name="approver" checked={approverId === member.id} onChange={() => { setApproverId(member.id); setPin('') }} />
            <span className="avatar" aria-hidden="true">{member.name.slice(0, 1)}</span>
            <span><b>{member.name}</b><span className="muted small block">{ROLE_LABEL[member.role]}</span></span>
            <DemoPinHint member={member} />
          </label>)}
        </div>
        <PinField value={pin} onChange={setPin} />
        <p className="muted small">The approval is recorded under the approver's name, together with yours. <Pill tone="amber">Demo</Pill> PINs are checked by the demo server only.</p>
        <div className="row end">
          <button type="button" className="btn ghost" onClick={() => onDone(null)}>Cancel</button>
          <button type="submit" className="btn primary" disabled={pin.length < 4}>Approve</button>
        </div>
      </> : <p className="small">No manager or owner account is active to approve this.</p>}
    </form>
  </Dialog>
}
