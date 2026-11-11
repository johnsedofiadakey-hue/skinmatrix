import { useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { cleanUsername, isValidUsername, MIN_PASSWORD, ROLE_LABEL, ROLES, usernameOf } from '../../../functions/src/core/rules.js'
import { Dialog, Empty, Icon, Pill, Segmented } from '../components/ui.jsx'
import { Guide } from '../components/guide.jsx'
import { fmtWhen } from '../components/format.js'

const ROLE_HELP = {
  staff: 'Sells at the till, looks up stock, handles website orders. Discounts up to 10%. Needs a manager PIN for refunds and cancellations.',
  manager: 'Everything staff can do, plus approving with a PIN, refunds, deliveries, stock changes and reports.',
  owner: 'Everything, plus products, the website and the team.',
}

export default function Team() {
  const { staffList, me } = useOps()
  const now = useNow(60000)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const sorted = [...staffList].sort((a, b) => (a.active === false) - (b.active === false) || ROLES.indexOf(b.role) - ROLES.indexOf(a.role) || a.name.localeCompare(b.name))
  const editingMember = staffList.find((member) => member.uid === editing)

  return <div className="stack">
    <Guide id="team" title="Adding someone to the team" steps={[
      'Press Add a person. Type their name, a username (e.g. ama) and a password, and choose a role.',
      'Tell them the username and password in person. They sign in with just those two.',
      'Forgot a password? Tap their name here and set a new one.',
      'Managers must set an approval PIN in Account before they can approve refunds at the till.',
      'When someone leaves, turn them off. They are signed out everywhere straight away. Their past sales stay in the records.',
    ]} />
    <button type="button" className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add a person</button>
    {sorted.length ? <ul className="card-list">{sorted.map((member) => <li key={member.uid}>
      <button type="button" className="sale-row" disabled={member.uid === me.uid} onClick={() => setEditing(member.uid)}>
        <span className="sale-row-main">
          <b>{member.name}{member.uid === me.uid ? ' (you)' : ''}</b>
          <span className="muted small">{loginLabel(member)} · {member.lastActiveAt ? `last signed in ${fmtWhen(member.lastActiveAt, now)}` : 'has not signed in yet'}</span>
        </span>
        <span className="sale-row-side">
          <Pill tone={member.role === 'owner' ? 'violet' : member.role === 'manager' ? 'blue' : 'grey'}>{ROLE_LABEL[member.role]}</Pill>
          {member.active === false ? <Pill tone="red">Turned off</Pill> : ['manager', 'owner'].includes(member.role) && !member.hasPin ? <Pill tone="amber">No PIN yet</Pill> : null}
        </span>
      </button>
    </li>)}</ul> : <Empty title="No one yet" />}
    {adding ? <AddDialog onClose={() => setAdding(false)} /> : null}
    {editingMember ? <EditDialog member={editingMember} onClose={() => setEditing(null)} /> : null}
  </div>
}

function RolePicker({ value, onChange }) {
  return <div className="field"><span>Role</span>
    <Segmented label="Role" value={value} onChange={onChange} options={ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role] }))} />
    <p className="muted small">{ROLE_HELP[value]}</p>
  </div>
}

const loginLabel = (member) => (member.username || usernameOf(member.email) ? `username ${member.username || usernameOf(member.email)}` : member.email)

