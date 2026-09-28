import { useEffect, useId, useRef, useState } from 'react'
import { formatMoney } from '../lib/money.js'
import { PAYMENT_METHOD, PAYMENT_STATE, STATUS_TONE } from './format.js'

const ICONS = {
  overview: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
  pos: 'M4 4h16v10H4zM8 18h8M12 14v4M7 8h4',
  orders: 'M6 3h12l1 4H5zM5 7h14v13H5zM9 11h6',
  inventory: 'M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10',
  payments: 'M3 6h18v12H3zM3 10h18M7 15h4',
  ledger: 'M5 3h14v18H5zM9 7h6M9 11h6M9 15h4',
  audit: 'M12 8v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L20 7',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 118 0v4',
  back: 'M15 18l-6-6 6-6',
  logout: 'M9 21H5V3h4M16 17l5-5-5-5M21 12H9',
  reset: 'M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8M3 3v5h5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3',
  menu: 'M4 6h16M4 12h16M4 18h16',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  customers: 'M16 20v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 11a4 4 0 100-8 4 4 0 000 8zM22 20v-1a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8',
  products: 'M20 7L12 3 4 7v10l8 4 8-4zM4 7l8 4 8-4M12 11v10M8 5l8 4',
  delivery: 'M1 4h14v12H1zM15 9h4l3 3v4h-7M5.5 19a2 2 0 100-4 2 2 0 000 4zM18.5 19a2 2 0 100-4 2 2 0 000 4z',
  staff: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1M17 8l2 2 3-3',
  tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01',
  help: 'M12 22a10 10 0 100-20 10 10 0 000 20zM9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01',
  printer: 'M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v7H6z',
  whatsapp: 'M3 21l1.7-5A9 9 0 1112 21a9 9 0 01-4.3-1.1zM9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 1a4 4 0 01-3-3l1-1-1-2z',
  camera: 'M3 7h4l2-3h6l2 3h4v13H3zM12 17a4 4 0 100-8 4 4 0 000 8z',
  home: 'M3 11l9-8 9 8M5 9v11h14V9',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  sale: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1',
  alertCircle: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 8v4M12 16h.01',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18',
  cart: 'M3 4h2l2.4 11h11.2L21 7H6.2M9 20a1 1 0 100-2 1 1 0 000 2zM18 20a1 1 0 100-2 1 1 0 000 2z',
}

export function Icon({ name, size = 18, className = '' }) {
  return <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={ICONS[name]} />
  </svg>
}

export function Money({ value, signed = false, className = '' }) {
  return <span className={`money ${className}`}>{formatMoney(value, { signed })}</span>
}

// Labelled figures stacked inside one stat tile.
export function MethodSplit({ rows }) {
  return <span className="split">{rows.map(([label, value]) => <span key={label}><small>{label}</small><Money value={value} /></span>)}</span>
}

export function Pill({ tone = 'grey', children, title }) {
  return <span className={`pill ${tone}`} title={title}>{children}</span>
}

export function StatusPill({ status }) {
  return <Pill tone={STATUS_TONE[status]}>{status}</Pill>
}

const METHOD_SHORT = { cash: 'Cash', momo: 'MoMo', card: 'Card' }

// Prefixed with the method so a payment state never reads like an order status ("Paid" vs "MoMo · Paid").
export function PaymentPill({ payment }) {
  const state = PAYMENT_STATE[payment.state] || { label: payment.state, tone: 'grey' }
  return <Pill tone={state.tone} title={PAYMENT_METHOD[payment.method]}>{METHOD_SHORT[payment.method]} · {state.label}</Pill>
}

// Counter (POS) and web orders must never be confused at a glance.
export function ChannelTag({ channel }) {
  return channel === 'pos'
    ? <span className="channel pos" title="Walk-in counter sale">Counter</span>
    : <span className="channel web" title="Online order">Web</span>
}

