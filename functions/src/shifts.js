// Cash drawer shifts. A cashier opens their drawer with a float, every cash sale and cash refund they make is
// added to it, cash taken out (paid-outs) or put in is recorded with a reason, and at the end they count the
// drawer. The difference between counted and expected is recorded for the owner.
import { can, requireReason, RuleError } from './core/rules.js'
import { checkAmount, expectedCash, newShift } from './core/shift.js'
import { businessDay } from './core/time.js'
import { actorRef, approvalCheck, audit, requireStaff, verifyApproval } from './shared.js'

const NO_SHIFT = 'Open your cash drawer first: go to Cash drawer and type the float (the cash you start with).'

// Inside a transaction, before any writes: this person's open shift, or null.
export async function readOpenShift(tx, db, uid) {
  const id = (await tx.get(db.doc(`staff/${uid}`))).data()?.openShiftId
  if (!id) return null
  const snap = await tx.get(db.doc(`shifts/${id}`))
  return snap.exists && snap.data().status === 'open' ? { ...snap.data(), id: snap.id } : null
}

export function requireShift(shift) {
  if (!shift) throw new RuleError('no_shift', NO_SHIFT)
  return shift
}

// Adds cash to a shift's running totals (inside the same transaction as the sale or refund).
export function addCash(tx, db, shift, { sale = 0, refund = 0, late = false }) {
  const patch = late
    ? { lateCash: (shift.lateCash || 0) + sale - refund }
    : { cashSales: (shift.cashSales || 0) + sale, cashRefunds: (shift.cashRefunds || 0) + refund, sales: (shift.sales || 0) + (sale ? 1 : 0) }
  tx.update(db.doc(`shifts/${shift.id}`), patch)
}

export async function openShift({ db, uid, now }, data) {
  const staff = await requireStaff(db, uid, 'sell')
  const float = checkAmount(data?.float, { allowZero: true, label: 'cash you start with (float)' })
  return db.runTransaction(async (tx) => {
    const current = await readOpenShift(tx, db, uid)
    if (current) throw new RuleError('shift_open', 'Your drawer is already open. Close it before opening a new one.')
    const ref = db.collection('shifts').doc()
    const shift = newShift({ id: ref.id, cashier: actorRef(staff), float, now, day: businessDay(now) })
    tx.set(ref, shift)
    tx.update(db.doc(`staff/${uid}`), { openShiftId: ref.id })
    audit(tx, db, now, staff, 'shift', ref.id, `${staff.name} opened the cash drawer with ${(float / 100).toFixed(2)} GHS`)
    return { shift }
  })
}

// Cash put into or taken out of the drawer that is not a sale: change from the bank, paying a delivery person…
// Taking cash out needs a manager (or a manager's PIN).
export async function cashMovement({ db, uid, now }, data) {
  const staff = await requireStaff(db, uid, 'sell')
  const kind = data?.kind
  if (!['in', 'out'].includes(kind)) throw new RuleError('bad_kind', 'Choose whether cash goes in or out.')
  const amount = checkAmount(data?.amount)
  const reason = requireReason(data?.reason)
  const check = (person) => (kind === 'out' && !can(person.role, 'cashOut') ? 'Taking cash out of the drawer needs a manager.' : '')
  const approver = check(staff) ? await verifyApproval(db, data?.approval, staff, check, now) : null
  return db.runTransaction(async (tx) => {
    const shift = requireShift(await readOpenShift(tx, db, uid))
    const approvedBy = approvalCheck(staff, approver, check)
    if (kind === 'out' && amount > expectedCash(shift)) throw new RuleError('not_enough_cash', `The drawer should only have ${(expectedCash(shift) / 100).toFixed(2)} GHS.`)
    const move = { at: now, kind, amount, reason, by: actorRef(staff), approvedBy }
    tx.update(db.doc(`shifts/${shift.id}`), { moves: [...(shift.moves || []), move] })
    audit(tx, db, now, staff, 'shift', shift.id, `Cash ${kind === 'out' ? 'taken out of' : 'put into'} the drawer: ${(amount / 100).toFixed(2)} GHS`, `${reason}${approvedBy ? ` · approved by ${approvedBy.name}` : ''}`)
    return { expected: expectedCash({ ...shift, moves: [...(shift.moves || []), move] }) }
  })
}

// Close your own drawer, or (manager/owner) someone else's that was left open. data: { shiftId?, counted, note }
export async function closeShift({ db, uid, now }, data) {
  const staff = await requireStaff(db, uid, 'sell')
  const counted = checkAmount(data?.counted, { allowZero: true, label: 'cash you counted' })
  return db.runTransaction(async (tx) => {
    let shift
    if (data?.shiftId) {
      const snap = await tx.get(db.doc(`shifts/${String(data.shiftId)}`))
      if (!snap.exists) throw new RuleError('not_found', 'Drawer not found.')
      shift = { ...snap.data(), id: snap.id }
      if (shift.cashier?.uid !== uid && !can(staff.role, 'closeAnyShift')) throw new RuleError('forbidden', 'Only a manager can close someone else’s drawer.')
    } else {
      shift = requireShift(await readOpenShift(tx, db, uid))
    }
    if (shift.status !== 'open') throw new RuleError('shift_closed', 'This drawer is already closed.')
    const expected = expectedCash(shift)
    const difference = counted - expected
    const note = difference ? requireReason(data?.note, 'note about why the cash is different') : String(data?.note ?? '').trim().slice(0, 300)
    const closed = { status: 'closed', closedAt: now, closedBy: actorRef(staff), counted, expected, difference, note }
    tx.update(db.doc(`shifts/${shift.id}`), closed)
    tx.update(db.doc(`staff/${shift.cashier.uid}`), { openShiftId: null })
    const diffText = difference === 0 ? 'matched' : `${difference > 0 ? 'over' : 'short'} by ${(Math.abs(difference) / 100).toFixed(2)} GHS`
    audit(tx, db, now, staff, 'shift', shift.id, `Closed ${shift.cashier.uid === uid ? 'the' : `${shift.cashier.name}’s`} cash drawer: counted ${(counted / 100).toFixed(2)} GHS, ${diffText}`, note)
    return { shift: { ...shift, ...closed } }
  })
}
