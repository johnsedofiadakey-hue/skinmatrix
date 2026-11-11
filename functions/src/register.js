// The cash register: opening the drawer without a sale ("No sale") and closing the business day (Z report).
import { can, requireReason, RuleError } from './core/rules.js'
import { OFFLINE_MAX_AGE } from './core/sale.js'
import { summarizeDay, zNumber } from './core/zreport.js'
import { businessDay, isDate } from './core/time.js'
import { actorRef, audit, checkRequestId, requireStaff } from './shared.js'
import { readOpenShift } from './shifts.js'

// The drawer was opened without a sale (change for a customer, checking a note…). Every opening is logged with
// a reason and counted on the cashier's open drawer. The till can open the drawer offline and send this later,
// so `at` may be up to 7 days old. data: { requestId, reason, at? }
export async function recordNoSale({ db, uid, now }, data) {
  const staff = await requireStaff(db, uid, 'sell')
  const requestId = checkRequestId(data?.requestId)
  const reason = requireReason(data?.reason)
  const at = data?.at === undefined || data?.at === null ? now : Number(data.at)
  if (!Number.isSafeInteger(at) || at > now + 5 * 60 * 1000 || now - at > OFFLINE_MAX_AGE) throw new RuleError('bad_time', 'This drawer opening is too old to record.')
  return db.runTransaction(async (tx) => {
    const requestRef = db.doc(`requests/${uid}_${requestId}`)
    const request = await tx.get(requestRef)
    if (request.exists) return request.data().result
    const shift = await readOpenShift(tx, db, uid)
    if (shift) tx.update(db.doc(`shifts/${shift.id}`), { noSales: (shift.noSales || 0) + 1 })
    const when = at === now ? '' : ` (opened offline at ${new Date(at).toISOString().slice(11, 16)} UTC)`
    audit(tx, db, now, staff, 'drawer', shift?.id || null, `${staff.name} opened the cash drawer without a sale${when}`, reason)
    const result = { recorded: true, shiftId: shift?.id || null }
    tx.set(requestRef, { at: now, result })
    return result
  })
}

// Closes a business day: records the Z report (numbered Z0001, Z0002…) from that day's sales and drawers.
// A day can be closed once. Drawers still open are listed as open; the manager confirms that first.
// data: { day?, note?, allowOpenDrawers? }
export async function closeDay({ db, uid, now }, data) {
  const staff = await requireStaff(db, uid, 'reports')
  const day = data?.day === undefined ? businessDay(now) : String(data.day)
  if (!isDate(day) || day > businessDay(now)) throw new RuleError('bad_day', 'Choose today or an earlier day.')
  const note = String(data?.note ?? '').trim().slice(0, 300)
  return db.runTransaction(async (tx) => {
    const reportRef = db.doc(`zReports/${day}`)
    const existing = await tx.get(reportRef)
    if (existing.exists) throw new RuleError('day_closed', `This day is already closed (${existing.data().number}). You can reprint it from Reports.`)
    const sales = (await tx.get(db.collection('sales').where('day', '==', day))).docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    const shifts = (await tx.get(db.collection('shifts').where('day', '==', day))).docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    const open = shifts.filter((shift) => shift.status === 'open')
    if (open.length && data?.allowOpenDrawers !== true) {
      throw new RuleError('drawers_open', `${open.map((shift) => shift.cashier?.name).join(', ')} still ${open.length === 1 ? 'has a drawer' : 'have drawers'} open. Close ${open.length === 1 ? 'it' : 'them'} first, or close the day anyway.`)
    }
    const counterRef = db.doc('counters/zReports')
    const next = ((await tx.get(counterRef)).data()?.value ?? 0) + 1
    const report = { ...summarizeDay(sales, shifts), day, number: zNumber(next), sequence: next, closedAt: now, closedBy: actorRef(staff), note }
    tx.set(counterRef, { value: next })
    tx.set(reportRef, report)
    audit(tx, db, now, staff, 'zreport', day, `Closed the day ${day} (${report.number}): takings ${(report.net / 100).toFixed(2)} GHS`, note)
    return { report }
  })
}

export const canCloseDay = (role) => can(role, 'reports')
