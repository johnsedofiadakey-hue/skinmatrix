import { useState } from 'react'
import { Dialog } from './ui.jsx'
import { ROLE_LABEL } from '../../../functions/src/core/rules.js'

// A manager or the owner approves on the cashier's screen by typing their own PIN. The PIN goes straight to
// the server, which checks it (five wrong tries lock that approver for 15 minutes).
export function ApprovalDialog({ message, error, approvers, onDone }) {
  const ready = approvers.filter((member) => member.hasPin)
  const [approverId, setApproverId] = useState(ready[0]?.uid)
  const [pin, setPin] = useState('')
  const submit = (event) => {
    event.preventDefault()
    if (pin.length >= 4 && approverId) onDone({ approverId, pin })
  }
  return <Dialog title="Manager approval needed" onClose={() => onDone(null)}>
    <form className="stack" onSubmit={submit}>
      <p className="callout warn">{message}</p>
      {error ? <p className="bad-text" role="alert">{error}</p> : null}
      {ready.length ? <>
        <div className="people" role="radiogroup" aria-label="Who is approving">
          {ready.map((member) => <label key={member.uid} className={`person ${approverId === member.uid ? 'on' : ''}`}>
            <input type="radio" name="approver" checked={approverId === member.uid} onChange={() => { setApproverId(member.uid); setPin('') }} />
            <span className="avatar" aria-hidden="true">{member.name.slice(0, 1)}</span>
            <span><b>{member.name}</b><span className="muted small block">{ROLE_LABEL[member.role]}</span></span>
          </label>)}
        </div>
        <label className="field">
          <span>Their approval PIN</span>
          <input className="big-input pin-input" data-autofocus type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} />
        </label>
        <p className="muted small">The manager types their own PIN. It is recorded that they approved this.</p>
        <div className="row end">
          <button type="button" className="btn ghost" onClick={() => onDone(null)}>Cancel</button>
          <button type="submit" className="btn primary" disabled={pin.length < 4}>Approve</button>
        </div>
      </> : <p className="small">No manager or owner has set an approval PIN yet. They can set one in <b>Account</b> (under More on a phone).</p>}
    </form>
  </Dialog>
}
