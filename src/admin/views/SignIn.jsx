import { useState } from 'react'
import { useOps } from '../hooks.js'
import { Icon, Pill } from '../components/ui.jsx'
import { PinDialog } from '../components/pin.jsx'
import { ROLE_LABEL } from '../components/format.js'

// Sign-in UI. Production: Firebase Auth (email + password for the owner and managers; a personal PIN on the shared
// till) issues an ID token whose custom claims carry the role; every server command verifies it.
// In this prototype the demo server checks the PIN against a stored hash.
export default function SignIn() {
  const { state, signIn } = useOps()
  const [notice, setNotice] = useState(false)
  const [chosen, setChosen] = useState(null)
  const people = [...state.staff].sort((a, b) => Number(b.active !== false) - Number(a.active !== false))

  return <div className="signin">
    <section className="signin-panel">
      <div className="signin-brand">
        <span className="brand-name">SkinMatrix</span>
        <span className="brand-sub">Shop operations</span>
      </div>
      <h1>Sign in</h1>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); setNotice(true) }}>
        <label className="field"><span>Work email</span><input type="email" autoComplete="off" placeholder="name@skinmatrix.example" /></label>
        <label className="field"><span>Password</span><input type="password" autoComplete="off" placeholder="••••••••" /></label>
        <button type="submit" className="btn primary block">Sign in</button>
      </form>
      {notice ? <div className="callout warn" role="alert">
        <Icon name="alert" />
        <p><b>Email sign-in is not connected in this prototype.</b> In production Firebase Auth verifies identity and the role comes from server-issued claims. Use a staff PIN below.</p>
      </div> : null}
    </section>

    <section className="signin-personas" aria-labelledby="personas-title">
      <h2 id="personas-title">Who's at the till? <Pill tone="amber">Demo staff</Pill></h2>
      <p className="muted">Choose your name and enter your PIN. Staff can sell and handle orders; voids, refunds and big discounts need a manager's PIN.</p>
      <ul className="persona-list">
        {people.map((member) => {
          const active = member.active !== false
          return <li key={member.id}>
            <button type="button" className="persona" disabled={!active} onClick={() => setChosen(member.id)}>
              <span className="avatar" aria-hidden="true">{member.name.slice(0, 1)}</span>
              <span className="persona-meta">
                <b>{member.name}</b>
                <span>{ROLE_LABEL[member.role]}{active ? '' : ' · deactivated'}</span>
              </span>
              <span className="persona-go">{active ? 'Enter PIN →' : ''}</span>
            </button>
          </li>
        })}
      </ul>
    </section>
    {chosen ? <PinDialog title="Enter your PIN" staff={state.staff} initialId={chosen} onClose={() => setChosen(null)} onSubmit={async (staffId, pin) => { if (await signIn(staffId, pin)) setChosen(null) }} /> : null}
  </div>
}
