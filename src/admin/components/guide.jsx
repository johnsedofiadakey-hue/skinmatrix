import { useState } from 'react'
import { Icon } from './ui.jsx'

const key = (id) => `skinmatrix-guide-${id}`
const read = (id) => { try { return localStorage.getItem(key(id)) !== 'hidden' } catch { return true } }
const write = (id, open) => { try { localStorage.setItem(key(id), open ? 'open' : 'hidden') } catch { /* private mode */ } }

// A short "how to" box at the top of a page. Open the first time; "Got it" folds it away on this device.
export function Guide({ id, title, steps, children }) {
  const [open, setOpen] = useState(() => read(id))
  const toggle = (next) => { setOpen(next); write(id, next) }
  if (!open) return <button type="button" className="guide-toggle" onClick={() => toggle(true)}><Icon name="help" size={15} /> {title}</button>
  return <section className="guide" aria-label={title}>
    <header><Icon name="help" size={18} /><b>{title}</b></header>
    {steps ? <ol>{steps.map((step, index) => <li key={index}>{step}</li>)}</ol> : null}
    {children}
    <button type="button" className="btn ghost small" onClick={() => toggle(false)}>Got it</button>
  </section>
}
