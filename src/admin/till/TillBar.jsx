import { useState } from 'react'
import { useOps } from '../hooks.js'
import { Dialog, Icon } from '../components/ui.jsx'
import { canOpenDrawer, directPrinting, openDrawer, printerProblem, useTill } from './device.js'
import { openCustomerDisplay } from './display.js'

const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`

// The strip above the POS: customer screen, open the drawer without a sale, and this till's printer status.
export function TillBar() {
  const { toast } = useOps()
  const till = useTill()
  const [noSale, setNoSale] = useState(false)
  const direct = directPrinting(till)

  const showDisplay = async () => {
    const result = await openCustomerDisplay()
    if (result === 'blocked') toast('The browser blocked the customer screen. Allow pop-ups for this site, then press again.', 'error')
    else if (result === 'window') toast('Customer screen opened. Drag it onto the customer’s monitor, then tap it for full screen.')
  }

  return <div className="till-bar" role="toolbar" aria-label="Till">
    <span className={`till-status ${direct ? 'good' : ''}`} title={direct ? 'Receipts print straight to the printer' : 'Receipts print through the print window'}>
      <Icon name="printer" size={15} /> {direct ? (till.printer === 'network' ? `Printer ${till.host}` : till.printerName) : 'Print window'}
    </span>
    <span className="till-bar-actions">
      {till.display ? <button type="button" className="btn ghost small" onClick={showDisplay}><Icon name="screen" size={16} /> Customer screen</button> : null}
      <button type="button" className="btn ghost small" onClick={() => setNoSale(true)}><Icon name="drawer" size={16} /> Open drawer</button>
      <a className="btn ghost small icon-only" href="#/till" aria-label="Till setup" title="Till setup"><Icon name="settings" size={16} /></a>
    </span>
    {noSale ? <NoSaleDialog onClose={() => setNoSale(false)} /> : null}
  </div>
}

// "No sale": opens the drawer and logs who, when and why. Works offline (the record is sent later).
export function NoSaleDialog({ onClose }) {
  const { online, call, queueCall, toast } = useOps()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const hardware = canOpenDrawer()
  const valid = reason.trim().length >= 3

  const submit = async (event) => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    let opened = false
    try { opened = await openDrawer() } catch (error) { toast(`The drawer did not open: ${printerProblem(error)}`, 'error'); setBusy(false); return }
    const data = { requestId: newId(), reason: reason.trim(), at: Date.now() }
    if (online) {
      const result = await call('recordNoSale', data, { quiet: true }).catch(() => null)
      if (!result) queueCall('recordNoSale', data)
    } else {
      queueCall('recordNoSale', data)
    }
    toast(opened ? 'Drawer opened. This is recorded.' : 'Recorded. Open the drawer with its key.')
    setBusy(false)
    onClose()
  }

  return <Dialog title="Open the cash drawer (no sale)" onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <p className="muted small">Every time the drawer opens without a sale, it is recorded with your name and the reason. The owner sees it in Reports → Activity.</p>
      <div className="chip-row">{['Change for a customer', 'Checking a note', 'Putting in the float'].map((preset) => <button type="button" key={preset} className="chip" onClick={() => setReason(preset)}>{preset}</button>)}</div>
      <label className="field"><span>Reason <em>required</em></span><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} data-autofocus /></label>
      {!hardware ? <p className="callout warn small">This till cannot open the drawer by itself (set it up in Till setup). Press Record, then open it with the key.</p> : null}
      <div className="row end">
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!valid || busy}>{busy ? 'Opening…' : hardware ? 'Open drawer' : 'Record'}</button>
      </div>
    </form>
  </Dialog>
}
