// IN-BROWSER SIMULATION of the future trusted operations server. DEMO ONLY.
//
// Every public method here stands in for one authenticated server command (Firebase callable function or
// HTTP endpoint) described in docs/OPERATIONS_IMPLEMENTATION_PLAN.md. They are written the way the server
// must behave so the UI can be exercised honestly:
//
//   * the acting staff member is looked up by id (and must be active) and their role re-checked on every call,
//   * when a staff member lacks a permission, a manager or the owner can approve on the spot with their PIN; the
//     server verifies the approver, their PIN and THEIR permission, and records both names,
//   * the UI sends only variant ids and quantities; prices are re-read from the catalog,
//   * each command runs against a copy of the state and commits all-or-nothing (a transaction),
//   * repeated commands with the same idempotency key / payment reference are harmless,
//   * stock moves by BATCH, first-expiry-first-out, and every deduction records its batch so a cancellation, return or
//     correction puts units back exactly where they came from and margin is costed from what those units cost,
//   * every accepted change appends to the audit log, and every stock change to the movement history.
//
// None of this is enforced by a real server yet. Replacing this file with a thin client over the real
// functions (same method names and arguments) is the Phase 3 integration step.

import { STATUS, findTransition } from '../lib/orderStates.js'
import { can, canAccessBranch, capability, ROLES } from '../lib/permissions.js'
import { allocateFefo, batchesAt, expiryStatus, isListed, onHand, stockDeltas } from '../lib/stock.js'
import { formatMoney, sumPesewas } from '../lib/money.js'
import { DAY, MINUTE, sameBusinessDay } from '../lib/time.js'
import { normalizePhone, displayPhone } from '../lib/customers.js'
import { chooseFulfilmentBranch } from '../lib/routing.js'
import { readWalkInSheet } from '../lib/walkInImport.js'
import { discountAmount, discountPercent, isValidBarcode, returnedQuantity, returnValue } from '../lib/pricing.js'
import { demoPinHash, isValidPin } from '../lib/demoPin.js'
import { actorRef, cleanCustomer, historyEntry, OpsError, priceLines, SYSTEM_ACTOR, variantIndex } from './records.js'
import { createSeedState, SEED_VERSION } from './seed.js'

export { OpsError }
export const HOLD_TTL_MS = 5 * MINUTE
export const RETURN_WINDOW_DAYS = 30
export const MOMO_NETWORKS = ['MTN', 'Telecel', 'AT']
export const RIDER_VEHICLES = ['Motorbike', 'Car', 'Van', 'Bicycle']

const publicStaff = ({ pinHash, ...member }) => ({ ...member, hasPin: Boolean(pinHash) })

