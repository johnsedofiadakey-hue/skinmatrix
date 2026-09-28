import { useState } from 'react'
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth'
import { auth, authMessage } from '../cloud.jsx'

// One route into the private area: the authorised Firebase administrator account.
export default function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true); setMessage(null)
    try { await signInWithEmailAndPassword(auth, email.trim(), password) } catch (error) { setMessage({ tone: 'bad', text: authMessage(error) }) } finally { setBusy(false) }
  }
  const resetPassword = async () => {
    if (!email.trim()) { setMessage({ tone: 'bad', text: 'Enter your email first, then select “Forgot password?”.' }); return }
    setBusy(true); setMessage(null)
    try { await sendPasswordResetEmail(auth, email.trim()); setMessage({ tone: 'good', text: 'If this email has an account, we sent a password-reset link.' }) } catch (error) { setMessage({ tone: 'bad', text: authMessage(error) }) } finally { setBusy(false) }
  }

  return <main className="signin-clean">
    <a className="signin-back" href="/">← Back to SkinMatrix</a>
    <section className="signin-panel signin-panel--clean" aria-labelledby="admin-signin-title">
      <div className="signin-brand"><span className="brand-name">SkinMatrix</span><span className="brand-sub">Shop system</span></div>
      <div className="signin-intro"><span className="eyebrow">Secure access</span><h1 id="admin-signin-title">Welcome back.</h1><p>Sign in with your own staff email and password.</p></div>
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Email</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label className="field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {message ? <p className={message.tone === 'bad' ? 'bad-text' : 'good-text'} role="alert">{message.text}</p> : null}
        <button type="submit" className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <button type="button" className="signin-reset" onClick={resetPassword} disabled={busy}>Forgot password?</button>
    </section>
  </main>
}