function AddDialog({ onClose }) {
  const { call } = useOps()
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'staff' })
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null)
  const [show, setShow] = useState(true)
  const suggest = (name) => cleanUsername(name.split(/\s+/)[0] || '').replace(/[^a-z0-9._-]/g, '')
  const usernameOk = isValidUsername(form.username)
  const valid = form.name.trim().length >= 2 && usernameOk && form.password.length >= MIN_PASSWORD
  const submit = async (event) => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    const result = await call('createStaff', { name: form.name, username: form.username, password: form.password, role: form.role }, { success: `${form.name} added.` })
    setBusy(false)
    if (result) setCreated(result)
  }

  if (created) return <Dialog title="Account ready" onClose={onClose}>
    <div className="stack">
      <p><b>{form.name}</b> signs in with:</p>
      <div className="secret-box">
        <span className="muted small">Username</span><b>{cleanUsername(form.username)}</b>
        <span className="muted small">Password</span><b className="mono">the password you just typed</b>
      </div>
      <p className="muted small">Tell them in person. If they forget it, tap their name in Team and set a new one.</p>
      <button type="button" className="btn primary block large" onClick={onClose}>Done</button>
    </div>
  </Dialog>

  return <Dialog title="Add a person" onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <label className="field"><span>Name</span><input data-autofocus value={form.name} autoComplete="off"
        onChange={(event) => setForm({ ...form, name: event.target.value, username: form.username && form.username !== suggest(form.name) ? form.username : suggest(event.target.value) })} /></label>
      <label className={`field ${form.username && !usernameOk ? 'invalid' : ''}`}><span>Username <em className="muted">what they type to sign in</em></span>
        <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase().replace(/\s/g, '') })} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="e.g. ama" />
        {form.username && !usernameOk ? <small className="bad-text">2 to 24 letters or numbers, starting with a letter.</small> : null}
      </label>
      <label className="field"><span>Password <em className="muted">at least {MIN_PASSWORD} characters</em></span>
        <span className="signin-password"><input type={show ? 'text' : 'password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" spellCheck={false} />
          <button type="button" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button></span>
      </label>
      <RolePicker value={form.role} onChange={(role) => setForm({ ...form, role })} />
      <button type="submit" className="btn primary block large" disabled={!valid || busy}>{busy ? 'Creating…' : 'Create account'}</button>
    </form>
  </Dialog>
}

// Username and password, set by the owner. A new password signs them out everywhere.
function LoginEditor({ member, onDone }) {
  const { call } = useOps()
  const current = member.username || usernameOf(member.email) || ''
  const [username, setUsername] = useState(current)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const changedName = cleanUsername(username) !== current
  const valid = (changedName ? isValidUsername(username) : true) && (password === '' || password.length >= MIN_PASSWORD) && (changedName || password)
  const save = async (event) => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    const result = await call('setStaffLogin', { uid: member.uid, ...(changedName ? { username } : {}), ...(password ? { password } : {}) }, { success: password ? `Saved. Give ${member.name} the new password.` : 'Username saved.' })
    setBusy(false)
    if (result) { setPassword(''); onDone?.() }
  }
  return <form className="stack" onSubmit={save}>
    <b>Sign-in</b>
    <label className="field"><span>Username</span><input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/\s/g, ''))} autoCapitalize="none" spellCheck={false} placeholder="e.g. ama" /></label>
    <label className="field"><span>New password <em className="muted">leave empty to keep the old one</em></span><input type="text" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" spellCheck={false} /></label>
    {!current ? <p className="small warn-text">They still sign in with {member.email}. Give them a username so signing in is simpler.</p> : null}
    <button type="submit" className="btn secondary" disabled={!valid || busy}>{busy ? 'Saving…' : 'Save sign-in'}</button>
  </form>
}

function EditDialog({ member, onClose }) {
  const { call } = useOps()
  const [role, setRole] = useState(member.role)
  const [busy, setBusy] = useState(false)
  const save = async (changes, success) => {
    setBusy(true)
    const result = await call('updateStaff', { uid: member.uid, ...changes }, { success })
    setBusy(false)
    if (result) onClose()
  }
  return <Dialog title={member.name} onClose={onClose}>
    <div className="stack">
      <p className="muted">{loginLabel(member)}</p>
      {member.active === false ? <>
        <p>This account is turned off. They cannot sign in.</p>
        <button type="button" className="btn primary" disabled={busy} onClick={() => save({ active: true }, `${member.name} can sign in again.`)}>Turn back on</button>
      </> : <>
        <RolePicker value={role} onChange={setRole} />
        <button type="button" className="btn primary" disabled={busy || role === member.role} onClick={() => save({ role }, `${member.name} is now ${ROLE_LABEL[role]}.`)}>Save role</button>
        <hr />
        <LoginEditor member={member} />
        <hr />
        <p className="small muted">Leaving the shop? Turning the account off signs them out on every device. Their past sales stay in the records.</p>
        <button type="button" className="btn danger-outline" disabled={busy} onClick={() => save({ active: false }, `${member.name} was turned off.`)}>Turn off this account</button>
      </>}
    </div>
  </Dialog>
}