// Marks a control whose effect a trusted server must perform in production.
export function ServerNote({ contract, children }) {
  return <p className="server-note">
    <Icon name="server" size={14} />
    <span><b>Trusted server action · <code>{contract}</code></b>{children ? <> — {children}</> : null}</span>
  </p>
}

export function Stat({ label, value, sub, tone = '', onClick, href }) {
  const body = <>
    <span className="stat-label">{label}</span>
    <span className={`stat-value ${tone}`}>{value}</span>
    {sub ? <span className="stat-sub">{sub}</span> : null}
  </>
  if (href) return <a className="stat interactive" href={href}>{body}</a>
  if (onClick) return <button type="button" className="stat interactive" onClick={onClick}>{body}</button>
  return <div className="stat">{body}</div>
}

export function Empty({ title, children }) {
  return <div className="empty"><b>{title}</b>{children ? <p>{children}</p> : null}</div>
}

export function Card({ title, actions, children, className = '', flush = false }) {
  return <section className={`card ${className}`}>
    {title || actions ? <header className="card-head"><h2>{title}</h2>{actions ? <div className="card-actions">{actions}</div> : null}</header> : null}
    <div className={flush ? 'card-body flush' : 'card-body'}>{children}</div>
  </section>
}

export function Dialog({ title, onClose, children, footer, wide = false, sheet = false }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  const titleId = useId()
  closeRef.current = onClose
  // Runs once per open: parents re-render often (live store, clocks) and must not steal focus back.
  useEffect(() => {
    const previous = document.activeElement
    const node = ref.current
    const focusable = () => [...node.querySelectorAll('button, [href], input, select, textarea')].filter((element) => !element.disabled)
    ;(node.querySelector('[data-autofocus]') || focusable()[0])?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape') closeRef.current()
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0]
      const last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    node.addEventListener('keydown', onKey)
    return () => { node.removeEventListener('keydown', onKey); previous?.focus?.() }
  }, [])
  return <div className="dialog-layer">
    <button type="button" className="dialog-backdrop" aria-label="Close dialog" tabIndex={-1} onClick={onClose} />
    <div ref={ref} className={`dialog ${wide ? 'wide' : ''} ${sheet ? 'sheet' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </header>
      <div className="dialog-body">{children}</div>
      {footer ? <footer className="dialog-foot">{footer}</footer> : null}
    </div>
  </div>
}

// Destructive or audited actions always go through here: the reason is required and recorded.
export function ReasonDialog({ title, intro, confirmLabel, destructive = false, contract, presets = [], onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const valid = reason.trim().length >= 5
  const submit = async (event) => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    const ok = await onConfirm(reason.trim())
    setBusy(false)
    if (ok !== false) onClose()
  }
  return <Dialog title={title} onClose={onClose}>
    <form onSubmit={submit} className="stack">
      {intro ? <div className="dialog-intro">{intro}</div> : null}
      {presets.length ? <div className="chip-row">{presets.map((preset) => <button type="button" key={preset} className="chip" onClick={() => setReason(preset)}>{preset}</button>)}</div> : null}
      <label className="field">
        <span>Reason <em>required · recorded in the audit log</em></span>
        <textarea data-autofocus rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder="What happened, in a few words" />
      </label>
      {contract ? <ServerNote contract={contract} /> : null}
      <div className="row end">
        <button type="button" className="btn ghost" onClick={onClose}>Keep as is</button>
        <button type="submit" className={`btn ${destructive ? 'danger' : 'primary'}`} disabled={!valid || busy}>{busy ? 'Working…' : confirmLabel}</button>
      </div>
    </form>
  </Dialog>
}

export function Segmented({ value, onChange, options, label }) {
  return <div className="segmented" role="radiogroup" aria-label={label}>
    {options.map((option) => <button type="button" role="radio" aria-checked={value === option.value} key={option.value} className={value === option.value ? 'on' : ''} onClick={() => onChange(option.value)}>
      {option.label}{option.count !== undefined ? <span className="count">{option.count}</span> : null}
    </button>)}
  </div>
}
