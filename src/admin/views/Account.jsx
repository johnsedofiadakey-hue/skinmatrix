import { useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { useOps } from '../hooks.js'
import { authMessage } from '../cloud.jsx'
import { ROLE_LABEL } from '../../../functions/src/core/rules.js'
import { Card, Icon } from '../components/ui.jsx'
import { autoPrintEnabled, setAutoPrint } from '../components/receipt.jsx'

export default function Account() {
  const { me, user, can, signOut } = useOps()
  const [autoPrint, setAutoPrintState] = useState(autoPrintEnabled)
  return <div className="stack narrow">
    <Card title="Me">
      <div className="stack">
        <p><b>{me.name}</b><span className="muted block">{user.email} · {ROLE_LABEL[me.role]}</span></p>
        <button type="button" className="btn ghost" onClick={signOut}><Icon name="logout" size={16} /> Sign out</button>
        <p className="muted small">On a shared shop computer, always sign out at the end of your shift.</p>
      </div>
    </Card>
    <PasswordCard />
    {can('approve') ? <PinCard /> : null}
    <Card title="This device">
      <label className="check"><input type="checkbox" checked={autoPrint} onChange={(event) => { setAutoPrint(event.target.checked); setAutoPrintState(event.target.checked) }} /> Print the receipt automatically after every sale</label>
      <p className="muted small">See Help → Receipt printer to stop the print window asking every time.</p>
    </Card>
  </div>
}

function PasswordCard() {
  const { user, toast } = useOps()
  const [form, setForm] = useState({ current: '', next: '', repeat: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const valid = form.current && form.next.length >= 8 && form.next === form.repeat
  const submit = async (event) => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true); setError('')
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, form.current))
      await updatePassword(user, form.next)
      setForm({ current: '', next: '', repeat: '' })
      toast('Password changed.')
    } catch (cause) {
      setError(cause?.code === 'auth/invalid-credential' || cause?.code === 'auth/wrong-password' ? 'Your current password is not right.' : authMessage(cause))
    } finally { setBusy(false) }
  }
  return <Card title="Change my password">
    <form className="stack" onSubmit={submit}>
      <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={form.current} onChange={(event) => setForm({ ...form, current: event.target.value })} /></label>
      <div className="field-row">
        <label className="field"><span>New password <em>at least 8 characters</em></span><input type="password" autoComplete="new-password" value={form.next} onChange={(event) => setForm({ ...form, next: event.target.value })} /></label>
        <label className="field"><span>Type it again</span><input type="password" autoComplete="new-password" value={form.repeat} onChange={(event) => setForm({ ...form, repeat: event.target.value })} /></label>
      </div>
      {form.repeat && form.next !== form.repeat ? <p className="bad-text small">The two new passwords don’t match.</p> : null}
      {error ? <p className="bad-text small" role="alert">{error}</p> : null}
      <button type="submit" className="btn primary" disabled={!valid || busy}>{busy ? 'Saving…' : 'Change password'}</button>
    </form>
  </Card>
}

function PinCard() {
  const { me, call } = useOps()
  const [pin, setPin] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const valid = /^\d{4,6}$/.test(pin) && pin === repeat
  const submit = async (event) => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    const result = await call('setMyPin', { pin }, { success: 'Approval PIN saved.' })
    setBusy(false)
    if (result) { setPin(''); setRepeat('') }
  }
  return <Card title={me.hasPin ? 'Change my approval PIN' : 'Set my approval PIN'}>
    <form className="stack" onSubmit={submit}>
      <p className="muted small">When staff need approval at the till (refund, cancelled sale, big discount), you choose your name and type this PIN on their screen. Keep it secret. Five wrong tries lock it for 15 minutes.</p>
      {!me.hasPin ? <p className="callout warn">You have no PIN yet, so you cannot approve anything at the till.</p> : null}
      <div className="field-row">
        <label className="field"><span>PIN (4–6 digits)</span><input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
        <label className="field"><span>Type it again</span><input type="password" inputMode="numeric" autoComplete="off" value={repeat} onChange={(event) => setRepeat(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
      </div>
      {repeat && pin !== repeat ? <p className="bad-text small">The two PINs don’t match.</p> : null}
      <button type="submit" className="btn primary" disabled={!valid || busy}>{busy ? 'Saving…' : 'Save PIN'}</button>
    </form>
  </Card>
}
