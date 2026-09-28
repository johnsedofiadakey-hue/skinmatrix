import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { liveDb } from '../live/firebase.js'
import { useOps } from '../hooks.js'
import { formatMoney, parseCedis } from '../lib/money.js'
import { expectedCash, movesTotal } from '../../../functions/src/core/shift.js'
import { Card, Dialog, Empty, Icon, Money, Segmented, Stat } from '../components/ui.jsx'
import { Guide } from '../components/guide.jsx'
import { OfflineSales } from '../components/offline.jsx'
import { fmtFull, fmtTime } from '../components/format.js'

// The cashier's own cash drawer: open with a float, record cash in or out, count and close at the end.
export default function Drawer() {
  const { me, myShift, can, offlineSales } = useOps()
  const [closed, setClosed] = useState(null)
  const unsent = offlineSales.filter((entry) => entry.shiftId && entry.shiftId === myShift?.id).length

  return <div className="stack narrow">
    <Guide id="drawer" title="Cash drawer · how it works" steps={[
      'At the start of your shift, count the cash in the drawer and press Open drawer. This is your float.',
      'Every cash sale and cash refund you make is added to your drawer automatically.',
      'If cash goes in or out for another reason (change from the bank, paying a rider), record it here with the reason. Taking cash out needs a manager.',
      'At the end of your shift, count all the cash and press Close drawer. Any difference is recorded for the owner.',
    ]} />
    <OfflineSales />
    {closed ? <ClosedResult shift={closed} onDone={() => setClosed(null)} /> : null}
    {!closed && !me.openShiftId ? <OpenDrawer /> : null}
    {!closed && me.openShiftId && myShift ? <OpenShift shift={myShift} showTotals={can('reports')} unsent={unsent} onClosed={setClosed} /> : null}
    {!closed && me.openShiftId && !myShift ? <p className="muted">Loading your drawer…</p> : null}
    {can('closeAnyShift') ? <OtherDrawers /> : null}
  </div>
}

function OpenDrawer() {
  const { call } = useOps()
  const [float, setFloat] = useState('')
  const [busy, setBusy] = useState(false)
  const amount = parseCedis(float)
  const submit = async (event) => {
    event.preventDefault()
    if (amount === null || busy) return
    setBusy(true)
    await call('openShift', { float: amount }, { success: 'Drawer open. You can take cash now.' })
    setBusy(false)
  }
  return <Card title="Open my drawer">
    <form className="stack" onSubmit={submit}>
      <p className="muted small">Count the cash in the drawer before your first sale. Type 0 if it is empty.</p>
      <label className="field"><span>Cash in the drawer now (GHS)</span><input className="big-input" inputMode="decimal" placeholder="0.00" value={float} onChange={(event) => setFloat(event.target.value)} data-autofocus /></label>
      <button type="submit" className="btn primary block large" disabled={amount === null || busy}>{busy ? 'Opening…' : 'Open drawer'}</button>
    </form>
  </Card>
}

function OpenShift({ shift, showTotals, unsent, onClosed }) {
  const [moving, setMoving] = useState(null) // 'in' | 'out'
  const [closing, setClosing] = useState(false)
  return <>
    <div className="stat-grid">
      <Stat label="Opened" value={fmtTime(shift.openedAt)} sub={`Float ${formatMoney(shift.float)}`} />
      <Stat label="Cash sales" value={shift.sales || 0} sub={showTotals ? formatMoney(shift.cashSales || 0) : 'Counted at closing'} />
      {showTotals ? <Stat label="Should be in the drawer" value={<Money value={expectedCash(shift)} />} sub={shift.cashRefunds ? `After ${formatMoney(shift.cashRefunds)} cash refunds` : undefined} /> : null}
    </div>
    <Card title="Cash in and out" actions={<span className="row"><button type="button" className="btn secondary small" onClick={() => setMoving('in')}><Icon name="plus" size={14} /> Cash in</button><button type="button" className="btn secondary small" onClick={() => setMoving('out')}><Icon name="minus" size={14} /> Cash out</button></span>}>
      {(shift.moves || []).length ? <ul className="history">{shift.moves.map((move) => <li key={move.at}>
        <span>{fmtTime(move.at)} · {move.reason}<span className="muted small block">{move.by?.name}{move.approvedBy ? ` · approved by ${move.approvedBy.name}` : ''}</span></span>
        <b>{move.kind === 'out' ? '−' : '+'}{formatMoney(move.amount)}</b>
      </li>)}</ul> : <p className="muted small">Nothing yet. Record change from the bank, a paid delivery rider and similar here.</p>}
    </Card>
    <button type="button" className="btn primary block large" onClick={() => setClosing(true)} disabled={unsent > 0}>Close drawer and count</button>
    {unsent ? <p className="warn-text small">{unsent} offline sale(s) from this drawer are not sent yet. Close the drawer once they are sent.</p> : null}
    {moving ? <MoveDialog kind={moving} onClose={() => setMoving(null)} /> : null}
    {closing ? <CloseDialog shift={shift} onClose={() => setClosing(false)} onClosed={(result) => { setClosing(false); onClosed(result) }} /> : null}
  </>
}

