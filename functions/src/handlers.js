// Every command the admin can send. Each one checks who is asking (their staff profile, not the device),
// re-reads prices from the catalogue, and changes sales, stock and the audit log together in one Firestore
// transaction, so a failed command changes nothing.
import { randomBytes } from 'node:crypto'
import { can, DISCOUNT_LIMIT, isValidPin, RETURN_WINDOW_DAYS, requireReason, ROLE_LABEL, ROLES, RuleError } from './core/rules.js'
import { checkExpiry, checkLot } from './core/stock.js'
import { applyDiscount, checkOffline, checkPayment, cleanCustomer, discountNeedsApproval, isValidBarcode, priceCart, returnedQuantity, returnValue } from './core/sale.js'
import { businessDay, DAY } from './core/time.js'
import { taxBreakdown } from './core/tax.js'
import { readSettings } from './settings.js'
import { addCash, readOpenShift, requireShift } from './shifts.js'
import { sendSms, smsText } from './sms.js'
import { notifyCustomer } from './web.js'
import { actorRef, approvalCheck, audit, checkRequestId, hashPin, movement, pad, readAvailability, readBatches, readCatalog, releaseDeductions, requireStaff, takeFromBatches, verifyApproval, writeBatch, writeStock } from './shared.js'

// ── Sales at the till ─────────────────────────────────────────────────────────────────────────

export async function completeSale(ctx, data) {
  const { db, uid, now } = ctx
  const staff = await requireStaff(db, uid, 'sell')
  const requestId = checkRequestId(data?.requestId)
  const offline = checkOffline(data?.offline, now)
  const discountCheck = (subtotal, amount) => (person) => (discountNeedsApproval(person.role, subtotal, amount) ? `Discounts over ${DISCOUNT_LIMIT[person.role]}% need approval.` : '')

  // Work out whether an approval is needed before the transaction, so the PIN is checked once.
  const catalog = (await db.doc('site/catalog').get()).data()?.products || []
  const { subtotal: previewSubtotal } = priceCart(catalog, data?.lines)
  const preview = { subtotal: previewSubtotal, amount: applyDiscount(previewSubtotal, data?.discount)?.amount || 0 }
  const approver = discountNeedsApproval(staff.role, preview.subtotal, preview.amount)
    ? await verifyApproval(db, data?.approval, staff, discountCheck(preview.subtotal, preview.amount), now)
    : null

  let created = false
  const result = await db.runTransaction(async (tx) => {
    const requestRef = db.doc(`requests/${uid}_${requestId}`)
    const request = await tx.get(requestRef)
    if (request.exists) return request.data().result
    const products = await readCatalog(tx, db)
    const settings = await readSettings(db, tx)
    const { items, subtotal } = priceCart(products, data?.lines)
    const discount = applyDiscount(subtotal, data?.discount)
    const approvedBy = approvalCheck(staff, approver, discountCheck(subtotal, discount?.amount || 0))
    const priced = subtotal - (discount?.amount || 0)
    // A sale made while the till was offline keeps the total the customer actually paid. If a price changed in
    // the meantime, the difference is recorded on the sale (and in the activity log) for a manager to review.
    const adjustment = offline ? priced - offline.clientTotal : 0
    const total = priced - adjustment
    const payment = checkPayment(data?.payment, total)
    const customer = cleanCustomer(data?.customer)
    const batchesByProduct = await readBatches(tx, db, items.map((item) => item.productId))
    const availability = await readAvailability(tx, db)
    const counterRef = db.doc('counters/sales')
    const next = ((await tx.get(counterRef)).data()?.value ?? 0) + 1
    if (payment.reference && payment.method === 'momo') {
      const used = await tx.get(db.collection('sales').where('payment.reference', '==', payment.reference).limit(1))
      if (!used.empty) throw new RuleError('duplicate_reference', `MoMo transaction ${payment.reference} was already used for sale ${used.docs[0].data().number}. One payment can only pay for one sale.`)
    }
    // Cash goes into the cashier's drawer. An offline sale goes into the drawer that was open when it was made.
    let shift = null
    let late = false
    if (payment.method === 'cash') {
      if (offline?.shiftId) {
        const snap = await tx.get(db.doc(`shifts/${offline.shiftId}`))
        if (snap.exists && snap.data().cashier?.uid === uid) {
          shift = { ...snap.data(), id: snap.id }
          late = shift.status !== 'open'
        }
      }
      if (!shift) shift = requireShift(await readOpenShift(tx, db, uid))
    }

    const deductions = takeFromBatches(batchesByProduct, items, now, products)
    const id = `S${pad(next)}`
    const at = offline ? offline.at : now
    const sale = {
      id, number: next, at, day: businessDay(at), status: 'completed',
      cashier: actorRef(staff), customer, items, subtotal,
      discount: discount ? { ...discount, approvedBy } : null, total, payment,
      tax: taxBreakdown(total, settings.tax),
      shiftId: shift?.id || null,
      offline: offline ? { at: offline.at, syncedAt: now, clientTotal: offline.clientTotal, adjustment } : null,
      deductions: deductions.map(({ unitCost, ...deduction }) => deduction), returns: [], void: null,
    }
    tx.set(counterRef, { value: next })
    tx.set(db.doc(`sales/${id}`), sale)
    tx.set(db.doc(`saleCosts/${id}`), { cost: deductions.reduce((sum, deduction) => sum + deduction.quantity * deduction.unitCost, 0), day: sale.day, at })
    for (const batches of batchesByProduct.values()) for (const batch of batches) if (deductions.some((deduction) => deduction.batchId === batch.id)) writeBatch(tx, db, batch)
    for (const deduction of deductions) movement(tx, db, now, staff, { productId: deduction.productId, batch: { id: deduction.batchId, lot: deduction.lot }, delta: -deduction.quantity, kind: 'sale', ref: id })
    writeStock(tx, db, batchesByProduct, availability, now)
    if (shift) addCash(tx, db, shift, { sale: total, late })
    const notes = [
      discount ? `Discount ${discount.reason}${approvedBy ? `, approved by ${approvedBy.name}` : ''}` : '',
      offline ? `Made offline, synced later${adjustment ? `; price changed while offline, ${adjustment > 0 ? 'customer paid' : 'customer overpaid by'} ${(Math.abs(adjustment) / 100).toFixed(2)} GHS${adjustment > 0 ? ' less than today’s price' : ''}` : ''}` : '',
      late ? 'Cash counted after the drawer was closed' : '',
    ].filter(Boolean).join(' · ')
    audit(tx, db, now, staff, 'sale', id, `Sale ${next}: ${items.length} item${items.length === 1 ? '' : 's'}, ${payment.method}`, notes)
    const fresh = { sale }
    tx.set(requestRef, { at: now, result: fresh })
    created = true
    return fresh
  })

  if (created) await sendSaleReceipt(ctx, result.sale)
  return result
}

