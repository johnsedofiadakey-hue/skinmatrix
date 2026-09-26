// Real Firebase sign-in for the parts of the admin that change the live website (content editor, website orders).
// The rest of the admin is still the demo; its staff PINs are not used here.
import { useEffect, useState } from 'react'
import { getAuth, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore/lite'
import { app, db } from '../cloud/firebase.js'
import { Card, Icon } from './components/ui.jsx'

export const auth = getAuth(app)

const AUTH_MESSAGES = {
  'auth/invalid-credential': 'The email or password is not right.',
  'auth/invalid-email': 'This email does not look right.',
  'auth/too-many-requests': 'Too many tries. Wait a few minutes, then try again.',
  'auth/network-request-failed': 'No internet connection. Check it and try again.',
  'auth/user-disabled': 'This account has been turned off.',
}
export const authMessage = (error) => AUTH_MESSAGES[error?.code] || 'Something went wrong. Please try again.'

// status: loading | signedOut | notEditor | editor
export function useEditor() {
  const [state, setState] = useState({ status: 'loading', user: null })
  useEffect(() => onAuthStateChanged(auth, async (user) => {
    if (!user) { setState({ status: 'signedOut', user: null }); return }
    try {
      const snap = await getDoc(doc(db, 'admins', user.uid))
      setState({ status: snap.exists() ? 'editor' : 'notEditor', user })
    } catch {
      setState({ status: 'notEditor', user })
    }
  }), [])
  return state
}

function SignInCard({ purpose }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true); setMessage(null)
    try { await signInWithEmailAndPassword(auth, email.trim(), password) } catch (error) { setMessage({ tone: 'bad', text: authMessage(error) }) }
    setBusy(false)
  }
  const reset = async () => {
    if (!email.trim()) { setMessage({ tone: 'bad', text: 'Type your email first, then press "Forgot password".' }); return }
    try { await sendPasswordResetEmail(auth, email.trim()); setMessage({ tone: 'good', text: 'If this email has an account, we sent a link to set a new password.' }) } catch (error) { setMessage({ tone: 'bad', text: authMessage(error) }) }
  }
  return <Card title="Sign in to edit the website">
    <form className="stack cloud-signin" onSubmit={submit}>
      <p className="muted">{purpose} This uses your owner email and password, not the till PIN.</p>
      <label className="field"><span>Email</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label className="field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      {message ? <p className={message.tone === 'bad' ? 'bad-text' : 'good-text'} role="alert">{message.text}</p> : null}
      <div className="row">
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="btn ghost" onClick={reset}>Forgot password</button>
      </div>
    </form>
  </Card>
}

// Wraps a page that needs a real editor account.
export function EditorGate({ purpose, children }) {
  const editor = useEditor()
  if (editor.status === 'loading') return <p className="muted">Checking your sign-in…</p>
  if (editor.status === 'signedOut') return <SignInCard purpose={purpose} />
  if (editor.status === 'notEditor') return <Card title="This account cannot edit yet">
    <div className="stack">
      <p>You are signed in as <b>{editor.user.email}</b>, but this account is not on the list of website editors.</p>
      <p className="muted">Ask the developer to add it. They need this account ID: <code className="mono">{editor.user.uid}</code></p>
      <div className="row"><button type="button" className="btn ghost" onClick={() => signOut(auth)}><Icon name="logout" size={16} /> Sign out</button></div>
    </div>
  </Card>
  return <>
    <div className="cloud-bar"><span><Icon name="lock" size={14} /> Signed in as <b>{editor.user.email}</b>. Changes here go live on the website.</span><button type="button" className="link-button" onClick={() => signOut(auth)}>Sign out</button></div>
    {children(editor.user)}
  </>
}