export function createOpsStore({ now = () => Date.now(), storage = null, storageKey = 'skinmatrix-ops-demo', latencyMs = 0 } = {}) {
  let state = load() || createSeedState(now())
  const listeners = new Set()

  function load() {
    if (!storage) return null
    try {
      const parsed = JSON.parse(storage.getItem(storageKey) || 'null')
      return parsed?.version === SEED_VERSION ? parsed : null
    } catch {
      return null
    }
  }

  function commit(next) {
    state = next
    try { storage?.setItem(storageKey, JSON.stringify(state)) } catch { /* storage full or blocked: demo keeps running in memory */ }
    for (const listener of listeners) listener()
  }

  // Runs `command` against a deep copy. Throwing discards the copy, so a failed command changes nothing.
  async function transact(command) {
    if (latencyMs) await new Promise((resolve) => setTimeout(resolve, latencyMs))
    const draft = structuredClone(state)
    const tx = context(draft)
    const result = command(draft, tx)
    commit(draft)
    return result
  }

  function context(draft) {
    const at = now()
    return {
      at,
      audit(entry) {
        draft.counters.audit += 1
        draft.audit.unshift({ id: `AU-${draft.counters.audit}`, at, ...entry })
      },
      movement(entry) {
        draft.counters.movement += 1
        draft.movements.unshift({ id: `MV-${draft.counters.movement}`, at, reason: '', batchId: null, lot: null, ...entry })
      },
      // Stands in for verifying the caller's ID token and custom claims server-side.
      verify(actor) {
        const staff = draft.staff.find((member) => member.id === actor?.id)
        if (!staff) throw new OpsError('unauthenticated', 'Sign in again to continue.')
        if (staff.active === false) throw new OpsError('account_disabled', 'This staff account has been deactivated.')
        return staff
      },
      order(orderId) {
        const order = draft.orders.find((candidate) => candidate.id === orderId)
        if (!order) throw new OpsError('not_found', `Order ${orderId} was not found.`)
        return order
      },
    }
  }

  // check(staff) returns '' when that person may do the action, otherwise the reason they may not.
  // If the acting staff member may not, an approval { approverId, pin } from someone who may is required.
  function approveIfNeeded(draft, staff, approval, check) {
    const why = check(staff)
    if (!why) return null
    if (!approval) throw new OpsError('approval_required', `${why} A manager or the owner can approve with their PIN.`)
    const approver = draft.staff.find((member) => member.id === approval.approverId)
    if (!approver || approver.active === false || !can(approver, 'approve')) throw new OpsError('bad_approval', 'Choose an active manager or the owner to approve.')
    if (approver.id === staff.id) throw new OpsError('bad_approval', 'Someone else has to approve this.')
    // Production: server-side PIN check with a slow salted hash and a lockout after repeated failures.
    if (!approver.pinHash || approver.pinHash !== demoPinHash(approver.id, approval.pin)) throw new OpsError('bad_pin', `${approver.name}: that PIN is not right. Try again.`)
    const approverWhy = check(approver)
    if (approverWhy) throw new OpsError('forbidden', `${approver.name} cannot approve this either: ${approverWhy}`)
    return approver
  }

  function requireBranch(staff, branchId) {
    if (!state.branches.some((branch) => branch.id === branchId)) throw new OpsError('not_found', 'Unknown branch.')
    if (!canAccessBranch(staff, branchId)) throw new OpsError('forbidden', 'You can only act on your own branch.')
  }

  function requireReason(reason, label = 'reason') {
    const text = String(reason || '').trim()
    if (text.length < 5) throw new OpsError('reason_required', `Give a ${label} of at least a few words.`)
    return text.slice(0, 300)
  }

  function describe(draft, variantId) {
    const { product, variant } = variantIndex(draft.catalog).get(variantId)
    return `${product.name} (${variant.name})`
  }

  const batchById = (draft, batchId) => draft.batches.find((batch) => batch.id === batchId)

  // Takes each item from the branch's batches, soonest expiry first. Throws if any line cannot be supplied (the
  // whole draft is then discarded). Returns deductions [{ variantId, branchId, batchId, quantity }].
  function takeStock(draft, tx, items, branchId, kind, ref, actorName, reason = '') {
    const deductions = []
    for (const item of items) {
      if (!isListed(draft, item.variantId, branchId)) throw new OpsError('not_stocked', `${describe(draft, item.variantId)} is not stocked here.`)
      const allocations = allocateFefo(batchesAt(draft, item.variantId, branchId), item.quantity, tx.at)
      if (!allocations) throw new OpsError('insufficient_stock', `Only ${onHand(draft, item.variantId, branchId, tx.at)} × ${describe(draft, item.variantId)} left on the shelf.`)
      for (const allocation of allocations) {
        const batch = batchById(draft, allocation.batchId)
        batch.quantity -= allocation.quantity
        deductions.push({ variantId: item.variantId, branchId, batchId: batch.id, quantity: allocation.quantity })
        tx.movement({ variantId: item.variantId, branchId, batchId: batch.id, lot: batch.lot, delta: -allocation.quantity, kind, ref, actorName, reason })
      }
    }
    return deductions
  }

  function returnStock(draft, tx, deductions, kind, ref, actorName, reason = '') {
    for (const deduction of deductions) {
      const batch = batchById(draft, deduction.batchId)
      if (!batch) throw new OpsError('batch_missing', 'A recorded batch no longer exists; nothing was returned.')
      batch.quantity += deduction.quantity
      tx.movement({ variantId: deduction.variantId, branchId: deduction.branchId, batchId: batch.id, lot: batch.lot, delta: deduction.quantity, kind, ref, actorName, reason })
    }
  }

  // Takes `quantity` of a variant back out of an order's recorded deductions, most recent batch first.
  // Returns the released deductions; the order's list is updated in place.
  function releaseFromDeductions(order, variantId, quantity) {
    const released = []
    let remaining = quantity
    for (const deduction of [...order.stockDeductions].reverse()) {
      if (remaining === 0) break
      if (deduction.variantId !== variantId || deduction.quantity === 0) continue
      const back = Math.min(deduction.quantity, remaining)
      released.push({ ...deduction, quantity: back })
      deduction.quantity -= back
      remaining -= back
    }
    order.stockDeductions = order.stockDeductions.filter((deduction) => deduction.quantity > 0)
    return released
  }

  // Prices a cart and applies a cart-level discount. The discount limit is the caller's business.
  function priceSale(draft, lines, discountInput) {
    const { items, subtotal } = priceLines(draft.catalog, lines)
    if (!discountInput) return { items, subtotal, discount: null, total: subtotal }
    const amount = discountAmount(subtotal, discountInput)
    if (!amount) throw new OpsError('bad_discount', discountInput.type === 'percent' ? 'A discount must be between 1% and 100%.' : 'A discount must be more than zero and not more than the total.')
    const reason = String(discountInput.reason || '').trim()
    if (reason.length < 3) throw new OpsError('reason_required', 'Give a reason for the discount.')
    return { items, subtotal, discount: { type: discountInput.type, value: discountInput.value, amount, reason: reason.slice(0, 120), approvedBy: null }, total: subtotal - amount }
  }

  function discountCheck(sale) {
    if (!sale.discount) return () => ''
    const pct = discountPercent(sale.subtotal, sale.discount.amount)
    return (person) => (pct > capability(person, 'discountLimitPct') ? `Discounts over ${capability(person, 'discountLimitPct')}% need a manager.` : '')
  }

  function newPosOrder(draft, tx, { branchId, sale, customer, createdBy, payment, completedBy, completionReason, deductions }) {
    draft.counters.pos += 1
    const order = {
      id: `POS-${draft.counters.pos}`,
      channel: 'pos',
      branchId,
      createdAt: tx.at,
      completedAt: tx.at,
      createdBy,
      customer: cleanCustomer(customer),
      fulfilment: { method: 'counter', assigneeId: createdBy.id, rider: null },
      items: sale.items.map(({ allocations, ...item }) => item),
      subtotal: sale.subtotal,
      discount: sale.discount,
      total: sale.total,
      payment,
      status: STATUS.FULFILLED,
      statusHistory: [historyEntry({ at: tx.at, from: null, to: STATUS.FULFILLED, by: completedBy, reason: completionReason })],
      notes: [],
      corrections: [],
      returns: [],
      stockDeductions: deductions,
      restockedAt: null,
      needsBranch: false,
    }
    draft.orders.unshift(order)
    return order
  }

  function recordException(draft, tx, { reference, branchId, amount, kind, message }) {
    const existing = draft.exceptions.find((exception) => exception.reference === reference && exception.kind === kind)
    if (existing) return existing
    const exception = { reference, branchId, at: tx.at, amount, kind, message, status: 'open', resolution: null }
    draft.exceptions.unshift(exception)
    tx.audit({ type: 'payment_exception', actor: SYSTEM_ACTOR, branchId, ref: reference, summary: `Payment exception on ${reference}`, detail: message })
    return exception
  }

  function holdDeductions(hold) {
    return hold.items.flatMap((item) => item.allocations.map((allocation) => ({ variantId: item.variantId, branchId: hold.branchId, batchId: allocation.batchId, quantity: allocation.quantity })))
  }

  function releaseHold(draft, tx, hold, reason, actor) {
    if (hold.status !== 'reserved') return false
    returnStock(draft, tx, holdDeductions(hold), 'release', hold.reference, actor.name, reason)
    hold.status = 'released'
    hold.releaseReason = reason
    hold.closedAt = tx.at
    const units = hold.items.reduce((total, item) => total + item.quantity, 0)
    tx.audit({ type: 'hold_released', actor: actorRef(actor), branchId: hold.branchId, ref: hold.reference, summary: `MoMo hold ${hold.reference} ${reason}; ${units} unit${units === 1 ? '' : 's'} returned to shelf` })
    return true
  }

  function requireCounterStaff(tx, actor, branchId) {
    const staff = tx.verify(actor)
    if (!can(staff, 'pos')) throw new OpsError('forbidden', 'Your role cannot take counter sales.')
    requireBranch(staff, branchId)
    return staff
  }

  function auditApproval(tx, approver, staff, branchId, ref, summary, detail) {
    if (!approver) return
    tx.audit({ type: 'approval', actor: actorRef(approver), branchId, ref, summary: `${approver.name} approved for ${staff.name}: ${summary}`, detail })
  }

  function requireStaffManager(tx, actor) {
    const staff = tx.verify(actor)
    if (!can(staff, 'manageStaff')) throw new OpsError('forbidden', 'Only the owner manages staff accounts.')
    return staff
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    // ── Staff accounts ──────────────────────────────────────────────────────────────────────────

    // FUTURE SERVER CONTRACT: Firebase Auth sign-in (email + password, or PIN on a shared till) returning an ID token
    // with role claims. Deactivated accounts are refused.
    signIn(staffId, pin) {
      return transact((draft, tx) => {
        const staff = draft.staff.find((member) => member.id === staffId)
        if (!staff) throw new OpsError('not_found', 'Unknown staff member.')
        if (staff.active === false) throw new OpsError('account_disabled', 'This staff account has been deactivated.')
        if (!staff.pinHash || staff.pinHash !== demoPinHash(staff.id, pin)) throw new OpsError('bad_pin', 'That PIN is not right.')
        staff.lastActiveAt = tx.at
        tx.audit({ type: 'login', actor: actorRef(staff), branchId: staff.branchId, ref: null, summary: `${staff.name} signed in` })
        return publicStaff(staff)
      })
    },

    // FUTURE SERVER CONTRACT: createStaffAccount — owner only; creates the Auth user and sets role claims.
    createStaff(actor, { name, role, pin, phone }) {
      return transact((draft, tx) => {
        const owner = requireStaffManager(tx, actor)
        const cleanName = String(name || '').trim()
        if (cleanName.length < 2 || cleanName.length > 40) throw new OpsError('bad_name', 'Enter the staff member’s name.')
        if (!ROLES[role]) throw new OpsError('bad_role', 'Choose a role.')
        if (!isValidPin(pin)) throw new OpsError('bad_pin', 'A PIN is 4 to 6 digits.')
        const phoneKey = phone ? normalizePhone(phone) : null
        if (phone && !phoneKey) throw new OpsError('bad_phone', 'Enter a 10-digit phone number, or leave it empty.')
        draft.counters.staff += 1
        const id = `st-${draft.counters.staff}`
        const member = { id, name: cleanName, role, branchId: draft.branches[0].id, active: true, phone: phoneKey ? displayPhone(phoneKey) : '', pinHash: demoPinHash(id, pin), createdAt: tx.at, lastActiveAt: null }
        draft.staff.push(member)
        tx.audit({ type: 'staff_added', actor: actorRef(owner), branchId: null, ref: id, summary: `Added ${cleanName} as ${ROLES[role].label}` })
        return publicStaff(member)
      })
    },

    // FUTURE SERVER CONTRACT: updateStaffAccount — change role or deactivate/reactivate. Accounts are never deleted,
    // so the audit log keeps every name. The owner cannot lock themselves out, and there is always an active owner.
    updateStaff(actor, { staffId, role, active }) {
      return transact((draft, tx) => {
        const owner = requireStaffManager(tx, actor)
        const member = draft.staff.find((candidate) => candidate.id === staffId)
        if (!member) throw new OpsError('not_found', 'Unknown staff member.')
        if (member.id === owner.id) throw new OpsError('self_change', 'You cannot change your own role or deactivate yourself.')
        const nextRole = role ?? member.role
        const nextActive = active ?? member.active
        if (!ROLES[nextRole]) throw new OpsError('bad_role', 'Choose a role.')
        const owners = draft.staff.filter((candidate) => candidate.id !== member.id && candidate.role === 'owner' && candidate.active)
        if (member.role === 'owner' && (nextRole !== 'owner' || !nextActive) && !owners.length) throw new OpsError('last_owner', 'There must always be an active owner.')
        const changes = []
        if (nextRole !== member.role) changes.push(`role ${ROLES[member.role].label} → ${ROLES[nextRole].label}`)
        if (nextActive !== member.active) changes.push(nextActive ? 'reactivated' : 'deactivated')
        if (!changes.length) return publicStaff(member)
        member.role = nextRole
        member.active = nextActive
        tx.audit({ type: 'staff_updated', actor: actorRef(owner), branchId: null, ref: member.id, summary: `${member.name}: ${changes.join(', ')}` })
        return publicStaff(member)
      })
    },

    // FUTURE SERVER CONTRACT: setStaffPin — anyone may change their own PIN; the owner may reset anyone's.
    setStaffPin(actor, { staffId, pin }) {
      return transact((draft, tx) => {
        const staff = tx.verify(actor)
        if (staff.id !== staffId && !can(staff, 'manageStaff')) throw new OpsError('forbidden', 'You can only change your own PIN.')
        const member = draft.staff.find((candidate) => candidate.id === staffId)
        if (!member) throw new OpsError('not_found', 'Unknown staff member.')
        if (!isValidPin(pin)) throw new OpsError('bad_pin', 'A PIN is 4 to 6 digits.')
        member.pinHash = demoPinHash(member.id, pin)
        tx.audit({ type: 'staff_updated', actor: actorRef(staff), branchId: null, ref: member.id, summary: staff.id === member.id ? `${member.name} changed their PIN` : `PIN reset for ${member.name}` })
        return publicStaff(member)
      })
    },

    // ── Counter sales ───────────────────────────────────────────────────────────────────────────

    // FUTURE SERVER CONTRACT: posCounterSale — one transaction: verify staff, re-price, apply the discount (approved if
    // over the staff limit), take stock (first expiry first), create the completed POS order, append audit.
    //   payment: { method: 'cash', tendered }
    //          | { method: 'momo', amountReceived, reference, network }  — MoMo the customer sent to the shop's own number,
    //            recorded by the cashier from the confirmation message. A reference can only ever be recorded once.
    completeCounterSale(actor, { branchId, lines, customer, payment, discount, approval, idempotencyKey }) {
      return transact((draft, tx) => {
        const staff = requireCounterStaff(tx, actor, branchId)
        if (idempotencyKey && draft.idempotency[idempotencyKey]) return tx.order(draft.idempotency[idempotencyKey])
        const sale = priceSale(draft, lines, discount)
        const approver = approveIfNeeded(draft, staff, approval, discountCheck(sale))
        if (sale.discount) sale.discount.approvedBy = approver ? actorRef(approver) : null
        let record
        if (payment?.method === 'cash') {
          if (!Number.isSafeInteger(payment.tendered) || payment.tendered < sale.total) throw new OpsError('insufficient_tender', 'Cash received is less than the total.')
          record = { method: 'cash', state: 'paid', reference: null, tendered: payment.tendered, change: payment.tendered - sale.total }
        } else if (payment?.method === 'momo') {
          const reference = String(payment.reference || '').trim().toUpperCase()
          if (!/^[A-Z0-9.-]{6,30}$/.test(reference)) throw new OpsError('bad_reference', 'Enter the MoMo transaction ID from the confirmation message (6–30 letters or digits).')
          if (!MOMO_NETWORKS.includes(payment.network)) throw new OpsError('bad_network', 'Choose the mobile money network.')
          if (!Number.isSafeInteger(payment.amountReceived) || payment.amountReceived < sale.total) throw new OpsError('insufficient_tender', 'Amount received is less than the total.')
          const used = draft.orders.find((order) => String(order.payment.reference || '').toUpperCase() === reference)
          if (used) throw new OpsError('duplicate_reference', `MoMo reference ${reference} is already recorded on ${used.id}. A payment can only be used once.`)
          record = { method: 'momo', mode: 'recorded', state: 'paid', reference, network: payment.network, amountReceived: payment.amountReceived, change: payment.amountReceived - sale.total }
        } else {
          throw new OpsError('bad_payment', 'Choose how the customer paid.')
        }
        const deductions = takeStock(draft, tx, sale.items, branchId, 'sale', `POS-${draft.counters.pos + 1}`, staff.name)
        const order = newPosOrder(draft, tx, {
          branchId, sale, customer, deductions,
          createdBy: actorRef(staff),
          completedBy: actorRef(staff),
          completionReason: record.method === 'cash' ? 'Cash counter sale completed' : `MoMo to shop recorded · ${record.network} ${record.reference}`,
          payment: record,
        })
        if (idempotencyKey) draft.idempotency[idempotencyKey] = order.id
        tx.audit({ type: 'sale_created', actor: actorRef(staff), branchId, ref: order.id, summary: `${record.method === 'cash' ? 'Cash' : 'MoMo (to shop)'} counter sale ${order.id}${sale.discount ? ` · ${formatMoney(sale.discount.amount)} off` : ''}` })
        auditApproval(tx, approver, staff, branchId, order.id, `discount of ${formatMoney(sale.discount?.amount || 0)} on ${order.id}`, sale.discount?.reason)
        return order
      })
    },

    // FUTURE SERVER CONTRACT: posStartMomo — LIVE prompt: reserve the exact batches (off the shelf) in a transaction
    // that creates the hold, THEN ask the payment provider to charge the discounted total. No stock -> no charge.
    startMomoSale(actor, { branchId, lines, customer, payerPhone, network, discount, approval, idempotencyKey }) {
      return transact((draft, tx) => {
        const staff = requireCounterStaff(tx, actor, branchId)
        const repeat = idempotencyKey && draft.holds.find((hold) => hold.idempotencyKey === idempotencyKey)
        if (repeat) return repeat
        const phone = String(payerPhone || '').replace(/\D/g, '')
        if (!/^0\d{9}$/.test(phone)) throw new OpsError('bad_phone', 'Enter the 10-digit mobile money number, starting with 0.')
        if (!MOMO_NETWORKS.includes(network)) throw new OpsError('bad_network', 'Choose the mobile money network.')
        const sale = priceSale(draft, lines, discount)
        const approver = approveIfNeeded(draft, staff, approval, discountCheck(sale))
        if (sale.discount) sale.discount.approvedBy = approver ? actorRef(approver) : null
        draft.counters.momo += 1
        const reference = `DEMO-MOMO-${draft.counters.momo}`
        const deductions = takeStock(draft, tx, sale.items, branchId, 'reserve', reference, staff.name)
        const hold = {
          reference,
          branchId,
          items: sale.items.map((item) => ({ ...item, allocations: deductions.filter((deduction) => deduction.variantId === item.variantId).map(({ batchId, quantity }) => ({ batchId, quantity })) })),
          subtotal: sale.subtotal,
          discount: sale.discount,
          amount: sale.total,
          status: 'reserved',
          releaseReason: null,
          createdAt: tx.at,
          expiresAt: tx.at + HOLD_TTL_MS,
          closedAt: null,
          payer: { phone, network },
          customer: cleanCustomer(customer),
          createdBy: actorRef(staff),
          orderId: null,
          idempotencyKey: idempotencyKey || null,
        }
        draft.holds.unshift(hold)
        tx.audit({ type: 'hold_created', actor: actorRef(staff), branchId, ref: hold.reference, summary: `MoMo hold ${hold.reference} created; charge requested` })
        auditApproval(tx, approver, staff, branchId, hold.reference, `discount of ${formatMoney(sale.discount?.amount || 0)}`, sale.discount?.reason)
        return hold
      })
    },

    // FUTURE SERVER CONTRACT: payment webhook / verification — consume the reservation exactly once.
    // Anything without a usable reservation becomes a visible exception; it never creates a sale or moves stock.
    settleMomoPayment({ reference, amount }) {
      return transact((draft, tx) => {
        const hold = draft.holds.find((candidate) => candidate.reference === reference)
        if (!hold) {
          return { outcome: 'exception', exception: recordException(draft, tx, { reference, branchId: null, amount, kind: 'no_hold', message: 'Payment received for a reference with no stock hold. No sale was created.' }) }
        }
        if (hold.status === 'consumed') return { outcome: 'duplicate', order: tx.order(hold.orderId) }
        if (hold.status === 'released') {
          return { outcome: 'exception', exception: recordException(draft, tx, { reference, branchId: hold.branchId, amount, kind: 'hold_released', message: 'Payment confirmed after the stock hold was released. No sale was created and stock was not changed.' }) }
        }
        if (amount !== hold.amount) {
          return { outcome: 'exception', exception: recordException(draft, tx, { reference, branchId: hold.branchId, amount, kind: 'amount_mismatch', message: 'Amount received does not match the held total. No sale was created; the hold stays until it is released or expires.' }) }
        }
        const order = newPosOrder(draft, tx, {
          branchId: hold.branchId,
          sale: { items: hold.items, subtotal: hold.subtotal ?? hold.amount, discount: hold.discount || null, total: hold.amount },
          customer: hold.customer,
          createdBy: hold.createdBy,
          completedBy: SYSTEM_ACTOR,
          completionReason: 'Mobile money prompt payment verified',
          deductions: holdDeductions(hold),
          payment: { method: 'momo', mode: 'live', state: 'paid', reference: hold.reference, network: hold.payer.network, payerPhone: hold.payer.phone },
        })
        hold.status = 'consumed'
        hold.orderId = order.id
        hold.closedAt = tx.at
        tx.audit({ type: 'sale_created', actor: SYSTEM_ACTOR, branchId: hold.branchId, ref: order.id, summary: `MoMo (prompt) counter sale ${order.id} settled from ${hold.reference}` })
        return { outcome: 'sale', order }
      })
    },

    // FUTURE SERVER CONTRACT: posReleaseMomo — decline, cashier cancellation or expiry returns the exact
    // held batches exactly once. Releasing an already-closed hold is a no-op.
    releaseMomoHold(actor, { reference, reason }) {
      return transact((draft, tx) => {
        const hold = draft.holds.find((candidate) => candidate.reference === reference)
        if (!hold) throw new OpsError('not_found', 'That payment hold was not found.')
        let by = SYSTEM_ACTOR
        if (actor) {
          by = tx.verify(actor)
          requireBranch(by, hold.branchId)
        }
        if (!['declined', 'cancelled', 'expired'].includes(reason)) throw new OpsError('bad_reason', 'Unknown release reason.')
        return { released: releaseHold(draft, tx, hold, reason, by), hold }
      })
    },

    // FUTURE SERVER CONTRACT: scheduled expiry sweep.
    sweepExpiredHolds() {
      const due = state.holds.some((hold) => hold.status === 'reserved' && hold.expiresAt <= now())
      if (!due) return Promise.resolve(0)
      return transact((draft, tx) => {
        let released = 0
        for (const hold of draft.holds) {
          if (hold.status === 'reserved' && hold.expiresAt <= tx.at && releaseHold(draft, tx, hold, 'expired', SYSTEM_ACTOR)) released += 1
        }
        return released
      })
    },

    // ── Orders ──────────────────────────────────────────────────────────────────────────────────

    // FUTURE SERVER CONTRACT: setOrderStatus — validate actor, current state and reason; a cancellation or void by
    // staff needs a manager's PIN approval; restore the RECORDED batch deductions exactly once; append history.
    setOrderStatus(actor, { orderId, to, reason, approval }) {
      return transact((draft, tx) => {
        const staff = tx.verify(actor)
        const order = tx.order(orderId)
        if (order.status === to) return { order, restocked: false, unchanged: true }
        const edge = findTransition({ order, staff, now: tx.at }, to)
        if (!edge) throw new OpsError('invalid_transition', `An order cannot move from ${order.status} to ${to}.`)
        let approver = null
        if (!edge.allowed) {
          if (to !== STATUS.CANCELLED) throw new OpsError('forbidden', edge.why)
          approver = approveIfNeeded(draft, staff, approval, (person) => {
            const option = findTransition({ order, staff: person, now: tx.at }, to)
            return option?.allowed ? '' : `${option?.why || 'Not allowed'}.`
          })
        }
        const why = edge.requiresReason ? requireReason(reason) : String(reason || '').trim()
        const from = order.status
        let restocked = false

        if (to === STATUS.CANCELLED) {
          if (order.stockDeductions?.length && !order.restockedAt) {
            returnStock(draft, tx, order.stockDeductions, 'restock', order.id, staff.name, why)
            order.restockedAt = tx.at
            restocked = true
          }
          if (['paid', 'part_refunded'].includes(order.payment.state)) order.payment.state = order.payment.method === 'cash' ? 'refunded' : 'refund_due'
          else if (order.payment.state === 'pending') order.payment.state = 'cancelled'
        }
        if (to === STATUS.PROCESSING && !order.fulfilment.assigneeId) order.fulfilment.assigneeId = staff.id
        if (to === STATUS.FULFILLED) order.completedAt = tx.at

        order.status = to
        const note = why || (to === STATUS.OUT_FOR_DELIVERY ? `Rider: ${order.fulfilment.rider.name}` : '')
        order.statusHistory.push(historyEntry({ at: tx.at, from, to, by: actorRef(staff), reason: approver ? `${note} · approved by ${approver.name}` : note }))
        const isVoid = from === STATUS.FULFILLED && to === STATUS.CANCELLED
        tx.audit({
          type: isVoid ? 'void' : 'status_change',
          actor: actorRef(staff),
          branchId: order.branchId,
          ref: order.id,
          summary: isVoid ? `Voided ${order.id}${restocked ? '; stock restored' : ''}` : `${order.id}: ${from} → ${to}`,
          detail: why,
        })
        auditApproval(tx, approver, staff, order.branchId, order.id, `${isVoid ? 'void' : 'cancellation'} of ${order.id}`, why)
        return { order, restocked }
      })
    },

    // FUTURE SERVER CONTRACT: returnItems — part or all of a fulfilled, paid sale. Staff need a manager's PIN.
    // Resaleable units go back to the exact batches the sale took them from; damaged units do not return to the shelf.
    // The refund is the line's share of what the customer actually paid (after any discount). Money is recorded, not
    // moved: cash from the drawer, or a MoMo transfer back whose reference is recorded.
    returnItems(actor, { orderId, lines, condition, refundMethod, reference, reason, approval }) {
      return transact((draft, tx) => {
        const staff = tx.verify(actor)
        const order = tx.order(orderId)
        if (order.branchId) requireBranch(staff, order.branchId)
        if (order.status !== STATUS.FULFILLED) throw new OpsError('not_returnable', 'Only fulfilled sales can take a return. Cancel open orders instead.')
        if (!['paid', 'part_refunded'].includes(order.payment.state)) throw new OpsError('not_returnable', 'Nothing left to refund on this order.')
        const tooOld = tx.at - (order.completedAt ?? order.createdAt) > RETURN_WINDOW_DAYS * DAY
        const approver = approveIfNeeded(draft, staff, approval, (person) => {
          if (!can(person, 'returns')) return 'Returns need a manager.'
          if (tooOld && person.role !== 'owner') return `This sale is past the ${RETURN_WINDOW_DAYS}-day return window; only the owner can accept it.`
          return ''
        })
        if (!['resaleable', 'damaged'].includes(condition)) throw new OpsError('bad_condition', 'Say whether the items can go back on the shelf.')
        if (!['cash', 'momo'].includes(refundMethod)) throw new OpsError('bad_refund', 'Choose how the money goes back.')
        const refundRef = String(reference || '').trim().toUpperCase()
        if (refundMethod === 'momo' && !/^[A-Z0-9.-]{6,30}$/.test(refundRef)) throw new OpsError('bad_reference', 'Enter the transaction ID of the MoMo refund you sent.')
        const why = requireReason(reason)
        const wanted = (lines || []).filter((line) => line.quantity > 0)
        if (!wanted.length) throw new OpsError('empty_return', 'Choose at least one item to return.')
        for (const line of wanted) {
          const item = order.items.find((candidate) => candidate.variantId === line.variantId)
          if (!item || !Number.isInteger(line.quantity)) throw new OpsError('bad_line', 'A returned item is not on this order.')
          if (line.quantity > item.quantity - returnedQuantity(order, line.variantId)) throw new OpsError('too_many', `Only ${item.quantity - returnedQuantity(order, line.variantId)} × ${item.name} can still be returned.`)
        }
        const already = (order.returns || []).reduce((sum, entry) => sum + entry.amount, 0)
        const amount = Math.min(order.total - already, wanted.reduce((sum, line) => sum + returnValue(order, line.variantId, line.quantity), 0))
        for (const line of wanted) {
          const released = releaseFromDeductions(order, line.variantId, line.quantity)
          if (condition === 'resaleable') returnStock(draft, tx, released, 'return', order.id, staff.name, why)
        }
        draft.counters.return += 1
        const entry = { id: `RT-${draft.counters.return}`, at: tx.at, by: actorRef(staff), approvedBy: approver ? actorRef(approver) : null, lines: wanted.map(({ variantId, quantity }) => ({ variantId, quantity })), condition, amount, refundMethod, reference: refundMethod === 'momo' ? refundRef : null, reason: why }
        order.returns = [...(order.returns || []), entry]
        const fullyReturned = order.items.every((item) => returnedQuantity(order, item.variantId) >= item.quantity)
        order.payment.state = fullyReturned ? 'refunded' : 'part_refunded'
        const units = wanted.reduce((sum, line) => sum + line.quantity, 0)
        tx.audit({ type: 'return', actor: actorRef(staff), branchId: order.branchId, ref: order.id, summary: `Return on ${order.id}: ${units} unit${units === 1 ? '' : 's'} (${condition}), ${formatMoney(amount)} back by ${refundMethod === 'cash' ? 'cash' : 'MoMo'}`, detail: why })
        auditApproval(tx, approver, staff, order.branchId, order.id, `return of ${formatMoney(amount)} on ${order.id}`, why)
        return { order, entry }
      })
    },

    // FUTURE SERVER CONTRACT: addOrderNote — append-only.
    addOrderNote(actor, { orderId, text }) {
      return transact((draft, tx) => {
        const staff = tx.verify(actor)
        const order = tx.order(orderId)
        if (order.branchId) requireBranch(staff, order.branchId)
        const body = String(text || '').trim()
        if (!body) throw new OpsError('empty_note', 'Write a note first.')
        draft.counters.note += 1
        order.notes.push({ id: `N-${draft.counters.note}`, at: tx.at, by: actorRef(staff), text: body.slice(0, 500) })
        tx.audit({ type: 'note', actor: actorRef(staff), branchId: order.branchId, ref: order.id, summary: `Note added to ${order.id}` })
        return order
      })
    },

    // FUTURE SERVER CONTRACT: assignOrder — who is preparing/handing over an open order.
    assignOrder(actor, { orderId, assigneeId }) {
      return transact((draft, tx) => {
        const staff = tx.verify(actor)
        const order = tx.order(orderId)
        requireBranch(staff, order.branchId)
        if (!can(staff, 'progressOrders')) throw new OpsError('forbidden', 'Your role cannot assign orders.')
        if ([STATUS.FULFILLED, STATUS.CANCELLED].includes(order.status)) throw new OpsError('closed', 'This order is closed.')
        const assignee = draft.staff.find((member) => member.id === assigneeId && member.branchId === order.branchId && member.active)
        if (!assignee) throw new OpsError('bad_assignee', 'Choose an active staff member.')
        order.fulfilment.assigneeId = assignee.id
        tx.audit({ type: 'assignment', actor: actorRef(staff), branchId: order.branchId, ref: order.id, summary: `${order.id} assigned to ${assignee.name}` })
        return order
      })
    },

    // FUTURE SERVER CONTRACT: assignRider — delivery orders only.
    assignRider(actor, { orderId, rider }) {
      return transact((draft, tx) => {
        const staff = tx.verify(actor)
        const order = tx.order(orderId)
        requireBranch(staff, order.branchId)
        if (!can(staff, 'progressOrders')) throw new OpsError('forbidden', 'Your role cannot assign riders.')
        if (order.fulfilment.method !== 'delivery') throw new OpsError('not_delivery', 'Only delivery orders get a rider.')
        if ([STATUS.FULFILLED, STATUS.CANCELLED, STATUS.AWAITING_PAYMENT, STATUS.DRAFT].includes(order.status)) throw new OpsError('closed', 'A rider can only be assigned to a paid, open order.')
        const name = String(rider?.name || '').trim()
        const phone = normalizePhone(rider?.phone)
        if (name.length < 2) throw new OpsError('bad_rider', 'Enter the rider’s name.')
        if (!phone) throw new OpsError('bad_phone', 'Enter the rider’s 10-digit phone number.')
        if (!RIDER_VEHICLES.includes(rider?.vehicle)) throw new OpsError('bad_rider', 'Choose the vehicle.')
        order.fulfilment.rider = {
          name: name.slice(0, 60),
          phone: displayPhone(phone),
          vehicle: rider.vehicle,
          plate: String(rider.plate || '').trim().toUpperCase().slice(0, 16),
          company: String(rider.company || '').trim().slice(0, 60),
          assignedAt: tx.at,
          assignedBy: actorRef(staff),
        }
        tx.audit({ type: 'rider_assigned', actor: actorRef(staff), branchId: order.branchId, ref: order.id, summary: `Rider ${name} assigned to ${order.id}` })
        return order
      })
    },

    // FUTURE SERVER CONTRACT: assignOrderBranch — for a paid web order that was waiting for stock: take the stock now
    // (the manager does this once the delivery is on the shelf). Also the multi-branch "fulfil from" choice.
    assignOrderBranch(actor, { orderId, branchId, reason }) {
      return transact((draft, tx) => {
        const staff = tx.verify(actor)
        const order = tx.order(orderId)
        if (!can(staff, 'crossBranch')) throw new OpsError('forbidden', 'A manager takes stock for a waiting order.')
        requireBranch(staff, branchId)
        if ([STATUS.FULFILLED, STATUS.CANCELLED].includes(order.status)) throw new OpsError('closed', 'This order is closed.')
        if (order.stockDeductions) throw new OpsError('stock_taken', 'Stock was already taken for this order.')
        if (order.branchId === branchId) return order
        const why = requireReason(reason)
        if (order.payment.state === 'paid') order.stockDeductions = takeStock(draft, tx, order.items, branchId, 'sale', order.id, staff.name, why)
        order.branchId = branchId
        order.needsBranch = false
        order.fulfilment.assigneeId = null
        order.fulfilment.rider = null
        order.statusHistory.push(historyEntry({ at: tx.at, from: order.status, to: order.status, by: actorRef(staff), reason: `Stock taken for this order · ${why}` }))
        tx.audit({ type: 'assignment', actor: actorRef(staff), branchId, ref: order.id, summary: `Stock taken for waiting order ${order.id}`, detail: why })
        return order
      })
    },

    // FUTURE SERVER CONTRACT: correctPosSale — role- and day-bound (or approved by PIN), reasoned, before/after recorded,
    // and only the stock DIFFERENCE moves. The discount is kept (a percentage is re-applied to the new subtotal). A LIVE
    // mobile-money charge cannot have its total changed; a recorded MoMo sale can, like cash.
    correctPosSale(actor, { orderId, lines, reason, approval }) {
      return transact((draft, tx) => {
        const staff = tx.verify(actor)
        const order = tx.order(orderId)
        if (order.channel !== 'pos' || order.status !== STATUS.FULFILLED) throw new OpsError('not_correctable', 'Only completed counter sales can be corrected.')
        if ((order.returns || []).length) throw new OpsError('not_correctable', 'This sale already has a return. Use another return instead of a correction.')
        requireBranch(staff, order.branchId)
        const approver = approveIfNeeded(draft, staff, approval, (person) => {
          const rule = capability(person, 'correctPosSales')
          if (!rule) return 'Correcting a completed sale needs a manager.'
          if (rule === 'same_day' && !sameBusinessDay(order.completedAt, tx.at)) return 'Managers can only correct sales on the day they were made.'
          return ''
        })
        const why = requireReason(reason)

        const kept = (lines || []).filter((line) => line.quantity > 0)
        const priced = priceLines(draft.catalog, kept)
        const snapshotPrice = new Map(order.items.map((item) => [item.variantId, item.unitPrice]))
        const items = priced.items.map((item) => {
          const unitPrice = snapshotPrice.get(item.variantId) ?? item.unitPrice
          return { ...item, unitPrice, lineTotal: unitPrice * item.quantity }
        })
        const subtotal = sumPesewas(items, (item) => item.lineTotal)
        const discountValue = order.discount ? (order.discount.type === 'percent' ? Math.round((subtotal * order.discount.value) / 100) : Math.min(order.discount.amount, subtotal)) : 0
        const total = subtotal - discountValue
        const deltas = stockDeltas(order.items, items)
        if (!deltas.length) throw new OpsError('no_change', 'Nothing was changed.')
        if (order.payment.method === 'momo' && order.payment.mode === 'live' && total !== order.total) {
          throw new OpsError('live_charge_locked', 'This sale was charged by a live mobile-money prompt. Its total cannot be edited here; use a return.')
        }
        for (const { variantId, delta } of deltas) {
          if (delta > 0) order.stockDeductions.push(...takeStock(draft, tx, [{ variantId, quantity: delta }], order.branchId, 'correction', order.id, staff.name, why))
          else returnStock(draft, tx, releaseFromDeductions(order, variantId, -delta), 'correction', order.id, staff.name, why)
        }
        order.corrections.push({ at: tx.at, by: actorRef(staff), approvedBy: approver ? actorRef(approver) : null, reason: why, before: { items: order.items, total: order.total }, after: { items, total }, stockDeltas: deltas, balance: total - order.total })
        order.items = items
        order.subtotal = subtotal
        if (order.discount) order.discount = { ...order.discount, amount: discountValue }
        order.total = total
        tx.audit({ type: 'pos_correction', actor: actorRef(staff), branchId: order.branchId, ref: order.id, summary: `Corrected ${order.id}`, detail: why })
        auditApproval(tx, approver, staff, order.branchId, order.id, `correction of ${order.id}`, why)
        return order
      })
    },

    // ── Stock ───────────────────────────────────────────────────────────────────────────────────

    // FUTURE SERVER CONTRACT: adjustStock — reasoned, audited, per batch, never below zero.
    //   delta > 0: into an existing batch (batchId) or a new batch (newBatch: { lot, expiresOn|null }), costed at the
    //   variant's current cost. Supplier deliveries use receiveDelivery instead, which records the real unit cost.
    //   delta < 0: out of a named batch (batchId).
    adjustStock(actor, { variantId, branchId, delta, reason, batchId, newBatch }) {
      return transact((draft, tx) => {
        const staff = tx.verify(actor)
        if (!can(staff, 'adjustStock')) throw new OpsError('forbidden', 'Your role cannot adjust stock.')
        requireBranch(staff, branchId)
        const found = variantIndex(draft.catalog).get(variantId)
        if (!found) throw new OpsError('unknown_product', 'Unknown product.')
        if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 500) throw new OpsError('bad_quantity', 'Enter a whole number change between −500 and 500.')
        const why = requireReason(reason)
        let batch
        if (delta > 0 && newBatch) {
          const lot = String(newBatch.lot || '').trim().toUpperCase()
          if (!/^[A-Z0-9-]{2,20}$/.test(lot)) throw new OpsError('bad_lot', 'Enter the lot / batch number printed on the stock (2–20 letters or digits).')
          const expiresOn = newBatch.expiresOn || null
          if (found.product.tracksExpiry && !expiresOn) throw new OpsError('expiry_required', 'Enter the expiry date printed on the stock.')
          if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw new OpsError('bad_expiry', 'Expiry must be a date.')
          if (expiresOn && expiryStatus(expiresOn, tx.at) === 'expired') throw new OpsError('already_expired', 'That stock has already expired and cannot be put on the shelf.')
          draft.counters.batch += 1
          batch = { id: `B-${draft.counters.batch}`, variantId, branchId, lot, expiresOn, quantity: 0, receivedAt: tx.at, unitCost: found.variant.cost ?? 0, supplierId: null, deliveryId: null }
          draft.batches.push(batch)
        } else {
          batch = batchById(draft, batchId)
          if (!batch || batch.variantId !== variantId || batch.branchId !== branchId) throw new OpsError('bad_batch', 'Choose which batch this change applies to.')
        }
        const before = batch.quantity
        if (before + delta < 0) throw new OpsError('negative_stock', `Only ${before} in batch ${batch.lot}; cannot remove ${-delta}.`)
        batch.quantity += delta
        draft.listings[variantId] ||= {}
        draft.listings[variantId][branchId] = true
        tx.movement({ variantId, branchId, batchId: batch.id, lot: batch.lot, delta, kind: 'adjustment', ref: null, actorName: staff.name, reason: why })
        tx.audit({ type: 'stock_adjustment', actor: actorRef(staff), branchId, ref: found.variant.sku, summary: `Stock ${delta > 0 ? '+' : ''}${delta} · ${found.product.name} (${found.variant.sku}) · lot ${batch.lot}`, detail: why })
        return { variantId, branchId, batchId: batch.id, lot: batch.lot, before, after: batch.quantity }
      })
    },

    // FUTURE SERVER CONTRACT: writeOffExpired — removes every expired unit in one audited transaction.
    writeOffExpired(actor, { branchId }) {
      return transact((draft, tx) => {
        const staff = tx.verify(actor)
        if (!can(staff, 'adjustStock')) throw new OpsError('forbidden', 'Your role cannot write off stock.')
        requireBranch(staff, branchId)
        const index = variantIndex(draft.catalog)
        const expired = draft.batches.filter((batch) => batch.branchId === branchId && batch.quantity > 0 && expiryStatus(batch.expiresOn, tx.at) === 'expired')
        if (!expired.length) throw new OpsError('nothing_expired', 'Nothing expired is on the shelf.')
        let units = 0
        let worth = 0
        let cost = 0
        for (const batch of expired) {
          units += batch.quantity
          worth += batch.quantity * index.get(batch.variantId).variant.price
          cost += batch.quantity * (batch.unitCost ?? 0)
          tx.movement({ variantId: batch.variantId, branchId, batchId: batch.id, lot: batch.lot, delta: -batch.quantity, kind: 'write_off', ref: null, actorName: staff.name, reason: 'Expired — written off' })
          batch.quantity = 0
        }
        tx.audit({ type: 'stock_adjustment', actor: actorRef(staff), branchId, ref: null, summary: `Wrote off ${units} expired unit${units === 1 ? '' : 's'} (${expired.length} batch${expired.length === 1 ? '' : 'es'}, cost ${formatMoney(cost)})`, detail: 'Expired — written off' })
        return { units, worth, cost, batches: expired.length }
      })
    },

    // FUTURE SERVER CONTRACT: submitStockCount — the physical count. Refused as a whole if any batch changed since the
    // count sheet was opened (a sale happened mid-count). Differences are applied as 'count' movements and kept.
    submitStockCount(actor, { branchId, lines, note }) {
      return transact((draft, tx) => {
        const staff = tx.verify(actor)
        if (!can(staff, 'countStock')) throw new OpsError('forbidden', 'Your role cannot submit stock counts.')
        requireBranch(staff, branchId)
        if (!Array.isArray(lines) || !lines.length) throw new OpsError('empty_count', 'Count at least one line.')
        const stale = []
        for (const line of lines) {
          const batch = batchById(draft, line.batchId)
          if (!batch || batch.branchId !== branchId) throw new OpsError('bad_batch', 'A counted batch does not belong here.')
          if (!Number.isInteger(line.counted) || line.counted < 0 || line.counted > 9999) throw new OpsError('bad_quantity', 'Counts must be whole numbers.')
          if (batch.quantity !== line.expected) stale.push({ batchId: batch.id, lot: batch.lot, expected: line.expected, now: batch.quantity })
        }
        if (stale.length) {
          const error = new OpsError('stale_count', `Stock changed while you were counting (${stale.length} line${stale.length === 1 ? '' : 's'}, probably a sale). Those lines were refreshed — check them and submit again.`)
          error.stale = stale
          throw error
        }
        const differing = lines.filter((line) => line.counted !== line.expected)
        const why = differing.length ? requireReason(note, 'note') : String(note || '').trim()
        draft.counters.count += 1
        const id = `SC-${draft.counters.count}`
        for (const line of differing) {
          const batch = batchById(draft, line.batchId)
          const delta = line.counted - batch.quantity
          batch.quantity = line.counted
          tx.movement({ variantId: batch.variantId, branchId, batchId: batch.id, lot: batch.lot, delta, kind: 'count', ref: id, actorName: staff.name, reason: why })
        }
        const record = {
          id, branchId, at: tx.at, by: actorRef(staff), note: why,
          lines: lines.map((line) => ({ batchId: line.batchId, variantId: batchById(draft, line.batchId).variantId, lot: batchById(draft, line.batchId).lot, expected: line.expected, counted: line.counted })),
        }
        draft.stockCounts.unshift(record)
        const net = differing.reduce((sum, line) => sum + line.counted - line.expected, 0)
        tx.audit({ type: 'stock_take', actor: actorRef(staff), branchId, ref: id, summary: differing.length ? `Stock take: ${differing.length} line${differing.length === 1 ? '' : 's'} differed (${net > 0 ? '+' : ''}${net} unit${Math.abs(net) === 1 ? '' : 's'})` : `Stock take: all ${lines.length} lines matched`, detail: why })
        return record
      })
    },

    // ── Suppliers and deliveries ────────────────────────────────────────────────────────────────

    // FUTURE SERVER CONTRACT: saveSupplier — managers and the owner.
    saveSupplier(actor, { supplier }) {
      return transact((draft, tx) => {
        const staff = tx.verify(actor)
        if (!can(staff, 'receiveDeliveries')) throw new OpsError('forbidden', 'Your role cannot manage suppliers.')
        const name = String(supplier?.name || '').trim()
        if (name.length < 2) throw new OpsError('bad_name', 'Enter the supplier’s name.')
        const values = { name: name.slice(0, 60), contact: String(supplier.contact || '').trim().slice(0, 60), phone: String(supplier.phone || '').trim().slice(0, 20) }
        let record = supplier.id ? draft.suppliers.find((candidate) => candidate.id === supplier.id) : null
        if (supplier.id && !record) throw new OpsError('not_found', 'Unknown supplier.')
        if (record) Object.assign(record, values)
        else {
          draft.counters.supplier += 1
          record = { id: `sup-${draft.counters.supplier}`, active: true, ...values }
          draft.suppliers.push(record)
        }
        tx.audit({ type: 'supplier_saved', actor: actorRef(staff), branchId: null, ref: record.id, summary: `${supplier.id ? 'Updated' : 'Added'} supplier ${record.name}` })
        return record
      })
    },

    // FUTURE SERVER CONTRACT: receiveDelivery — each line becomes a new batch with its lot, expiry and UNIT COST (so
    // margin is costed per batch). The variant's current cost is updated to the latest cost paid.
    receiveDelivery(actor, { branchId, supplierId, invoiceRef, note, lines }) {
      return transact((draft, tx) => {
        const staff = tx.verify(actor)
        if (!can(staff, 'receiveDeliveries')) throw new OpsError('forbidden', 'Your role cannot receive deliveries.')
        requireBranch(staff, branchId)
        const supplier = draft.suppliers.find((candidate) => candidate.id === supplierId)
        if (!supplier) throw new OpsError('bad_supplier', 'Choose the supplier.')
        if (!Array.isArray(lines) || !lines.length) throw new OpsError('empty_delivery', 'Add at least one line.')
        const index = variantIndex(draft.catalog)
        draft.counters.delivery += 1
        const id = `DL-${draft.counters.delivery}`
        const recorded = []
        for (const [position, line] of lines.entries()) {
          const found = index.get(line.variantId)
          const label = `Line ${position + 1}`
          if (!found) throw new OpsError('unknown_product', `${label}: choose a product.`)
          if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 9999) throw new OpsError('bad_quantity', `${label}: enter how many arrived.`)
          if (!Number.isSafeInteger(line.unitCost) || line.unitCost < 0) throw new OpsError('bad_cost', `${label}: enter the cost per unit in GHS.`)
          const lot = String(line.lot || '').trim().toUpperCase()
          if (!/^[A-Z0-9-]{2,20}$/.test(lot)) throw new OpsError('bad_lot', `${label}: enter the lot / batch number printed on the stock.`)
          const expiresOn = line.expiresOn || null
          if (found.product.tracksExpiry && !expiresOn) throw new OpsError('expiry_required', `${label}: enter the expiry date for ${found.product.name}.`)
          if (expiresOn && expiryStatus(expiresOn, tx.at) === 'expired') throw new OpsError('already_expired', `${label}: that stock has already expired. Refuse it at the door.`)
          draft.counters.batch += 1
          const batch = { id: `B-${draft.counters.batch}`, variantId: line.variantId, branchId, lot, expiresOn, quantity: line.quantity, receivedAt: tx.at, unitCost: line.unitCost, supplierId, deliveryId: id }
          draft.batches.push(batch)
          draft.listings[line.variantId] ||= {}
          draft.listings[line.variantId][branchId] = true
          found.variant.cost = line.unitCost
          tx.movement({ variantId: line.variantId, branchId, batchId: batch.id, lot, delta: line.quantity, kind: 'delivery', ref: id, actorName: staff.name, reason: supplier.name })
          recorded.push({ variantId: line.variantId, batchId: batch.id, lot, expiresOn, quantity: line.quantity, unitCost: line.unitCost })
        }
        const delivery = { id, at: tx.at, by: actorRef(staff), supplierId, invoiceRef: String(invoiceRef || '').trim().slice(0, 40), note: String(note || '').trim().slice(0, 200), lines: recorded, totalCost: recorded.reduce((sum, line) => sum + line.quantity * line.unitCost, 0) }
        draft.deliveries.unshift(delivery)
        tx.audit({ type: 'delivery_received', actor: actorRef(staff), branchId, ref: id, summary: `Delivery ${id} from ${supplier.name}: ${recorded.length} line${recorded.length === 1 ? '' : 's'}, ${formatMoney(delivery.totalCost)}` })
        return delivery
      })
    },

    // ── Catalogue ───────────────────────────────────────────────────────────────────────────────

    // FUTURE SERVER CONTRACT: saveProduct — owner only. Creates or edits a product and its sizes. Sizes are never
    // deleted (orders and batches point at them); a product is archived instead, which hides it from the till and the
    // website. Price changes are kept in the price history. Orders keep their own snapshot and never change.
    saveProduct(actor, { product }) {
      return transact((draft, tx) => {
        const staff = tx.verify(actor)
        if (!can(staff, 'manageCatalog')) throw new OpsError('forbidden', 'Only the owner edits products and prices.')
        const name = String(product?.name || '').trim()
        const category = String(product?.category || '').trim()
        if (name.length < 2) throw new OpsError('bad_name', 'Enter the product name.')
        if (!category) throw new OpsError('bad_category', 'Enter a category.')
        if (!Number.isInteger(product.reorderPoint) || product.reorderPoint < 0 || product.reorderPoint > 999) throw new OpsError('bad_reorder', 'Reorder point must be a whole number.')
        if (!Array.isArray(product.variants) || !product.variants.length) throw new OpsError('no_variants', 'Add at least one size.')
        const existing = product.id ? draft.catalog.find((candidate) => candidate.id === product.id) : null
        if (product.id && !existing) throw new OpsError('not_found', 'Unknown product.')
        if (existing && product.variants.length < existing.variants.length) throw new OpsError('variant_removed', 'Sizes cannot be removed. Archive the product instead.')
        const others = draft.catalog.flatMap((entry) => entry.variants.map((variant) => ({ ...variant, productId: entry.id })))
        const seenSku = new Set()
        const seenBarcode = new Set()
        const variants = product.variants.map((input, position) => {
          const label = `Size ${position + 1}`
          const previous = existing?.variants.find((variant) => variant.id === input.id)
          if (input.id && existing && !previous) throw new OpsError('bad_variant', `${label}: unknown size.`)
          const variantName = String(input.name || '').trim()
          const sku = String(input.sku || '').trim().toUpperCase()
          const code = String(input.barcode || '').trim()
          if (!variantName) throw new OpsError('bad_variant', `${label}: enter the size or pack.`)
          if (!/^[A-Z0-9-]{3,20}$/.test(sku)) throw new OpsError('bad_sku', `${label}: SKU must be 3–20 letters, digits or dashes.`)
          if (seenSku.has(sku) || others.some((other) => other.sku === sku && other.id !== input.id)) throw new OpsError('duplicate_sku', `${label}: SKU ${sku} is already used.`)
          if (code && !isValidBarcode(code)) throw new OpsError('bad_barcode', `${label}: barcode ${code} is not valid (check the last digit).`)
          if (code && (seenBarcode.has(code) || others.some((other) => other.barcode === code && other.id !== input.id))) throw new OpsError('duplicate_barcode', `${label}: barcode ${code} is already used.`)
          if (!Number.isSafeInteger(input.price) || input.price <= 0) throw new OpsError('bad_price', `${label}: enter a selling price.`)
          if (input.cost !== null && input.cost !== undefined && (!Number.isSafeInteger(input.cost) || input.cost < 0)) throw new OpsError('bad_cost', `${label}: cost must be an amount in GHS.`)
          seenSku.add(sku)
          if (code) seenBarcode.add(code)
          return { id: previous?.id || `v-${sku.toLowerCase()}`, name: variantName.slice(0, 40), sku, barcode: code, price: input.price, cost: input.cost ?? null, previousPrice: previous?.price }
        })
        const fields = { name: name.slice(0, 80), category: category.slice(0, 40), reorderPoint: product.reorderPoint, walkInOnly: Boolean(product.walkInOnly), tracksExpiry: product.tracksExpiry !== false, active: product.active !== false }
        let entry = existing
        if (!entry) {
          draft.counters.product += 1
          entry = { id: `p-${skuSlug(variants[0])}-${draft.counters.product}`, variants: [] }
          draft.catalog.push(entry)
        }
        const changes = []
        if (existing && existing.active !== fields.active) changes.push(fields.active ? 'restored' : 'archived')
        if (existing && existing.walkInOnly !== fields.walkInOnly) changes.push(fields.walkInOnly ? 'hidden from website' : 'shown on website')
        Object.assign(entry, fields)
        entry.variants = variants.map(({ previousPrice, ...variant }) => {
          if (previousPrice !== undefined && previousPrice !== variant.price) {
            draft.priceHistory.unshift({ at: tx.at, by: actorRef(staff), variantId: variant.id, sku: variant.sku, from: previousPrice, to: variant.price })
            changes.push(`${variant.sku} ${formatMoney(previousPrice)} → ${formatMoney(variant.price)}`)
            tx.audit({ type: 'price_change', actor: actorRef(staff), branchId: null, ref: variant.sku, summary: `Price of ${fields.name} (${variant.name}) ${formatMoney(previousPrice)} → ${formatMoney(variant.price)}` })
          }
          if (!draft.listings[variant.id]) draft.listings[variant.id] = Object.fromEntries(draft.branches.map((branch) => [branch.id, true]))
          return variant
        })
        tx.audit({ type: 'product_saved', actor: actorRef(staff), branchId: null, ref: entry.id, summary: existing ? `Edited ${fields.name}${changes.length ? ` (${changes.join('; ')})` : ''}` : `Added product ${fields.name}` })
        return entry
      })
    },

    // FUTURE SERVER CONTRACT: importWalkInProducts — re-validates the raw sheet itself, adds only NEW SKUs as
    // counter-only products and records each opening batch (at the sheet's cost). Nothing existing is edited.
    importWalkInProducts(actor, { text }) {
      return transact((draft, tx) => {
        const staff = tx.verify(actor)
        if (!can(staff, 'manageCatalog')) throw new OpsError('forbidden', 'Only the owner adds products.')
        const existingSkus = new Set(draft.catalog.flatMap((entry) => entry.variants.map((variant) => variant.sku)))
        const sheet = readWalkInSheet(text, { branches: draft.branches, existingSkus })
        if (sheet.problems.length) throw new OpsError('bad_sheet', sheet.problems.join(' '))
        const good = sheet.rows.filter((row) => row.ok)
        if (!good.length) throw new OpsError('nothing_to_import', 'No valid rows to import.')
        const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
        let variants = 0
        for (const { value } of good) {
          const key = `${value.name.toLowerCase()}|${value.category.toLowerCase()}`
          let entry = draft.catalog.find((candidate) => candidate.walkInOnly && `${candidate.name.toLowerCase()}|${candidate.category.toLowerCase()}` === key)
          if (!entry) {
            let id = `p-wi-${slug(value.name)}`
            while (draft.catalog.some((candidate) => candidate.id === id)) id += '-x'
            entry = { id, name: value.name, category: value.category, reorderPoint: value.reorderPoint, walkInOnly: true, tracksExpiry: value.tracksExpiry, active: true, variants: [] }
            draft.catalog.push(entry)
          }
          const variantId = `v-wi-${slug(value.sku)}`
          entry.variants.push({ id: variantId, name: value.variantName, sku: value.sku, barcode: value.barcode || '', price: value.price, cost: value.cost })
          variants += 1
          draft.listings[variantId] = {}
          for (const [branchId, quantity] of Object.entries(value.quantities)) {
            draft.listings[variantId][branchId] = true
            if (!quantity) continue
            draft.counters.batch += 1
            const batch = { id: `B-${draft.counters.batch}`, variantId, branchId, lot: value.lot, expiresOn: value.expiresOn, quantity, receivedAt: tx.at, unitCost: value.cost ?? 0, supplierId: null, deliveryId: null }
            draft.batches.push(batch)
            tx.movement({ variantId, branchId, batchId: batch.id, lot: batch.lot, delta: quantity, kind: 'opening', ref: null, actorName: staff.name, reason: 'Opening stock (walk-in import)' })
          }
        }
        tx.audit({ type: 'walk_in_import', actor: actorRef(staff), branchId: null, ref: null, summary: `Imported ${variants} walk-in item${variants === 1 ? '' : 's'}`, detail: `${sheet.rows.length - good.length} row(s) skipped` })
        return { imported: variants, skipped: sheet.rows.filter((row) => !row.ok).map((row) => ({ line: row.line, errors: row.errors })) }
      })
    },

    // FUTURE SERVER CONTRACT: resolvePaymentException — records the human resolution only.
    resolveException(actor, { reference, kind, note }) {
      return transact((draft, tx) => {
        const staff = tx.verify(actor)
        if (!can(staff, 'resolveExceptions')) throw new OpsError('forbidden', 'A manager resolves payment exceptions.')
        const exception = draft.exceptions.find((candidate) => candidate.reference === reference && candidate.kind === kind)
        if (!exception) throw new OpsError('not_found', 'Exception not found.')
        if (exception.status !== 'open') return exception
        const why = requireReason(note, 'note')
        exception.status = 'resolved'
        exception.resolution = { at: tx.at, by: actorRef(staff), note: why }
        tx.audit({ type: 'exception_resolved', actor: actorRef(staff), branchId: exception.branchId, ref: reference, summary: `Payment exception ${reference} resolved`, detail: why })
        return exception
      })
    },

    // DEMO ONLY: a customer checks out on the website and pays. The server takes the shop's stock; if the shop cannot
    // supply every item, the order waits (no stock taken) until a manager takes stock for it after a delivery.
    simulateWebOrder() {
      return transact((draft, tx) => {
        const variants = draft.catalog.filter((entry) => !entry.walkInOnly && entry.active !== false).flatMap((entry) => entry.variants)
        const pickOne = (list) => list[Math.floor(Math.random() * list.length)]
        const lines = [...new Map(Array.from({ length: 1 + Math.floor(Math.random() * 2) }, () => [pickOne(variants).id, 1 + Math.floor(Math.random() * 2)])).entries()].map(([variantId, quantity]) => ({ variantId, quantity }))
        const { items, subtotal } = priceLines(draft.catalog, lines)
        const branchId = chooseFulfilmentBranch(draft, items, tx.at)
        draft.counters.web += 1
        const order = {
          id: `WEB-${draft.counters.web}`, channel: 'web', branchId, createdAt: tx.at, completedAt: null, createdBy: null,
          customer: { name: pickOne(['Abena Y.', 'Kofi D.', 'Efe A.', 'Akua B.', 'Delali K.']), phone: `024${String(1000000 + Math.floor(Math.random() * 8999999))}`, email: '' },
          fulfilment: { method: Math.random() < 0.6 ? 'delivery' : 'pickup', assigneeId: null, rider: null },
          items, subtotal, discount: null, total: subtotal,
          payment: { method: Math.random() < 0.7 ? 'momo' : 'card', mode: 'live', state: 'paid', reference: `DEMO-PAY-${draft.counters.web}` },
          status: STATUS.PAID,
          statusHistory: [historyEntry({ at: tx.at, from: STATUS.AWAITING_PAYMENT, to: STATUS.PAID, by: SYSTEM_ACTOR, reason: branchId ? 'Payment verified · stock reserved from the shop' : 'Payment verified · not enough stock for every item' })],
          notes: [], corrections: [], returns: [], stockDeductions: null, restockedAt: null, needsBranch: !branchId,
        }
        if (branchId) order.stockDeductions = takeStock(draft, tx, items, branchId, 'sale', order.id, SYSTEM_ACTOR.name)
        draft.orders.unshift(order)
        tx.audit({ type: 'web_order', actor: SYSTEM_ACTOR, branchId, ref: order.id, summary: branchId ? `New web order ${order.id}` : `New web order ${order.id} is waiting for stock` })
        return order
      })
    },

    resetDemo() {
      commit(createSeedState(now()))
    },
  }
}

const skuSlug = (variant) => variant.sku.toLowerCase()