// Texts the receipt to the customer when the owner turned that on and the cashier typed a phone number.
async function sendSaleReceipt(ctx, sale) {
  if (!sale.customer?.phone) return
  try {
    const settings = await readSettings(ctx.db)
    if (!settings.sms.saleReceipt) return
    const shop = (await ctx.db.doc('site/content').get()).data()?.shop || {}
    await sendSms(ctx, settings, { to: sale.customer.phone, kind: 'sale_receipt', ref: sale.id, text: smsText('sale_receipt', { number: sale.number, total: sale.total, shopName: shop.legalName || 'SkinMatrix' }) })
  } catch { /* a text never undoes a sale */ }
}

const sameDay = (sale, now) => sale.day === businessDay(now)

export async function voidSale({ db, uid, now }, data) {
  const staff = await requireStaff(db, uid, 'sell')
  const reason = requireReason(data?.reason)
  const saleRef = db.doc(`sales/${String(data?.saleId ?? '')}`)
  const first = await saleRef.get()
  if (!first.exists) throw new RuleError('not_found', 'Sale not found.')
  const check = (person) => {
    if (!can(person.role, 'void')) return 'Cancelling a sale needs a manager.'
    if (!sameDay(first.data(), now) && !can(person.role, 'voidAnyDay')) return 'Only the owner can cancel a sale from an earlier day. For a customer return, use Return items.'
    return ''
  }
  const approver = check(staff) ? await verifyApproval(db, data?.approval, staff, check, now) : null

  return db.runTransaction(async (tx) => {
    const sale = (await tx.get(saleRef)).data()
    if (sale.status !== 'completed') throw new RuleError('already_voided', 'This sale is already cancelled.')
    const approvedBy = approvalCheck(staff, approver, check)
    const batchesByProduct = await readBatches(tx, db, sale.items.map((item) => item.productId))
    const availability = await readAvailability(tx, db)
    const refund = sale.total - (sale.returns || []).reduce((sum, entry) => sum + entry.amount, 0)
    // Cash given back comes out of the drawer of whoever hands it over.
    const shift = sale.payment.method === 'cash' && refund > 0 ? requireShift(await readOpenShift(tx, db, uid)) : null
    for (const deduction of sale.deductions) {
      const batch = batchesByProduct.get(deduction.productId)?.find((candidate) => candidate.id === deduction.batchId)
      if (!batch) throw new RuleError('batch_missing', 'A batch this sale used no longer exists. Ask the developer.')
      batch.quantity += deduction.quantity
      writeBatch(tx, db, batch)
      movement(tx, db, now, staff, { productId: deduction.productId, batch, delta: deduction.quantity, kind: 'void', ref: sale.id, reason })
    }
    writeStock(tx, db, batchesByProduct, availability, now)
    if (shift) addCash(tx, db, shift, { refund })
    const voided = { at: now, by: actorRef(staff), approvedBy, reason, refund, refundMethod: sale.payment.method }
    tx.update(saleRef, { status: 'voided', void: voided, deductions: [] })
    audit(tx, db, now, staff, 'void', sale.id, `Cancelled sale ${sale.number}; ${sale.deductions.reduce((sum, deduction) => sum + deduction.quantity, 0)} units back in stock`, `${reason}${approvedBy ? ` · approved by ${approvedBy.name}` : ''}`)
    return { saleId: sale.id, refund }
  })
}