function MoveDialog({ kind, onClose }) {
  const { call } = useOps()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const value = parseCedis(amount)
  const valid = value > 0 && reason.trim().length >= 3
  const submit = async (event) => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    const result = await call('cashMovement', { kind, amount: value, reason: reason.trim() }, { success: kind === 'in' ? 'Cash in recorded.' : 'Cash out recorded.' })
    setBusy(false)
    if (result) onClose()
  }
  return <Dialog title={kind === 'in' ? 'Cash put into the drawer' : 'Cash taken out of the drawer'} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <label className="field"><span>Amount (GHS)</span><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} data-autofocus /></label>
      <div className="chip-row">{(kind === 'in' ? ['Change from the bank', 'Owner added cash'] : ['Paid delivery rider', 'Bought shop supplies', 'Cash banked']).map((preset) => <button type="button" key={preset} className="chip" onClick={() => setReason(preset)}>{preset}</button>)}</div>
      <label className="field"><span>Reason <em>required</em></span><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} /></label>
      {kind === 'out' ? <p className="muted small">Staff need a manager to approve cash out. The manager types their PIN on this screen.</p> : null}
      <div className="row end">
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!valid || busy}>{busy ? 'Saving…' : 'Record'}</button>
      </div>
    </form>
  </Dialog>
}

function CloseDialog({ shift, forName, onClose, onClosed }) {
  const { call, toast } = useOps()
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [needNote, setNeedNote] = useState(false)
  const [busy, setBusy] = useState(false)
  const value = parseCedis(counted)
  const submit = async (event) => {
    event.preventDefault()
    if (value === null || busy) return
    setBusy(true)
    try {
      const result = await call('closeShift', { shiftId: forName ? shift.id : undefined, counted: value, note: note.trim() }, { quiet: true })
      if (result) onClosed(result.shift)
    } catch (error) {
      if (error.code === 'reason_required') setNeedNote(true)
      else toast(error.message, 'error')
    } finally { setBusy(false) }
  }
  return <Dialog title={forName ? `Close ${forName}’s drawer` : 'Close my drawer'} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <p className="muted small">Count all the cash in the drawer, notes and coins, and type the total.</p>
      <label className="field"><span>Cash counted (GHS)</span><input className="big-input" inputMode="decimal" placeholder="0.00" value={counted} onChange={(event) => { setCounted(event.target.value); setNeedNote(false) }} data-autofocus /></label>
      {needNote ? <>
        <p className="callout warn small">The count does not match what the drawer should have. Count again, or write what happened. The difference is recorded for the owner.</p>
        <label className="field"><span>What happened? <em>required</em></span><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} /></label>
      </> : null}
      <div className="row end">
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn primary" disabled={value === null || busy || (needNote && note.trim().length < 3)}>{busy ? 'Closing…' : 'Close drawer'}</button>
      </div>
    </form>
  </Dialog>
}

function ClosedResult({ shift, onDone }) {
  const tone = shift.difference === 0 ? 'good-text' : 'bad-text'
  return <Card title="Drawer closed">
    <div className="stack">
      <div className="receipt-totals">
        <div><span>Float</span><span>{formatMoney(shift.float)}</span></div>
        <div><span>Cash sales</span><span>{formatMoney(shift.cashSales || 0)}</span></div>
        {shift.cashRefunds ? <div><span>Cash refunds</span><span>−{formatMoney(shift.cashRefunds)}</span></div> : null}
        {movesTotal(shift, 'in') ? <div><span>Cash in</span><span>{formatMoney(movesTotal(shift, 'in'))}</span></div> : null}
        {movesTotal(shift, 'out') ? <div><span>Cash out</span><span>−{formatMoney(movesTotal(shift, 'out'))}</span></div> : null}
        <div className="receipt-total"><span>Expected</span><span>{formatMoney(shift.expected)}</span></div>
        <div><span>Counted</span><span>{formatMoney(shift.counted)}</span></div>
        <div className={tone}><span>{shift.difference === 0 ? 'Matches' : shift.difference > 0 ? 'Over' : 'Short'}</span><span>{formatMoney(shift.difference, { signed: true })}</span></div>
      </div>
      <button type="button" className="btn primary" onClick={onDone}>Done</button>
    </div>
  </Card>
}

