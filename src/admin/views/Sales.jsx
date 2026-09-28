import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { liveDb } from '../live/firebase.js'
import { useOps } from '../hooks.js'
import { formatMoney } from '../lib/money.js'
import { businessDay, DAY } from '../../../functions/src/core/time.js'
import { refundedAmount, returnedQuantity, returnValue } from '../../../functions/src/core/sale.js'
import { Dialog, Empty, Icon, Money, Pill, ReasonDialog, Segmented, Stat } from '../components/ui.jsx'
import { Guide } from '../components/guide.jsx'
import { PrintArea, printNow, Receipt, whatsappReceiptLink } from '../components/receipt.jsx'
import { fmtTime } from '../components/format.js'

const PAID_BY = { cash: 'Cash', momo: 'MoMo', card: 'Card' }

export function useSalesForDay(day) {
  const [sales, setSales] = useState(null)
  useEffect(() => {
    setSales(null)
    return onSnapshot(query(collection(liveDb, 'sales'), where('day', '==', day)), (snap) => setSales(snap.docs.map((item) => item.data()).sort((a, b) => b.at - a.at)), () => setSales([]))
  }, [day])
  return sales
}

export function dayTotals(sales) {
  const totals = { count: 0, gross: 0, refunds: 0, voided: 0, byMethod: { cash: 0, momo: 0, card: 0 } }
  for (const sale of sales) {
    if (sale.status === 'voided') { totals.voided += 1; continue }
    totals.count += 1
    totals.gross += sale.total
    totals.byMethod[sale.payment.method] += sale.total
    totals.refunds += refundedAmount(sale)
  }
  totals.net = totals.gross - totals.refunds
  return totals
}

export default function Sales() {
  const today = businessDay(Date.now())
  const [day, setDay] = useState(today)
  const [open, setOpen] = useState(null)
  const sales = useSalesForDay(day)
  const totals = dayTotals(sales || [])
  const openSale = sales?.find((sale) => sale.id === open)

  return <div className="stack">
    <Guide id="sales" title="How to reprint, refund or cancel a sale" steps={[
      'Find the sale in the list (change the day at the top if it was not today).',
      'Tap the sale to see the receipt. Print it again or send it on WhatsApp.',
      'Customer bringing something back? Press Return items. Wrong sale today? Press Cancel sale.',
      'Staff need a manager to type their PIN for returns and cancellations.',
    ]} />
    <div className="toolbar">
      <Segmented label="Day" value={day === today ? 'today' : day === businessDay(Date.now() - DAY) ? 'yesterday' : 'other'} onChange={(value) => setDay(value === 'today' ? today : businessDay(Date.now() - DAY))} options={[{ value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }]} />
      <label className="field compact"><span>Or pick a day</span><input type="date" max={today} value={day} onChange={(event) => event.target.value && setDay(event.target.value)} /></label>
    </div>
    <div className="stat-grid">
      <Stat label="Takings" value={<Money value={totals.net} />} sub={`${totals.count} sale${totals.count === 1 ? '' : 's'}${totals.refunds ? ` · ${formatMoney(totals.refunds)} refunded` : ''}`} />
      <Stat label="Cash" value={<Money value={totals.byMethod.cash} />} />
      <Stat label="MoMo" value={<Money value={totals.byMethod.momo} />} />
      <Stat label="Card" value={<Money value={totals.byMethod.card} />} sub={totals.voided ? `${totals.voided} cancelled` : undefined} />
    </div>
    {sales === null ? <p className="muted">Loading sales…</p> : sales.length ? <ul className="card-list">
      {sales.map((sale) => <li key={sale.id}>
        <button type="button" className="sale-row" onClick={() => setOpen(sale.id)}>
          <span className="sale-row-main">
            <b>Sale {sale.number}</b>
            <span className="muted small">{fmtTime(sale.at)} · {sale.cashier?.name} · {sale.items.reduce((sum, item) => sum + item.quantity, 0)} item(s){sale.customer?.name ? ` · ${sale.customer.name}` : ''}</span>
          </span>
          <span className="sale-row-side">
            <Money value={sale.total} />
            {sale.status === 'voided' ? <Pill tone="grey">Cancelled</Pill> : refundedAmount(sale) ? <Pill tone="amber">Refunded {formatMoney(refundedAmount(sale))}</Pill> : <Pill tone="green">{PAID_BY[sale.payment.method]}</Pill>}
          </span>
        </button>
      </li>)}
    </ul> : <Empty title="No sales on this day" />}
    {openSale ? <SaleSheet sale={openSale} onClose={() => setOpen(null)} /> : null}
  </div>
}