export async function returnItems({ db, uid, now }, data) {
  const staff = await requireStaff(db, uid, 'sell')
  const saleRef = db.doc(`sales/${String(data?.saleId ?? '')}`)
  const first = await saleRef.get()
  if (!first.exists) throw new RuleError('not_found', 'Sale not found.')
  const tooOld = now - first.data().at > RETURN_WINDOW_DAYS * DAY
  const check = (person) => {
    if (!can(person.role, 'return')) return 'Returns need a manager.'
    if (tooOld && person.role !== 'owner') return `This sale is older than ${RETURN_WINDOW_DAYS} days; only the owner can accept the return.`
    return ''
  }
  const approver = check(staff) ? await verifyApproval(db, data?.approval, staff, check, now) : null
  const condition = data?.condition
  if (!['resaleable', 'damaged'].includes(condition)) throw new RuleError('bad_condition', 'Say whether the items can go back on the shelf.')
  const refundMethod = data?.refundMethod
  if (!['cash', 'momo', 'card'].includes(refundMethod)) throw new RuleError('bad_refund', 'Choose how the money goes back.')
  const reference = String(data?.reference ?? '').trim().toUpperCase()
  if (refundMethod === 'momo' && !/^[A-Z0-9.-]{6,30}$/.test(reference)) throw new RuleError('bad_reference', 'Type the transaction ID of the MoMo you sent back.')
  const reason = requireReason(data?.reason)

  return db.runTransaction(async (tx) => {
    const sale = (await tx.get(saleRef)).data()
    if (sale.status !== 'completed') throw new RuleError('not_returnable', 'This sale was cancelled.')
    const approvedBy = approvalCheck(staff, approver, check)
    const lines = (Array.isArray(data?.lines) ? data.lines : []).filter((line) => line?.quantity > 0)
    if (!lines.length) throw new RuleError('empty_return', 'Choose at least one item to return.')
    for (const line of lines) {
      const item = sale.items.find((candidate) => candidate.productId === line.productId)
      if (!item || !Number.isInteger(line.quantity)) throw new RuleError('bad_line', 'A returned item is not on this sale.')
      const left = item.quantity - returnedQuantity(sale, line.productId)
      if (line.quantity > left) throw new RuleError('too_many', `Only ${left} × ${item.name} can still be returned.`)
    }
    const batchesByProduct = await readBatches(tx, db, lines.map((line) => line.productId))
    const availability = await readAvailability(tx, db)
    const shift = refundMethod === 'cash' ? requireShift(await readOpenShift(tx, db, uid)) : null
    const already = (sale.returns || []).reduce((sum, entry) => sum + entry.amount, 0)
    const amount = Math.min(sale.total - already, lines.reduce((sum, line) => sum + returnValue(sale, line.productId, line.quantity), 0))
    const deductions = sale.deductions.map((deduction) => ({ ...deduction }))
    for (const line of lines) {
      const released = releaseDeductions(deductions, line.productId, line.quantity)
      if (condition !== 'resaleable') continue
      for (const piece of released) {
        const batch = batchesByProduct.get(line.productId)?.find((candidate) => candidate.id === piece.batchId)
        if (!batch) continue
        batch.quantity += piece.quantity
        writeBatch(tx, db, batch)
        movement(tx, db, now, staff, { productId: line.productId, batch, delta: piece.quantity, kind: 'return', ref: sale.id, reason })
      }
    }
    if (condition === 'resaleable') writeStock(tx, db, batchesByProduct, availability, now)
    if (shift && amount > 0) addCash(tx, db, shift, { refund: amount })
    const entry = { at: now, by: actorRef(staff), approvedBy, lines: lines.map(({ productId, quantity }) => ({ productId, quantity })), condition, amount, refundMethod, reference: reference || null, reason }
    tx.update(saleRef, { returns: [...(sale.returns || []), entry], deductions: deductions.filter((deduction) => deduction.quantity > 0) })
    audit(tx, db, now, staff, 'return', sale.id, `Return on sale ${sale.number}: ${lines.reduce((sum, line) => sum + line.quantity, 0)} unit(s), ${condition === 'resaleable' ? 'back on the shelf' : 'damaged'}`, `${reason}${approvedBy ? ` · approved by ${approvedBy.name}` : ''}`)
    return { saleId: sale.id, amount }
  })
}

