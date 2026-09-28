import { useState } from 'react'
import { useOps } from '../hooks.js'
import { formatMoney } from '../lib/money.js'
import { fmtFull } from './format.js'
import { Card, Dialog, Icon } from './ui.jsx'

// Offline sales kept on this till: how many are waiting to be sent, and any the server refused.
export function OfflineSales() {
  const { offlineSales, online, syncOffline, retryOffline, dropOffline, can, productById } = useOps()
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(null)
  if (!offlineSales.length) return null
  const waiting = offlineSales.filter((entry) => entry.status === 'waiting')
  const problems = offlineSales.filter((entry) => entry.status === 'problem')

  const retry = async (entry) => {
    setBusy(entry.requestId)
    await retryOffline(entry.requestId)
    setBusy(null)
  }

  return <Card title={<span className="row"><Icon name="alertCircle" size={18} /> Offline sales on this till</span>} className="offline-sales">
    <div className="stack">
      {waiting.length ? <p className="small">{waiting.length} sale(s) worth <b>{formatMoney(waiting.reduce((sum, entry) => sum + entry.clientTotal, 0))}</b> {online ? 'are being sent now.' : 'will be sent when the internet is back.'} Keep this device on and don’t clear the browser.</p> : null}
      {waiting.length && online ? <button type="button" className="btn ghost small" onClick={syncOffline}>Send now</button> : null}
      {problems.length ? <>
        <p className="small bad-text">{problems.length} offline sale(s) were not accepted. Fix the reason below, then press Try again. The customer already has the goods.</p>
        <ul className="history">{problems.map((entry) => <li key={entry.requestId}>
          <span><b>Offline sale {entry.localNumber}</b> · {fmtFull(entry.at)} · {formatMoney(entry.clientTotal)}<span className="bad-text small block">{entry.error}</span></span>
          <span className="row">
            <button type="button" className="btn secondary small" disabled={!online || busy === entry.requestId} onClick={() => retry(entry)}>Try again</button>
            {can('approve') ? <button type="button" className="btn ghost small" onClick={() => setRemoving(entry)}>Remove</button> : null}
          </span>
        </li>)}</ul>
      </> : null}
    </div>
    {removing ? <Dialog title={`Remove offline sale ${removing.localNumber}?`} onClose={() => setRemoving(null)}>
      <div className="stack">
        <p className="small">This deletes the sale from this device. It was never recorded on the server, so you must record it another way (for example, adjust stock and count the cash as a difference when closing the drawer).</p>
        <ul className="small">{removing.lines.map((line) => <li key={line.productId}>{line.quantity} × {productById.get(line.productId)?.name || line.productId}</li>)}</ul>
        <div className="row end">
          <button type="button" className="btn ghost" onClick={() => setRemoving(null)}>Keep it</button>
          <button type="button" className="btn danger" onClick={() => { dropOffline(removing.requestId); setRemoving(null) }}>Remove from this device</button>
        </div>
      </div>
    </Dialog> : null}
  </Card>
}
