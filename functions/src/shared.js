// Helpers every command shares: who is asking, approvals, and the reads and writes that keep stock,
// the public in-stock flags, movements and the audit log consistent inside one transaction.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { can, RuleError } from './core/rules.js'
import { allocateFefo, sellableFromSummary, summarize } from './core/stock.js'
import { businessDay } from './core/time.js'

export const actorRef = (staff) => ({ uid: staff.uid, name: staff.name, role: staff.role })
export const pad = (number) => String(number).padStart(6, '0')

// ── Who is asking ──────────────────────────────────────────────────────────────────────────────

export async function requireStaff(db, uid, action) {
  if (!uid) throw new RuleError('unauthenticated', 'Please sign in again.')
  const snap = await db.doc(`staff/${uid}`).get()
  if (!snap.exists) throw new RuleError('not_staff', 'This account is not set up as SkinMatrix staff. Ask the owner to add you.')
  const staff = { uid, ...snap.data() }
  if (staff.active === false) throw new RuleError('account_disabled', 'This staff account has been turned off.')
  if (action && !can(staff.role, action)) throw new RuleError('forbidden', 'Your role cannot do this.')
  return staff
}

export function hashPin(pin, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(String(pin), salt, 32).toString('hex') }
}

// A manager or the owner approves at the till with their PIN. Five wrong PINs lock the approver for 15 minutes.
// check(person) returns '' if that person may do the action, otherwise the reason they may not.
export async function verifyApproval(db, approval, requester, check, now) {
  if (!approval) return null
  const approverId = String(approval.approverId ?? '')
  if (!approverId || approverId === requester.uid) throw new RuleError('bad_approval', 'Someone else has to approve this.')
  const snap = await db.doc(`staff/${approverId}`).get()
  const approver = snap.exists ? { uid: approverId, ...snap.data() } : null
  if (!approver || approver.active === false || !can(approver.role, 'approve')) throw new RuleError('bad_approval', 'Choose an active manager or the owner.')
  const why = check(approver)
  if (why) throw new RuleError('forbidden', `${approver.name} cannot approve this either: ${why}`)
  const secretRef = db.doc(`staffSecrets/${approverId}`)
  const ok = await db.runTransaction(async (tx) => {
    const secret = (await tx.get(secretRef)).data()
    if (!secret?.pinHash) throw new RuleError('no_pin', `${approver.name} has not set an approval PIN yet (Staff → My approval PIN).`)
    if ((secret.lockedUntil ?? 0) > now) throw new RuleError('pin_locked', `Too many wrong PINs for ${approver.name}. Try again in 15 minutes.`)
    const given = scryptSync(String(approval.pin ?? ''), secret.pinSalt, 32)
    const match = timingSafeEqual(given, Buffer.from(secret.pinHash, 'hex'))
    const failed = match ? 0 : (secret.failedAttempts ?? 0) + 1
    tx.set(secretRef, { failedAttempts: failed >= 5 ? 0 : failed, lockedUntil: failed >= 5 ? now + 15 * 60 * 1000 : 0 }, { merge: true })
    return match
  })
  if (!ok) throw new RuleError('bad_pin', `That PIN is not right for ${approver.name}.`)
  return approver
}

export function approvalCheck(staff, approver, check) {
  const why = check(staff)
  if (!why) return null
  if (!approver) throw new RuleError('approval_required', `${why} A manager or the owner can approve with their PIN.`)
  return actorRef(approver)
}

// ── Shared reads and writes inside a transaction ──────────────────────────────────────────────

export async function readCatalog(tx, db) {
  const snap = await tx.get(db.doc('site/catalog'))
  return Array.isArray(snap.data()?.products) ? snap.data().products : []
}

// All batches of the given products (including empty ones), keyed by product.
export async function readBatches(tx, db, productIds) {
  const result = new Map(productIds.map((id) => [id, []]))
  const ids = [...new Set(productIds)]
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await tx.get(db.collection('batches').where('productId', 'in', ids.slice(i, i + 30)))
    for (const doc of snap.docs) result.get(doc.data().productId)?.push({ id: doc.id, ...doc.data() })
  }
  return result
}

export async function readAvailability(tx, db) {
  return (await tx.get(db.doc('site/availability'))).data()?.products || {}
}

// After batches change: the readable stock summary, and the public in-stock flag the website uses.
export function writeStock(tx, db, batchesByProduct, availability, now) {
  const nextAvailability = { ...availability }
  for (const [productId, batches] of batchesByProduct) {
    const summary = summarize(batches, now)
    tx.set(db.doc(`stock/${productId}`), { productId, ...summary, updatedAt: now })
    nextAvailability[productId] = sellableFromSummary(summary, now) > 0
  }
  if (JSON.stringify(nextAvailability) !== JSON.stringify(availability)) tx.set(db.doc('site/availability'), { products: nextAvailability, updatedAt: now })
}

export function writeBatch(tx, db, batch) {
  const { id, ...data } = batch
  tx.set(db.doc(`batches/${id}`), data)
}

export function audit(tx, db, now, staff, type, ref, summary, detail = '') {
  tx.set(db.collection('audit').doc(), { at: now, day: businessDay(now), type, actor: actorRef(staff), ref: ref || null, summary, detail })
}

export function movement(tx, db, now, staff, { productId, batch, delta, kind, ref, reason = '' }) {
  tx.set(db.collection('movements').doc(), { at: now, productId, batchId: batch.id, lot: batch.lot, delta, kind, ref: ref || null, by: staff.name, reason })
}

// Takes quantity of each item from its batches (soonest expiry first) and returns the deductions.
export function takeFromBatches(batchesByProduct, items, now, products) {
  const deductions = []
  for (const item of items) {
    const batches = batchesByProduct.get(item.productId) || []
    const allocations = allocateFefo(batches, item.quantity, now)
    if (!allocations) {
      const available = batches.filter((batch) => batch.quantity > 0).reduce((sum, batch) => sum + batch.quantity, 0)
      const name = products.find((product) => product.id === item.productId)?.name || item.name || 'This product'
      throw new RuleError('insufficient_stock', `Only ${available} × ${name} in stock (not expired). Record a delivery or adjust stock first.`)
    }
    for (const allocation of allocations) {
      const batch = batches.find((candidate) => candidate.id === allocation.batchId)
      batch.quantity -= allocation.quantity
      deductions.push({ productId: item.productId, batchId: batch.id, lot: batch.lot, quantity: allocation.quantity, unitCost: batch.unitCost ?? 0 })
    }
  }
  return deductions
}

// Takes `quantity` of a product back out of recorded deductions, latest first. Mutates `deductions`.
export function releaseDeductions(deductions, productId, quantity) {
  const released = []
  let remaining = quantity
  for (const deduction of [...deductions].reverse()) {
    if (!remaining) break
    if (deduction.productId !== productId || !deduction.quantity) continue
    const back = Math.min(deduction.quantity, remaining)
    released.push({ ...deduction, quantity: back })
    deduction.quantity -= back
    remaining -= back
  }
  return released
}

export function checkRequestId(requestId) {
  const id = String(requestId ?? '')
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new RuleError('bad_request', 'Please try again.')
  return id
}