// ── Website orders ────────────────────────────────────────────────────────────────────────────

const WEB_FLOW = {
  confirm: { from: ['new'], to: 'confirmed' },
  ready: { from: ['confirmed'], to: 'ready' },
  out_for_delivery: { from: ['confirmed'], to: 'out_for_delivery' },
  complete: { from: ['ready', 'out_for_delivery'], to: 'completed' },
  cancel: { from: ['new', 'confirmed', 'ready', 'out_for_delivery'], to: 'cancelled' },
}

const ORDER_SMS = { confirmed: 'order_confirmed', ready: 'order_ready', out_for_delivery: 'order_out_for_delivery', cancelled: 'order_cancelled' }

export async function updateWebOrder(ctx, data) {
  const { db, uid, now } = ctx
  const staff = await requireStaff(db, uid, 'webOrders')
  const orderRef = db.doc(`orders/${String(data?.orderId ?? '')}`)
  const first = await orderRef.get()
  if (!first.exists) throw new RuleError('not_found', 'Order not found.')
  const action = data?.action
  const check = (person) => (action === 'cancel' && first.data().stockTaken?.length && !can(person.role, 'void') ? 'Cancelling a confirmed order needs a manager.' : '')
  const approver = check(staff) ? await verifyApproval(db, data?.approval, staff, check, now) : null

  const result = await db.runTransaction(async (tx) => {
    const order = (await tx.get(orderRef)).data()
    const payment = order.payment || {}
    if (action === 'payment_checked' || action === 'paid_offline') {
      if (action === 'payment_checked' && !(payment.status === 'reported' || (payment.status === 'mismatch' && can(staff.role, 'approve')))) throw new RuleError('bad_state', 'There is no online payment to check.')
      if (action === 'paid_offline' && !['unpaid', 'pending', undefined].includes(payment.status)) throw new RuleError('bad_state', 'This order is already marked as paid.')
      const status = action === 'payment_checked' ? 'confirmed' : 'paid_offline'
      // This is an accountable manual Paystack check, not a claim that the
      // browser verified a payment. The saved staff identity and time make the
      // verification trail visible to the owner in the order record.
      const checked = { checkedAt: now, checkedBy: actorRef(staff) }
      tx.update(orderRef, { payment: { ...payment, status, ...checked }, updatedAt: now, updatedBy: uid })
      audit(tx, db, now, staff, 'web_payment', order.ref, `Website order ${order.ref}: ${action === 'payment_checked' ? 'Paystack payment checked' : 'paid in cash or MoMo'}`)
      return { status: order.status }
    }
    const step = WEB_FLOW[action]
    if (!step) throw new RuleError('bad_action', 'Unknown step.')
    if (!step.from.includes(order.status)) throw new RuleError('bad_state', `This order is ${order.status.replace(/_/g, ' ')} and cannot be moved that way.`)
    if (step.to === 'out_for_delivery' && order.fulfilment?.method !== 'delivery') throw new RuleError('bad_state', 'This is a pickup order.')
    if (step.to === 'ready' && order.fulfilment?.method !== 'pickup') throw new RuleError('bad_state', 'This is a delivery order.')
    if (action === 'confirm' && payment.status === 'pending') throw new RuleError('awaiting_payment', 'The customer has not finished paying on Paystack yet. Call them, or wait for the payment. If they will pay in cash or MoMo instead, press “Customer paid” first.')
    const approvedBy = approvalCheck(staff, approver, check)
    const reason = action === 'cancel' ? requireReason(data?.reason) : ''
    const patch = { status: step.to, updatedAt: now, updatedBy: uid }

    if (action === 'confirm' || (action === 'cancel' && order.stockTaken?.length)) {
      const productIds = (order.lines || []).map((line) => line.id)
      const products = action === 'confirm' ? await readCatalog(tx, db) : []
      const batchesByProduct = await readBatches(tx, db, productIds)
      const availability = await readAvailability(tx, db)
      if (action === 'confirm') {
        const items = (order.lines || []).map((line) => ({ productId: line.id, name: line.name, quantity: line.qty }))
        const deductions = takeFromBatches(batchesByProduct, items, now, products)
        for (const deduction of deductions) movement(tx, db, now, staff, { productId: deduction.productId, batch: { id: deduction.batchId, lot: deduction.lot }, delta: -deduction.quantity, kind: 'web_order', ref: order.ref })
        patch.stockTaken = deductions.map(({ unitCost, ...deduction }) => deduction)
        patch.cost = deductions.reduce((sum, deduction) => sum + deduction.quantity * deduction.unitCost, 0)
      } else {
        for (const deduction of order.stockTaken) {
          const batch = batchesByProduct.get(deduction.productId)?.find((candidate) => candidate.id === deduction.batchId)
          if (!batch) continue
          batch.quantity += deduction.quantity
          movement(tx, db, now, staff, { productId: deduction.productId, batch, delta: deduction.quantity, kind: 'web_cancel', ref: order.ref, reason })
        }
        patch.stockTaken = []
      }
      for (const batches of batchesByProduct.values()) for (const batch of batches) writeBatch(tx, db, batch)
      writeStock(tx, db, batchesByProduct, availability, now)
    }
    if (action === 'cancel') patch.cancel = { at: now, by: actorRef(staff), approvedBy, reason }
    tx.update(orderRef, patch)
    audit(tx, db, now, staff, 'web_order', order.ref, `Website order ${order.ref}: ${step.to.replace(/_/g, ' ')}`, reason)
    return { status: step.to, order }
  })
  if (result.order && ORDER_SMS[result.status]) await notifyCustomer(ctx, result.order, ORDER_SMS[result.status])
  return { status: result.status }
}