// Managers and the owner: drawers still open on other tills (someone forgot to close).
function OtherDrawers() {
  const { me } = useOps()
  const [shifts, setShifts] = useState(null)
  const [closing, setClosing] = useState(null)
  const [done, setDone] = useState(null)
  useEffect(() => onSnapshot(query(collection(liveDb, 'shifts'), where('status', '==', 'open')), (snap) => setShifts(snap.docs.map((item) => ({ id: item.id, ...item.data() }))), () => setShifts([])), [])
  const others = (shifts || []).filter((shift) => shift.cashier?.uid !== me.uid)
  return <Card title="Other open drawers">
    {done ? <p className="small good-text">Closed {done.cashier?.name}’s drawer: {done.difference === 0 ? 'matched' : `${done.difference > 0 ? 'over' : 'short'} by ${formatMoney(Math.abs(done.difference))}`}.</p> : null}
    {others.length ? <ul className="history">{others.map((shift) => <li key={shift.id}>
      <span><b>{shift.cashier?.name}</b> · opened {fmtFull(shift.openedAt)}<span className="muted small block">Should have {formatMoney(expectedCash(shift))}</span></span>
      <button type="button" className="btn secondary small" onClick={() => setClosing(shift)}>Count and close</button>
    </li>)}</ul> : <Empty title="No other drawers open" />}
    {closing ? <CloseDialog shift={closing} forName={closing.cashier?.name} onClose={() => setClosing(null)} onClosed={(shift) => { setClosing(null); setDone(shift) }} /> : null}
  </Card>
}

// Reports tab: every drawer opened in the period, with its count.
export function DrawerReport({ shifts }) {
  const [filter, setFilter] = useState('all')
  if (!shifts) return <p className="muted">Loading…</p>
  const shown = (filter === 'different' ? shifts.filter((shift) => shift.difference) : shifts).sort((a, b) => b.openedAt - a.openedAt)
  const short = shifts.reduce((sum, shift) => sum + Math.min(0, shift.difference || 0), 0)
  const over = shifts.reduce((sum, shift) => sum + Math.max(0, shift.difference || 0), 0)
  const late = shifts.reduce((sum, shift) => sum + (shift.lateCash || 0), 0)
  return <>
    <div className="stat-grid">
      <Stat label="Drawers" value={shifts.length} sub={`${shifts.filter((shift) => shift.status === 'open').length} still open`} />
      <Stat label="Short" value={<Money value={short} />} tone={short ? 'bad' : ''} />
      <Stat label="Over" value={<Money value={over} />} />
      {late ? <Stat label="Offline cash after closing" value={<Money value={late} />} sub="Sent after the drawer was closed" tone="warn" /> : null}
    </div>
    <Segmented label="Which drawers" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'different', label: 'With a difference', count: shifts.filter((shift) => shift.difference).length }]} />
    {shown.length ? <Card flush><table className="table compact">
      <thead><tr><th scope="col">Cashier</th><th scope="col">Opened</th><th scope="col" className="num">Float</th><th scope="col" className="num">Cash sales</th><th scope="col" className="num">In / out</th><th scope="col" className="num">Expected</th><th scope="col" className="num">Counted</th><th scope="col" className="num">Difference</th></tr></thead>
      <tbody>{shown.map((shift) => <tr key={shift.id}>
        <td>{shift.cashier?.name}{shift.note ? <span className="muted small block">“{shift.note}”</span> : null}</td>
        <td className="nowrap">{fmtFull(shift.openedAt)}{shift.closedAt ? <span className="muted small block">to {fmtTime(shift.closedAt)}{shift.closedBy && shift.closedBy.uid !== shift.cashier?.uid ? ` by ${shift.closedBy.name}` : ''}</span> : <span className="warn-text small block">Still open</span>}</td>
        <td className="num">{formatMoney(shift.float)}</td>
        <td className="num">{formatMoney((shift.cashSales || 0) - (shift.cashRefunds || 0))}</td>
        <td className="num">{formatMoney(movesTotal(shift, 'in') - movesTotal(shift, 'out'), { signed: true })}</td>
        <td className="num">{formatMoney(shift.expected ?? expectedCash(shift))}</td>
        <td className="num">{shift.counted === null || shift.counted === undefined ? '—' : formatMoney(shift.counted)}</td>
        <td className={`num ${shift.difference ? 'bad-text' : ''}`}>{shift.difference === null || shift.difference === undefined ? '—' : formatMoney(shift.difference, { signed: true })}</td>
      </tr>)}</tbody>
    </table></Card> : <Empty title="No drawers in this period" />}
  </>
}
