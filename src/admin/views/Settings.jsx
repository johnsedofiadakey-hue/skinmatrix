import { useEffect, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { liveDb } from '../live/firebase.js'
import { useNow, useOps } from '../hooks.js'
import { formatMoney } from '../lib/money.js'
import { percentLabel, taxBreakdown } from '../../../functions/src/core/tax.js'
import { Card, Empty, Pill } from '../components/ui.jsx'
import { Guide } from '../components/guide.jsx'
import { fmtWhen } from '../components/format.js'

// "15" or "2.5" -> basis points (1500, 250); anything else -> null.
const toBp = (text) => (/^\d{1,2}(\.\d{1,2})?$/.test(String(text).trim()) ? Math.round(Number(text) * 100) : null)
const fromBp = (bp) => String(bp / 100)

// The form starts again from the saved settings whenever they change (they load a moment after the page opens).
export default function Settings() {
  const { settings } = useOps()
  return <SettingsForm key={JSON.stringify(settings)} settings={settings} />
}

function SettingsForm({ settings }) {
  const { call } = useOps()
  const [tax, setTax] = useState(() => ({ ...settings.tax, vat: fromBp(settings.tax.vatBp), nhil: fromBp(settings.tax.nhilBp), getfund: fromBp(settings.tax.getfundBp) }))
  const [sms, setSms] = useState(settings.sms)
  const [busy, setBusy] = useState(false)
  const rates = { vatBp: toBp(tax.vat), nhilBp: toBp(tax.nhil), getfundBp: toBp(tax.getfund) }
  const ratesValid = Object.values(rates).every((value) => value !== null && value <= 5000)
  const example = ratesValid ? taxBreakdown(10000, { ...tax, ...rates, registered: true }) : null

  const save = async (event) => {
    event.preventDefault()
    if (!ratesValid || busy) return
    setBusy(true)
    await call('saveShopSettings', { tax: { registered: tax.registered, tin: tax.tin, ...rates }, sms }, { success: 'Settings saved. New sales use them straight away.' })
    setBusy(false)
  }

  return <form className="stack narrow" onSubmit={save}>
    <Guide id="settings" title="Shop settings" steps={[
      'Taxes: turn this on only if the shop is registered for VAT. Receipts then show the TIN and how much of each price is VAT, NHIL and GETFund.',
      'Check the rates with your accountant or GRA. Prices on the shelf already include the taxes.',
      'Text messages need an mNotify account. The developer adds its API key to the server once; then you can turn messages on here.',
    ]} />
    <Card title="Taxes on receipts">
      <div className="stack">
        <label className="check"><input type="checkbox" checked={tax.registered} onChange={(event) => setTax({ ...tax, registered: event.target.checked })} /> The shop is registered for VAT</label>
        {tax.registered ? <>
          <label className="field"><span>TIN <em>as on your VAT certificate</em></span><input value={tax.tin} onChange={(event) => setTax({ ...tax, tin: event.target.value.toUpperCase() })} autoComplete="off" /></label>
          <div className="field-row">
            <label className="field"><span>VAT %</span><input inputMode="decimal" value={tax.vat} onChange={(event) => setTax({ ...tax, vat: event.target.value })} /></label>
            <label className="field"><span>NHIL %</span><input inputMode="decimal" value={tax.nhil} onChange={(event) => setTax({ ...tax, nhil: event.target.value })} /></label>
            <label className="field"><span>GETFund %</span><input inputMode="decimal" value={tax.getfund} onChange={(event) => setTax({ ...tax, getfund: event.target.value })} /></label>
          </div>
          {!ratesValid ? <p className="bad-text small">Rates must be numbers like 15 or 2.5.</p> : null}
          {example ? <div className="receipt-totals receipt-tax">
            <div><span><b>On a GHS 100.00 sale</b></span><span /></div>
            <div><span>Value before tax</span><span>{formatMoney(example.net)}</span></div>
            <div><span>VAT {percentLabel(example.vatBp)}</span><span>{formatMoney(example.vat)}</span></div>
            <div><span>NHIL {percentLabel(example.nhilBp)}</span><span>{formatMoney(example.nhil)}</span></div>
            <div><span>GETFund {percentLabel(example.getfundBp)}</span><span>{formatMoney(example.getfund)}</span></div>
          </div> : null}
        </> : <p className="muted small">Receipts show no tax lines.</p>}
      </div>
    </Card>
    <Card title="Text messages (SMS) to customers">
      <div className="stack">
        <label className="check"><input type="checkbox" checked={sms.enabled} onChange={(event) => setSms({ ...sms, enabled: event.target.checked })} /> Send text messages</label>
        {sms.enabled ? <>
          <label className="field"><span>Sender name <em>3–11 letters, registered with mNotify</em></span><input value={sms.senderId} maxLength={11} onChange={(event) => setSms({ ...sms, senderId: event.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={sms.orderPlaced} onChange={(event) => setSms({ ...sms, orderPlaced: event.target.checked })} /> Website order received (and online payment received)</label>
          <label className="check"><input type="checkbox" checked={sms.orderUpdates} onChange={(event) => setSms({ ...sms, orderUpdates: event.target.checked })} /> Website order confirmed, ready, on the way or cancelled</label>
          <label className="check"><input type="checkbox" checked={sms.saleReceipt} onChange={(event) => setSms({ ...sms, saleReceipt: event.target.checked })} /> Receipt for shop sales when the cashier types the customer’s phone</label>
          <p className="muted small">Each message costs a little mNotify credit. If a message fails, the order or sale still goes through; failures show below.</p>
        </> : null}
      </div>
    </Card>
    <button type="submit" className="btn primary block large" disabled={!ratesValid || busy}>{busy ? 'Saving…' : 'Save settings'}</button>
    <SmsLog />
  </form>
}

function SmsLog() {
  const now = useNow(60000)
  const [rows, setRows] = useState(null)
  useEffect(() => onSnapshot(query(collection(liveDb, 'smsLog'), orderBy('at', 'desc'), limit(20)), (snap) => setRows(snap.docs.map((item) => ({ id: item.id, ...item.data() }))), () => setRows([])), [])
  return <Card title="Latest text messages">
    {rows === null ? <p className="muted">Loading…</p> : rows.length ? <ul className="history">{rows.map((row) => <li key={row.id}>
      <span><span className="muted small">{fmtWhen(row.at, now)} · 0{String(row.to).slice(3)}</span><span className="block small">{row.text}</span>{row.error ? <span className="bad-text small block">{row.error}</span> : null}</span>
      <Pill tone={row.ok ? 'green' : 'red'}>{row.ok ? 'Sent' : 'Not sent'}</Pill>
    </li>)}</ul> : <Empty title="No messages yet" />}
  </Card>
}