// ── Stock ─────────────────────────────────────────────────────────────────────────────────────

async function readSetup(tx, db, productIds) {
  const refs = [...new Set(productIds)].map((id) => db.doc(`catalogOps/${id}`))
  const snaps = refs.length ? await tx.getAll(...refs) : []
  return new Map(snaps.map((snap) => [snap.id, snap.data() || {}]))
}

export async function receiveDelivery({ db, uid, now }, data) {
  const staff = await requireStaff(db, uid, 'deliveries')
  const lines = Array.isArray(data?.lines) ? data.lines : []
  if (!lines.length || lines.length > 60) throw new RuleError('empty_delivery', 'Add at least one product.')
  return db.runTransaction(async (tx) => {
    const products = await readCatalog(tx, db)
    let supplier = null
    if (data?.supplierId) {
      const snap = await tx.get(db.doc(`suppliers/${data.supplierId}`))
      if (!snap.exists) throw new RuleError('bad_supplier', 'Choose the supplier again.')
      supplier = { id: snap.id, name: snap.data().name }
    }
    const productIds = lines.map((line) => line?.productId)
    const setup = await readSetup(tx, db, productIds)
    const batchesByProduct = await readBatches(tx, db, productIds)
    const availability = await readAvailability(tx, db)
    const deliveryRef = db.collection('deliveries').doc()
    const recorded = lines.map((line, index) => {
      const label = `Line ${index + 1}`
      const product = products.find((candidate) => candidate.id === line?.productId)
      if (!product) throw new RuleError('unknown_product', `${label}: choose a product.`)
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 9999) throw new RuleError('bad_quantity', `${label}: type how many arrived.`)
      if (!Number.isSafeInteger(line.unitCost) || line.unitCost < 0) throw new RuleError('bad_cost', `${label}: type what you paid for one (GHS).`)
      let lot, expiresOn
      try {
        lot = checkLot(line.lot)
        expiresOn = checkExpiry(line.expiresOn, { required: setup.get(product.id)?.tracksExpiry !== false, now })
      } catch (error) { throw new RuleError(error.code, `${label} (${product.name}): ${error.message}`) }
      const batch = { id: db.collection('batches').doc().id, productId: product.id, lot, expiresOn, quantity: line.quantity, unitCost: line.unitCost, receivedAt: now, supplierId: supplier?.id || null, deliveryId: deliveryRef.id }
      batchesByProduct.get(product.id).push(batch)
      writeBatch(tx, db, batch)
      tx.set(db.doc(`catalogCosts/${product.id}`), { cost: line.unitCost, updatedAt: now }, { merge: true })
      movement(tx, db, now, staff, { productId: product.id, batch, delta: line.quantity, kind: 'delivery', ref: deliveryRef.id, reason: supplier?.name || '' })
      return { productId: product.id, name: product.name, batchId: batch.id, lot, expiresOn, quantity: line.quantity, unitCost: line.unitCost }
    })
    writeStock(tx, db, batchesByProduct, availability, now)
    const delivery = { at: now, by: actorRef(staff), supplier, invoiceRef: String(data?.invoiceRef ?? '').trim().slice(0, 40), note: String(data?.note ?? '').trim().slice(0, 200), lines: recorded, totalCost: recorded.reduce((sum, line) => sum + line.quantity * line.unitCost, 0) }
    tx.set(deliveryRef, delivery)
    audit(tx, db, now, staff, 'delivery', deliveryRef.id, `Received ${recorded.reduce((sum, line) => sum + line.quantity, 0)} units${supplier ? ` from ${supplier.name}` : ''}`)
    return { deliveryId: deliveryRef.id, lines: recorded.length }
  })
}