export function SaleSheet({ sale, onClose }) {
  const { shop, call } = useOps()
  const [action, setAction] = useState(null)
  const canChange = sale.status === 'completed'
  return <Dialog title={`Sale ${sale.number}`} onClose={onClose} sheet>
    <div className="stack">
      {sale.status === 'voided' ? <p className="callout bad">Cancelled by {sale.void.by.name}{sale.void.approvedBy ? `, approved by ${sale.void.approvedBy.name}` : ''}: “{sale.void.reason}”. Give back {formatMoney(sale.void.refund)} ({PAID_BY[sale.void.refundMethod]}).</p> : null}
      <Receipt sale={sale} shop={shop} />
      <PrintArea><Receipt sale={sale} shop={shop} /></PrintArea>
      {(sale.returns || []).map((entry, index) => <p key={index} className="small muted">Return by {entry.by.name}{entry.approvedBy ? ` (approved by ${entry.approvedBy.name})` : ''}: {formatMoney(entry.amount)} back by {PAID_BY[entry.refundMethod]}, {entry.condition === 'resaleable' ? 'items back on the shelf' : 'items damaged'}. “{entry.reason}”</p>)}
      <div className="button-grid">
        <button type="button" className="btn secondary" onClick={printNow}><Icon name="printer" size={16} /> Print</button>
        <a className="btn secondary" href={whatsappReceiptLink(sale, shop)} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={16} /> WhatsApp</a>
        {canChange ? <button type="button" className="btn secondary" onClick={() => setAction('return')}><Icon name="undo" size={16} /> Return items</button> : null}
        {canChange ? <button type="button" className="btn danger-outline" onClick={() => setAction('void')}>Cancel sale</button> : null}
      </div>
    </div>
    {action === 'void' ? <ReasonDialog title={`Cancel sale ${sale.number}?`} destructive confirmLabel="Cancel sale"
      intro={<p className="small">Everything on this sale goes back into stock. Give the customer back <b>{formatMoney(sale.total - refundedAmount(sale))}</b>. Use this for mistakes made today; for a customer bringing things back, use Return items instead.</p>}
      presets={['Rang up the wrong item', 'Customer changed their mind', 'Paid twice by mistake']}
      onConfirm={async (reason) => Boolean(await call('voidSale', { saleId: sale.id, reason }, { success: `Sale ${sale.number} cancelled. Stock is back.` }))}
      onClose={() => setAction(null)} /> : null}
    {action === 'return' ? <ReturnDialog sale={sale} onClose={() => setAction(null)} /> : null}
  </Dialog>
}

function ReturnDialog({ sale, onClose }) {
  const { call } = useOps()
  const [quantities, setQuantities] = useState(() => Object.fromEntries(sale.items.map((item) => [item.productId, 0])))
  const [condition, setCondition] = useState('resaleable')
  const [refundMethod, setRefundMethod] = useState(sale.payment.method)
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const lines = sale.items.filter((item) => quantities[item.productId] > 0).map((item) => ({ productId: item.productId, quantity: quantities[item.productId] }))
  const amount = lines.reduce((sum, line) => sum + returnValue(sale, line.productId, line.quantity), 0)
  const valid = lines.length && reason.trim().length >= 3 && (refundMethod !== 'momo' || reference.trim().length >= 6)
  const submit = async (event) => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    const result = await call('returnItems', { saleId: sale.id, lines, condition, refundMethod, reference, reason }, { success: (value) => `Return saved. Give back ${formatMoney(value.amount)}.` })
    setBusy(false)
    if (result) onClose()
  }
  return <Dialog title={`Return from sale ${sale.number}`} onClose={onClose} sheet>
    <form className="stack" onSubmit={submit}>
      {sale.items.map((item) => {
        const left = item.quantity - returnedQuantity(sale, item.productId)
        return <div key={item.productId} className="return-line">
          <span><b>{item.name}</b><span className="muted small block">Bought {item.quantity} · can return {left}</span></span>
          <div className="qty">
            <button type="button" disabled={!quantities[item.productId]} onClick={() => setQuantities({ ...quantities, [item.productId]: quantities[item.productId] - 1 })} aria-label="One less"><Icon name="minus" size={16} /></button>
            <span>{quantities[item.productId]}</span>
            <button type="button" disabled={quantities[item.productId] >= left} onClick={() => setQuantities({ ...quantities, [item.productId]: quantities[item.productId] + 1 })} aria-label="One more"><Icon name="plus" size={16} /></button>
          </div>
        </div>
      })}
      <div className="field"><span>Can it go back on the shelf?</span>
        <Segmented label="Condition" value={condition} onChange={setCondition} options={[{ value: 'resaleable', label: 'Yes, unopened' }, { value: 'damaged', label: 'No, opened or damaged' }]} />
      </div>
      <div className="field"><span>Give the money back by</span>
        <Segmented label="Refund method" value={refundMethod} onChange={setRefundMethod} options={[{ value: 'cash', label: 'Cash' }, { value: 'momo', label: 'MoMo' }, { value: 'card', label: 'Card' }]} />
      </div>
      {refundMethod === 'momo' ? <label className="field"><span>Transaction ID of the MoMo you sent back</span><input value={reference} onChange={(event) => setReference(event.target.value)} autoComplete="off" /></label> : null}
      <label className="field"><span>Why is it coming back?</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. wrong shade, allergic reaction" /></label>
      <p className="checkout-total"><span>Give back</span><b>{formatMoney(amount)}</b></p>
      <p className="muted small">If there was a discount, the refund is what the customer actually paid for these items.</p>
      <button type="submit" className="btn primary block large" disabled={!valid || busy}>{busy ? 'Saving…' : 'Save return'}</button>
    </form>
  </Dialog>
}
