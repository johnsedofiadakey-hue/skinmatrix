import { useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { ROLE_LABEL, ROLES } from '../../../functions/src/core/rules.js'
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
      'Press Add a person. Type their name and the email they will sign in with, and choose a role.',
      'You get a temporary password once. Give it to them in person or by WhatsApp.',
      'They sign in at this address, then change the password from Account → Change my password.',
      'Managers must set an approval PIN in Account before they can approve refunds at the till.',
      'When someone leaves, turn them off. They are signed out everywhere straight away. Their past sales stay in the records.',
    ]} />
    <button type="button" className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add a person</button>
    {sorted.length ? <ul className="card-list">{sorted.map((member) => <li key={member.uid}>
      <button type="button" className="sale-row" disabled={member.uid === me.uid} onClick={() => setEditing(member.uid)}>
        <span className="sale-row-main">
          <b>{member.name}{member.uid === me.uid ? ' (you)' : ''}</b>
          <span className="muted small">{member.email} · {member.lastActiveAt ? `last signed in ${fmtWhen(member.lastActiveAt, now)}` : 'has not signed in yet'}</span>
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

function AddDialog({ onClose }) {
  const { call } = useOps()
  const [form, setForm] = useState({ name: '', email: '', role: 'staff' })
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null)
  const [copied, setCopied] = useState(false)
  const valid = form.name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
  const submit = async (event) => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    const result = await call('createStaff', form, { success: `${form.name} added.` })
    setBusy(false)
    if (result) setCreated(result)
  }
  const signInAddress = `${window.location.origin}/admin/`
  const message = created ? `Hi ${form.name}, your SkinMatrix staff account is ready.\nSign in at: ${signInAddress}\nEmail: ${form.email.trim().toLowerCase()}\nTemporary password: ${created.password}\nPlease change the password after you sign in (Account → Change my password).` : ''
  const copy = async () => { try { await navigator.clipboard.writeText(message); setCopied(true) } catch { setCopied(false) } }

  if (created) return <Dialog title="Account created" onClose={onClose}>
    <div className="stack">
      <p>Give these details to <b>{form.name}</b>. <b>The password is only shown now.</b></p>
      <div className="secret-box">
        <span className="muted small">Email</span><b>{form.email.trim().toLowerCase()}</b>
        <span className="muted small">Temporary password</span><b className="mono">{created.password}</b>
      </div>
      <div className="button-grid">
        <button type="button" className="btn secondary" onClick={copy}><Icon name="check" size={16} /> {copied ? 'Copied' : 'Copy message'}</button>
        <a className="btn secondary" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={16} /> Send on WhatsApp</a>
      </div>
      <button type="button" className="btn primary block" onClick={onClose}>Done</button>
    </div>
  </Dialog>

  return <Dialog title="Add a person" onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <label className="field"><span>Name</span><input data-autofocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoComplete="off" /></label>
      <label className="field"><span>Email they will sign in with</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="off" /></label>
      <RolePicker value={form.role} onChange={(role) => setForm({ ...form, role })} />
      <button type="submit" className="btn primary block" disabled={!valid || busy}>{busy ? 'Creating…' : 'Create account'}</button>
    </form>
  </Dialog>
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
      <p className="muted">{member.email}</p>
      {member.active === false ? <>
        <p>This account is turned off. They cannot sign in.</p>
        <button type="button" className="btn primary" disabled={busy} onClick={() => save({ active: true }, `${member.name} can sign in again.`)}>Turn back on</button>
      </> : <>
        <RolePicker value={role} onChange={setRole} />
        <button type="button" className="btn primary" disabled={busy || role === member.role} onClick={() => save({ role }, `${member.name} is now ${ROLE_LABEL[role]}.`)}>Save role</button>
        <hr />
        <p className="small muted">Leaving the shop? Turning the account off signs them out on every device. Their past sales stay in the records.</p>
        <button type="button" className="btn danger-outline" disabled={busy} onClick={() => save({ active: false }, `${member.name} was turned off.`)}>Turn off this account</button>
      </>}
      <p className="small muted">Forgot their password? They can press “Forgot password?” on the sign-in page.</p>
    </div>
  </Dialog>
}