export async function adjustStock({ db, uid, now }, data) {
  const staff = await requireStaff(db, uid, 'stock')
  const change = data?.change
  if (!Number.isInteger(change) || change === 0 || Math.abs(change) > 9999) throw new RuleError('bad_quantity', 'Type how many to add or remove.')
  const reason = requireReason(data?.reason)
  return db.runTransaction(async (tx) => {
    const products = await readCatalog(tx, db)
    const product = products.find((candidate) => candidate.id === data?.productId)
    if (!product) throw new RuleError('unknown_product', 'Choose a product.')
    const setup = await readSetup(tx, db, [product.id])
    const cost = (await tx.get(db.doc(`catalogCosts/${product.id}`))).data()?.cost ?? 0
    const batchesByProduct = await readBatches(tx, db, [product.id])
    const availability = await readAvailability(tx, db)
    const batches = batchesByProduct.get(product.id)
    let batch
    if (change > 0 && !data?.batchId) {
      batch = { id: db.collection('batches').doc().id, productId: product.id, lot: checkLot(data?.lot || 'NONE'), expiresOn: checkExpiry(data?.expiresOn, { required: setup.get(product.id)?.tracksExpiry !== false, now }), quantity: 0, unitCost: cost, receivedAt: now, supplierId: null, deliveryId: null }
      batches.push(batch)
    } else {
      batch = batches.find((candidate) => candidate.id === data?.batchId)
      if (!batch) throw new RuleError('bad_batch', 'Choose which batch.')
    }
    if (batch.quantity + change < 0) throw new RuleError('negative_stock', `Batch ${batch.lot} only has ${batch.quantity}.`)
    batch.quantity += change
    writeBatch(tx, db, batch)
    movement(tx, db, now, staff, { productId: product.id, batch, delta: change, kind: 'adjustment', reason })
    writeStock(tx, db, batchesByProduct, availability, now)
    audit(tx, db, now, staff, 'stock_adjustment', product.id, `${change > 0 ? '+' : ''}${change} ${product.name} (batch ${batch.lot})`, reason)
    return { productId: product.id, quantity: batch.quantity }
  })
}

export async function writeOffExpired({ db, uid, now }) {
  const staff = await requireStaff(db, uid, 'stock')
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(db.collection('batches').where('quantity', '>', 0))
    const all = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    const expired = all.filter((batch) => batch.expiresOn && batch.expiresOn < businessDay(now))
    if (!expired.length) throw new RuleError('nothing_expired', 'There is no expired stock to write off.')
    const touched = new Set(expired.map((batch) => batch.productId))
    const batchesByProduct = new Map([...touched].map((id) => [id, all.filter((batch) => batch.productId === id)]))
    const availability = await readAvailability(tx, db)
    let units = 0
    let cost = 0
    for (const batch of expired) {
      units += batch.quantity
      cost += batch.quantity * (batch.unitCost ?? 0)
      movement(tx, db, now, staff, { productId: batch.productId, batch, delta: -batch.quantity, kind: 'write_off', reason: 'Expired' })
      batch.quantity = 0
      writeBatch(tx, db, batch)
    }
    writeStock(tx, db, batchesByProduct, availability, now)
    audit(tx, db, now, staff, 'write_off', null, `Wrote off ${units} expired unit(s)`, `Cost value ${(cost / 100).toFixed(2)} GHS`)
    return { units, cost }
  })
}

// A stock take is refused as a whole if anything moved since the count sheet was opened (a sale mid-count);
// the counter refreshes and recounts only the lines that changed.
export async function submitStockCount({ db, uid, now }, data) {
  const staff = await requireStaff(db, uid, 'stock')
  const lines = Array.isArray(data?.lines) ? data.lines : []
  if (!lines.length) throw new RuleError('empty_count', 'Count at least one line.')
  return db.runTransaction(async (tx) => {
    const refs = lines.map((line) => db.doc(`batches/${String(line?.batchId ?? 'x')}`))
    const snaps = await tx.getAll(...refs)
    const stale = []
    const batches = snaps.map((snap, index) => {
      if (!snap.exists) throw new RuleError('bad_batch', 'A counted batch no longer exists. Open the count sheet again.')
      const line = lines[index]
      if (!Number.isInteger(line.counted) || line.counted < 0 || line.counted > 99999) throw new RuleError('bad_quantity', 'Counts must be whole numbers.')
      if (snap.data().quantity !== line.expected) stale.push(snap.id)
      return { id: snap.id, ...snap.data() }
    })
    if (stale.length) {
      const error = new RuleError('stale_count', `${stale.length} line(s) changed while you were counting (probably a sale). Those lines were refreshed. Count them again, then submit.`)
      error.details = { stale }
      throw error
    }
    const differing = lines.filter((line) => line.counted !== line.expected)
    const note = differing.length ? requireReason(data?.note, 'note about the difference') : String(data?.note ?? '').trim()
    const productIds = [...new Set(batches.map((batch) => batch.productId))]
    const batchesByProduct = await readBatches(tx, db, productIds)
    const availability = await readAvailability(tx, db)
    const countRef = db.collection('stockCounts').doc()
    for (const line of differing) {
      const batch = batchesByProduct.get(batches.find((candidate) => candidate.id === line.batchId).productId).find((candidate) => candidate.id === line.batchId)
      const delta = line.counted - batch.quantity
      batch.quantity = line.counted
      writeBatch(tx, db, batch)
      movement(tx, db, now, staff, { productId: batch.productId, batch, delta, kind: 'count', ref: countRef.id, reason: note })
    }
    writeStock(tx, db, batchesByProduct, availability, now)
    const net = differing.reduce((sum, line) => sum + line.counted - line.expected, 0)
    tx.set(countRef, { at: now, by: actorRef(staff), note, lines: lines.map((line) => ({ batchId: line.batchId, expected: line.expected, counted: line.counted })), differing: differing.length, net })
    audit(tx, db, now, staff, 'stock_count', countRef.id, differing.length ? `Stock take: ${differing.length} line(s) different (${net > 0 ? '+' : ''}${net})` : `Stock take: all ${lines.length} lines matched`, note)
    return { differing: differing.length, net }
  })
}

