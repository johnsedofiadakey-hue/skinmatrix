import { useState } from 'react'
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth'
import { auth, authMessage } from '../cloud.jsx'
import { signInEmail } from '../../../functions/src/core/rules.js'

// Staff sign in with their username and password. The owner can still type their email.
export default function SignIn() {
  const [login, setLogin] = useState('')
  const [show, setShow] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true); setMessage(null)
    try { await signInWithEmailAndPassword(auth, signInEmail(login), password) } catch (error) { setMessage({ tone: 'bad', text: signInProblem(error, login) }) } finally { setBusy(false) }
  }
  // Only an email account can get a reset link; staff ask the owner for a new password.
  const resetPassword = async () => {
    if (!login.includes('@')) { setMessage({ tone: 'bad', text: 'Ask the owner to set a new password for you (Team → your name → New password).' }); return }
    setBusy(true); setMessage(null)
    try { await sendPasswordResetEmail(auth, login.trim()); setMessage({ tone: 'good', text: 'If this email has an account, we sent a password-reset link.' }) } catch (error) { setMessage({ tone: 'bad', text: authMessage(error) }) } finally { setBusy(false) }
  }

  return <main className="signin-clean">
    <a className="signin-back" href="/">← Back to SkinMatrix</a>
    <section className="signin-panel signin-panel--clean" aria-labelledby="admin-signin-title">
      <div className="signin-brand"><span className="brand-name">SkinMatrix</span><span className="brand-sub">Shop system</span></div>
      <div className="signin-intro"><span className="eyebrow">Shop system</span><h1 id="admin-signin-title">Welcome back.</h1><p>Sign in with your username and password.</p></div>
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Username</span><input className="signin-input" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="e.g. ama" value={login} onChange={(event) => setLogin(event.target.value)} required autoFocus /></label>
        <label className="field"><span>Password</span>
          <span className="signin-password"><input className="signin-input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button></span>
        </label>
        {message ? <p className={message.tone === 'bad' ? 'bad-text' : 'good-text'} role="alert">{message.text}</p> : null}
        <button type="submit" className="btn primary block large" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <button type="button" className="signin-reset" onClick={resetPassword} disabled={busy}>Forgot password?</button>
    </section>
  </main>
}

// Plain words for the usual sign-in mistakes.
function signInProblem(error, login) {
  const code = error?.code || ''
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(code)) return login.includes('@') ? 'That email or password is not right.' : 'That username or password is not right. Check the spelling, or ask the owner to set a new password.'
  if (code === 'auth/user-disabled') return 'This account is turned off. Ask the owner.'
  if (code === 'auth/network-request-failed') return 'No internet. Signing in needs the internet; try again when it is back.'
  if (code === 'auth/too-many-requests') return 'Too many tries. Wait a minute, then try again.'
  return authMessage(error)
}