// ── Catalogue setup and suppliers ─────────────────────────────────────────────────────────────

export async function saveProductSetup({ db, uid, now }, data) {
  const staff = await requireStaff(db, uid, 'products')
  const productId = String(data?.productId ?? '')
  const sku = String(data?.sku ?? '').trim().toUpperCase()
  const barcode = String(data?.barcode ?? '').trim()
  if (sku && !/^[A-Z0-9-]{2,24}$/.test(sku)) throw new RuleError('bad_sku', 'The shop code (SKU) can use letters, numbers and dashes only.')
  if (barcode && !isValidBarcode(barcode)) throw new RuleError('bad_barcode', 'That barcode is not valid. Scan it again.')
  const reorderPoint = data?.reorderPoint
  if (!Number.isInteger(reorderPoint) || reorderPoint < 0 || reorderPoint > 9999) throw new RuleError('bad_reorder', 'Type the stock level that should warn you (a whole number).')
  const cost = data?.cost
  if (cost !== null && cost !== undefined && (!Number.isSafeInteger(cost) || cost < 0)) throw new RuleError('bad_cost', 'The cost must be an amount in GHS.')
  return db.runTransaction(async (tx) => {
    const products = await readCatalog(tx, db)
    const product = products.find((candidate) => candidate.id === productId)
    if (!product) throw new RuleError('unknown_product', 'This product is not in the catalogue.')
    if (sku) {
      const clash = await tx.get(db.collection('catalogOps').where('sku', '==', sku).limit(2))
      if (clash.docs.some((doc) => doc.id !== productId)) throw new RuleError('duplicate_sku', `Shop code ${sku} is already used by another product.`)
    }
    if (barcode) {
      const clash = await tx.get(db.collection('catalogOps').where('barcode', '==', barcode).limit(2))
      if (clash.docs.some((doc) => doc.id !== productId)) throw new RuleError('duplicate_barcode', 'This barcode is already on another product.')
    }
    tx.set(db.doc(`catalogOps/${productId}`), { sku: sku || null, barcode: barcode || null, reorderPoint, tracksExpiry: data?.tracksExpiry !== false, updatedAt: now, updatedBy: uid })
    if (cost !== null && cost !== undefined) tx.set(db.doc(`catalogCosts/${productId}`), { cost, updatedAt: now }, { merge: true })
    audit(tx, db, now, staff, 'product_setup', productId, `Updated till setup for ${product.name}`)
    return { productId }
  })
}

export async function saveSupplier({ db, uid, now }, data) {
  const staff = await requireStaff(db, uid, 'deliveries')
  const name = String(data?.name ?? '').trim()
  if (name.length < 2) throw new RuleError('bad_name', 'Type the supplier name.')
  const ref = data?.id ? db.doc(`suppliers/${data.id}`) : db.collection('suppliers').doc()
  await ref.set({ name: name.slice(0, 60), phone: String(data?.phone ?? '').trim().slice(0, 20), contact: String(data?.contact ?? '').trim().slice(0, 60), updatedAt: now }, { merge: true })
  await db.collection('audit').add({ at: now, day: businessDay(now), type: 'supplier', actor: actorRef(staff), ref: ref.id, summary: `Saved supplier ${name}`, detail: '' })
  return { id: ref.id }
}

// ── Staff accounts ────────────────────────────────────────────────────────────────────────────

// First-time setup: someone already on the website-editor list becomes the owner, if there is no owner yet.
export async function claimOwner({ db, auth, uid, email, now }) {
  if (!uid) throw new RuleError('unauthenticated', 'Please sign in again.')
  return db.runTransaction(async (tx) => {
    const editor = await tx.get(db.doc(`admins/${uid}`))
    if (!editor.exists) throw new RuleError('forbidden', 'This account is not allowed to set up the shop.')
    const owners = await tx.get(db.collection('staff').where('role', '==', 'owner').where('active', '==', true).limit(1))
    if (!owners.empty && owners.docs[0].id !== uid) throw new RuleError('owner_exists', 'The shop already has an owner. Ask them to add you.')
    const user = await auth.getUser(uid)
    const staff = { name: user.displayName || (email || '').split('@')[0] || 'Owner', email: email || user.email || '', role: 'owner', active: true, createdAt: now, lastActiveAt: now, hasPin: false }
    tx.set(db.doc(`staff/${uid}`), staff, { merge: true })
    audit(tx, db, now, { uid, ...staff }, 'staff', uid, `${staff.name} set up the shop as owner`)
    return { role: 'owner' }
  })
}

function randomPassword() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from(randomBytes(12), (byte) => alphabet[byte % alphabet.length]).join('')
}

export async function createStaff({ db, auth, uid, now }, data) {
  const owner = await requireStaff(db, uid, 'staff')
  const name = String(data?.name ?? '').trim()
  const email = String(data?.email ?? '').trim().toLowerCase()
  const role = data?.role
  if (name.length < 2 || name.length > 60) throw new RuleError('bad_name', 'Type the staff member’s name.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RuleError('bad_email', 'Type a real email address. They sign in with it.')
  if (!ROLES.includes(role)) throw new RuleError('bad_role', 'Choose a role.')
  const password = randomPassword()
  let user
  try {
    user = await auth.createUser({ email, password, displayName: name })
  } catch (error) {
    if (error?.code === 'auth/email-already-exists') throw new RuleError('email_taken', 'Someone already signs in with this email.')
    throw error
  }
  await db.doc(`staff/${user.uid}`).set({ name, email, role, active: true, createdAt: now, lastActiveAt: null, hasPin: false })
  if (role === 'owner') await db.doc(`admins/${user.uid}`).set({ addedAt: now })
  await db.collection('audit').add({ at: now, day: businessDay(now), type: 'staff', actor: actorRef(owner), ref: user.uid, summary: `Added ${name} as ${ROLE_LABEL[role]}`, detail: '' })
  return { uid: user.uid, password }
}

export async function updateStaff({ db, auth, uid, now }, data) {
  const owner = await requireStaff(db, uid, 'staff')
  const targetId = String(data?.uid ?? '')
  if (targetId === uid) throw new RuleError('self_change', 'You cannot change your own role or turn yourself off.')
  const ref = db.doc(`staff/${targetId}`)
  const snap = await ref.get()
  if (!snap.exists) throw new RuleError('not_found', 'Staff member not found.')
  const current = snap.data()
  const role = data?.role ?? current.role
  const active = data?.active ?? current.active
  if (!ROLES.includes(role)) throw new RuleError('bad_role', 'Choose a role.')
  if (current.role === 'owner' && (role !== 'owner' || !active)) {
    const owners = await db.collection('staff').where('role', '==', 'owner').where('active', '==', true).get()
    if (owners.docs.filter((doc) => doc.id !== targetId).length === 0) throw new RuleError('last_owner', 'The shop must always have an active owner.')
  }
  await ref.update({ role, active })
  await auth.updateUser(targetId, { disabled: !active })
  if (!active) await auth.revokeRefreshTokens(targetId)
  if (role === 'owner' && active) await db.doc(`admins/${targetId}`).set({ addedAt: now })
  else await db.doc(`admins/${targetId}`).delete()
  const changes = [role !== current.role ? `role → ${ROLE_LABEL[role]}` : '', active !== current.active ? (active ? 'turned on' : 'turned off') : ''].filter(Boolean).join(', ')
  await db.collection('audit').add({ at: now, day: businessDay(now), type: 'staff', actor: actorRef(owner), ref: targetId, summary: `${current.name}: ${changes || 'no change'}`, detail: '' })
  return { uid: targetId, role, active }
}

export async function setMyPin({ db, uid, now }, data) {
  const staff = await requireStaff(db, uid, 'approve')
  if (!isValidPin(data?.pin)) throw new RuleError('bad_pin', 'The PIN must be 4 to 6 digits.')
  const { salt, hash } = hashPin(data.pin)
  await db.doc(`staffSecrets/${uid}`).set({ pinSalt: salt, pinHash: hash, failedAttempts: 0, lockedUntil: 0 })
  await db.doc(`staff/${uid}`).update({ hasPin: true })
  await db.collection('audit').add({ at: now, day: businessDay(now), type: 'staff', actor: actorRef(staff), ref: uid, summary: `${staff.name} set a new approval PIN`, detail: '' })
  return { ok: true }
}

export async function recordSignIn({ db, uid, now }) {
  const staff = await requireStaff(db, uid)
  await db.doc(`staff/${uid}`).update({ lastActiveAt: now })
  return { role: staff.role, name: staff.name }
}
