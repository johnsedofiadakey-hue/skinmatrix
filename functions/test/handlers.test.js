// Runs the real handlers against the Firestore and Auth emulators:
//   npm run test:functions
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createHmac } from 'node:crypto'
import * as h from '../src/handlers.js'
import * as shifts from '../src/shifts.js'
import * as settings from '../src/settings.js'
import * as web from '../src/web.js'

const PROJECT = 'demo-skinmatrix'
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-26T12:00:00Z')
let db, auth

const products = [
  { id: 'serum', name: 'Niacinamide Serum', brand: 'Anua', size: '30 ml', price: 20000, visible: true },
  { id: 'cream', name: 'Moisturizing Cream', brand: 'CeraVe', size: '236 ml', price: 30000, visible: true },
  { id: 'pouch', name: 'Gift Pouch', brand: 'SkinMatrix', size: '', price: 2500, visible: false },
]
const ctx = (uid, now = NOW) => ({ db, auth, uid, email: `${uid}@test.dev`, now })
const OWNER = 'owner1'
const MANAGER = 'manager1'
const STAFF = 'staff1'
let request = 0
const rid = () => `req-${Date.now()}-${request++}`
const stock = async (id) => (await db.doc(`stock/${id}`).get()).data()?.onHand ?? 0
const sell = (uid, lines, extra = {}, now = NOW) => h.completeSale(ctx(uid, now), { requestId: rid(), lines, payment: { method: 'cash', received: 9999999 }, ...extra })
const expectRule = async (promise, code) => { await expect(promise).rejects.toMatchObject({ code }) }

beforeAll(() => {
  initializeApp({ projectId: PROJECT })
  db = getFirestore()
  auth = getAuth()
})

beforeEach(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
  await db.doc('site/catalog').set({ products })
  for (const [uid, role, name] of [[OWNER, 'owner', 'Ama Owner'], [MANAGER, 'manager', 'Kwame Manager'], [STAFF, 'staff', 'Akosua Staff']]) {
    await auth.createUser({ uid, email: `${uid}@test.dev`, password: 'secret123', displayName: name })
    await db.doc(`staff/${uid}`).set({ name, email: `${uid}@test.dev`, role, active: true, createdAt: NOW, hasPin: false })
  }
  await h.setMyPin(ctx(MANAGER), { pin: '5000' })
  await h.setMyPin(ctx(OWNER), { pin: '9000' })
  for (const uid of [OWNER, MANAGER, STAFF]) await shifts.openShift(ctx(uid), { float: 10000 })
  await h.receiveDelivery(ctx(MANAGER), { lines: [
    { productId: 'serum', lot: 'OLD1', expiresOn: '2026-10-20', quantity: 3, unitCost: 9000 },
    { productId: 'serum', lot: 'NEW1', expiresOn: '2027-12-31', quantity: 10, unitCost: 9500 },
    { productId: 'cream', lot: 'C1', expiresOn: '2028-01-31', quantity: 5, unitCost: 15000 },
  ] })
})

describe('deliveries and stock', () => {
  it('records batches with cost and a readable stock summary', async () => {
    expect(await stock('serum')).toBe(13)
    const summary = (await db.doc('stock/serum').get()).data()
    expect(summary.batches.map((batch) => batch.lot)).toEqual(['OLD1', 'NEW1'])
    expect(summary.batches[0]).not.toHaveProperty('unitCost')
    expect((await db.doc('catalogCosts/serum').get()).data().cost).toBe(9500)
    expect((await db.doc('site/availability').get()).data().products).toMatchObject({ serum: true, cream: true })
  })

  it('refuses staff, expired stock and missing expiry dates', async () => {
    await expectRule(h.receiveDelivery(ctx(STAFF), { lines: [{ productId: 'serum', lot: 'X', expiresOn: '2027-01-01', quantity: 1, unitCost: 1 }] }), 'forbidden')
    await expectRule(h.receiveDelivery(ctx(MANAGER), { lines: [{ productId: 'serum', lot: 'X', expiresOn: '2020-01-01', quantity: 1, unitCost: 1 }] }), 'already_expired')
    await expectRule(h.receiveDelivery(ctx(MANAGER), { lines: [{ productId: 'serum', lot: 'X', quantity: 1, unitCost: 1 }] }), 'expiry_required')
  })
})

describe('sales at the till', () => {
  it('prices from the catalogue, sells the soonest expiry first and numbers sales', async () => {
    const { sale } = await sell(STAFF, [{ productId: 'serum', quantity: 4, price: 1 }])
    expect(sale).toMatchObject({ number: 1, subtotal: 80000, total: 80000, status: 'completed' })
    expect(sale.deductions.map((deduction) => [deduction.lot, deduction.quantity])).toEqual([['OLD1', 3], ['NEW1', 1]])
    expect(await stock('serum')).toBe(9)
    expect((await db.doc(`saleCosts/${sale.id}`).get()).data().cost).toBe(3 * 9000 + 9500)
    const second = await sell(STAFF, [{ productId: 'pouch', quantity: 1 }]).catch((error) => error)
    expect(second.code).toBe('insufficient_stock')
    expect((await sell(STAFF, [{ productId: 'cream', quantity: 1 }])).sale.number).toBe(2)
  })

  it('is idempotent per request and changes nothing when it fails', async () => {
    const requestId = rid()
    const args = { requestId, lines: [{ productId: 'cream', quantity: 2 }], payment: { method: 'cash', received: 60000 } }
    const first = await h.completeSale(ctx(STAFF), args)
    const again = await h.completeSale(ctx(STAFF), args)
    expect(again.sale.id).toBe(first.sale.id)
    expect(await stock('cream')).toBe(3)
    await expectRule(sell(STAFF, [{ productId: 'cream', quantity: 1 }, { productId: 'serum', quantity: 50 }]), 'insufficient_stock')
    expect(await stock('cream')).toBe(3)
    await expectRule(sell(STAFF, [{ productId: 'cream', quantity: 1 }], { payment: { method: 'cash', received: 100 } }), 'short_payment')
  })

  it('records MoMo and refuses a transaction ID twice', async () => {
    const momo = { method: 'momo', received: 30000, reference: '55012345678', network: 'MTN' }
    await sell(STAFF, [{ productId: 'cream', quantity: 1 }], { payment: momo })
    await expectRule(sell(STAFF, [{ productId: 'cream', quantity: 1 }], { payment: momo }), 'duplicate_reference')
  })

  it('needs a manager PIN for discounts over 10% and records who approved', async () => {
    const discount = { type: 'percent', value: 20, reason: 'Bulk buy' }
    await expectRule(sell(STAFF, [{ productId: 'cream', quantity: 1 }], { discount }), 'approval_required')
    await expectRule(sell(STAFF, [{ productId: 'cream', quantity: 1 }], { discount, approval: { approverId: MANAGER, pin: '1234' } }), 'bad_pin')
    await expectRule(sell(STAFF, [{ productId: 'cream', quantity: 1 }], { discount, approval: { approverId: STAFF, pin: '1234' } }), 'bad_approval')
    const { sale } = await sell(STAFF, [{ productId: 'cream', quantity: 1 }], { discount, approval: { approverId: MANAGER, pin: '5000' } })
    expect(sale).toMatchObject({ total: 24000, discount: { amount: 6000, approvedBy: { name: 'Kwame Manager' } } })
    const small = await sell(STAFF, [{ productId: 'cream', quantity: 1 }], { discount: { type: 'percent', value: 10, reason: 'Loyal' } })
    expect(small.sale.discount.approvedBy).toBeNull()
  })

  it('locks an approver after five wrong PINs', async () => {
    const discount = { type: 'percent', value: 50, reason: 'Test' }
    for (let i = 0; i < 5; i += 1) await expectRule(sell(STAFF, [{ productId: 'cream', quantity: 1 }], { discount, approval: { approverId: MANAGER, pin: '0000' } }), 'bad_pin')
    await expectRule(sell(STAFF, [{ productId: 'cream', quantity: 1 }], { discount, approval: { approverId: MANAGER, pin: '5000' } }), 'pin_locked')
  })
})

describe('voids and returns', () => {
  it('lets staff cancel a sale only with approval, and puts the stock back once', async () => {
    const { sale } = await sell(STAFF, [{ productId: 'serum', quantity: 4 }])
    await expectRule(h.voidSale(ctx(STAFF), { saleId: sale.id, reason: 'Wrong item' }), 'approval_required')
    await h.voidSale(ctx(STAFF), { saleId: sale.id, reason: 'Wrong item', approval: { approverId: MANAGER, pin: '5000' } })
    expect(await stock('serum')).toBe(13)
    await expectRule(h.voidSale(ctx(MANAGER), { saleId: sale.id, reason: 'Again' }), 'already_voided')
  })

  it('only lets the owner cancel an older sale', async () => {
    const { sale } = await sell(STAFF, [{ productId: 'cream', quantity: 1 }])
    await expectRule(h.voidSale(ctx(MANAGER, NOW + DAY), { saleId: sale.id, reason: 'Late' }), 'approval_required')
    await h.voidSale(ctx(OWNER, NOW + DAY), { saleId: sale.id, reason: 'Late' })
    expect(await stock('cream')).toBe(5)
  })

  it('refunds what was paid, restocks resaleable items and keeps damaged ones off the shelf', async () => {
    const { sale } = await sell(STAFF, [{ productId: 'serum', quantity: 3 }, { productId: 'cream', quantity: 2 }], { discount: { type: 'percent', value: 10, reason: 'Loyal' } })
    const back = await h.returnItems(ctx(MANAGER), { saleId: sale.id, lines: [{ productId: 'serum', quantity: 1 }], condition: 'resaleable', refundMethod: 'cash', reason: 'Changed mind' })
    expect(back.amount).toBe(18000)
    expect(await stock('serum')).toBe(11)
    await h.returnItems(ctx(MANAGER), { saleId: sale.id, lines: [{ productId: 'cream', quantity: 1 }], condition: 'damaged', refundMethod: 'momo', reference: 'RF123456', reason: 'Pump broken' })
    expect(await stock('cream')).toBe(3)
    await expectRule(h.returnItems(ctx(MANAGER), { saleId: sale.id, lines: [{ productId: 'serum', quantity: 3 }], condition: 'resaleable', refundMethod: 'cash', reason: 'Too many' }), 'too_many')
    await expectRule(h.returnItems(ctx(STAFF), { saleId: sale.id, lines: [{ productId: 'serum', quantity: 1 }], condition: 'resaleable', refundMethod: 'cash', reason: 'No approval' }), 'approval_required')
    // A later cancel only restocks what is still out.
    await h.voidSale(ctx(MANAGER), { saleId: sale.id, reason: 'Customer returned the rest' })
    expect(await stock('serum')).toBe(13)
    expect(await stock('cream')).toBe(4)
  })
})

describe('website orders', () => {
  const order = (id, lines, status = 'new') => db.doc(`orders/${id}`).set({ ref: id, channel: 'website', status, customer: { name: 'Esi', phone: '024 123 4567', email: '' }, fulfilment: { method: 'delivery', address: 'East Legon', notes: '' }, lines, subtotal: 0, deliveryFee: null, total: 0, payment: { method: 'pay_later', status: 'unpaid', reference: null }, createdAt: new Date(NOW) })

  it('takes stock when confirmed and gives it back when cancelled (with approval for staff)', async () => {
    await order('SM-AAAAAA', [{ id: 'cream', name: 'Moisturizing Cream', qty: 2, price: 30000, lineTotal: 60000 }])
    await h.updateWebOrder(ctx(STAFF), { orderId: 'SM-AAAAAA', action: 'confirm' })
    expect(await stock('cream')).toBe(3)
    await expectRule(h.updateWebOrder(ctx(STAFF), { orderId: 'SM-AAAAAA', action: 'ready' }), 'bad_state')
    await expectRule(h.updateWebOrder(ctx(STAFF), { orderId: 'SM-AAAAAA', action: 'cancel', reason: 'Customer changed mind' }), 'approval_required')
    await h.updateWebOrder(ctx(STAFF), { orderId: 'SM-AAAAAA', action: 'cancel', reason: 'Customer changed mind', approval: { approverId: MANAGER, pin: '5000' } })
    expect(await stock('cream')).toBe(5)
  })

  it('refuses to confirm when the shop is short', async () => {
    await order('SM-BBBBBB', [{ id: 'cream', name: 'Moisturizing Cream', qty: 9, price: 30000, lineTotal: 270000 }])
    await expectRule(h.updateWebOrder(ctx(STAFF), { orderId: 'SM-BBBBBB', action: 'confirm' }), 'insufficient_stock')
    expect((await db.doc('orders/SM-BBBBBB').get()).data().status).toBe('new')
  })

  it('records which staff member manually checked an online payment', async () => {
    await order('SM-CCCCCC', [], 'new')
    await db.doc('orders/SM-CCCCCC').update({ payment: { method: 'paystack', status: 'reported', reference: 'PSK-123' } })
    await h.updateWebOrder(ctx(STAFF), { orderId: 'SM-CCCCCC', action: 'payment_checked' })
    expect((await db.doc('orders/SM-CCCCCC').get()).data().payment).toMatchObject({ status: 'confirmed', reference: 'PSK-123', checkedBy: { name: 'Akosua Staff' }, checkedAt: NOW })
  })
})

describe('stock take, write-off and setup', () => {
  it('refuses a stale count and applies a fresh one', async () => {
    const batches = (await db.doc('stock/serum').get()).data().batches
    const sheet = batches.map((batch) => ({ batchId: batch.id, expected: batch.quantity, counted: batch.quantity }))
    sheet[1].counted -= 1
    await sell(STAFF, [{ productId: 'serum', quantity: 1 }])
    await expectRule(h.submitStockCount(ctx(MANAGER), { lines: sheet, note: 'Count' }), 'stale_count')
    const fresh = (await db.doc('stock/serum').get()).data().batches.map((batch) => ({ batchId: batch.id, expected: batch.quantity, counted: batch.quantity }))
    fresh[1].counted -= 1
    await expectRule(h.submitStockCount(ctx(MANAGER), { lines: fresh, note: '' }), 'reason_required')
    await h.submitStockCount(ctx(MANAGER), { lines: fresh, note: 'One missing' })
    expect(await stock('serum')).toBe(11)
  })

  it('writes off expired stock', async () => {
    await db.collection('batches').add({ productId: 'cream', lot: 'OLD', expiresOn: '2026-01-01', quantity: 2, unitCost: 1000, receivedAt: 0 })
    const result = await h.writeOffExpired(ctx(MANAGER))
    expect(result.units).toBe(2)
    await expectRule(h.writeOffExpired(ctx(MANAGER)), 'nothing_expired')
  })

  it('keeps shop codes and barcodes unique, owner only', async () => {
    await h.saveProductSetup(ctx(OWNER), { productId: 'serum', sku: 'ANUA-NIA', barcode: '8809640734823', reorderPoint: 3, tracksExpiry: true, cost: 9000 })
    await expectRule(h.saveProductSetup(ctx(MANAGER), { productId: 'cream', sku: 'X', reorderPoint: 1 }), 'forbidden')
    await expectRule(h.saveProductSetup(ctx(OWNER), { productId: 'cream', barcode: '8809640734823', reorderPoint: 1 }), 'duplicate_barcode')
    await expectRule(h.saveProductSetup(ctx(OWNER), { productId: 'cream', barcode: '8809640734824', reorderPoint: 1 }), 'bad_barcode')
  })
})

describe('staff accounts', () => {
  it('lets the owner add, change and turn off staff, and keeps an owner', async () => {
    await expectRule(h.createStaff(ctx(MANAGER), { name: 'Yaw', email: 'yaw@test.dev', role: 'staff' }), 'forbidden')
    const { uid, password } = await h.createStaff(ctx(OWNER), { name: 'Yaw', email: 'yaw@test.dev', role: 'staff' })
    expect(password).toHaveLength(12)
    await h.updateStaff(ctx(OWNER), { uid, active: false })
    expect((await auth.getUser(uid)).disabled).toBe(true)
    await expectRule(sell(uid, [{ productId: 'cream', quantity: 1 }]), 'account_disabled')
    await expectRule(h.updateStaff(ctx(OWNER), { uid: OWNER, role: 'staff' }), 'self_change')
    await expectRule(h.createStaff(ctx(OWNER), { name: 'Yaw 2', email: 'yaw@test.dev', role: 'staff' }), 'email_taken')
  })

  it('lets an existing website editor claim the shop only when there is no owner', async () => {
    await auth.createUser({ uid: 'editor1', email: 'editor@test.dev', password: 'secret123' })
    await db.doc('admins/editor1').set({ addedAt: NOW })
    await expectRule(h.claimOwner(ctx('editor1')), 'owner_exists')
    await db.doc(`staff/${OWNER}`).update({ role: 'manager' })
    await h.claimOwner(ctx('editor1'))
    expect((await db.doc('staff/editor1').get()).data().role).toBe('owner')
  })
})

const shiftOf = async (uid) => {
  const id = (await db.doc(`staff/${uid}`).get()).data().openShiftId
  return id ? { id, ...(await db.doc(`shifts/${id}`).get()).data() } : null
}

describe('cash drawers', () => {
  it('adds cash sales, takes off cash refunds and ignores MoMo', async () => {
    const { sale } = await sell(STAFF, [{ productId: 'cream', quantity: 1 }], { payment: { method: 'cash', received: 50000 } })
    await sell(STAFF, [{ productId: 'cream', quantity: 1 }], { payment: { method: 'momo', received: 30000, reference: 'MM1234567', network: 'MTN' } })
    expect(sale.shiftId).toBe((await shiftOf(STAFF)).id)
    await h.returnItems(ctx(MANAGER), { saleId: sale.id, lines: [{ productId: 'cream', quantity: 1 }], condition: 'resaleable', refundMethod: 'cash', reason: 'Changed mind' })
    expect(await shiftOf(STAFF)).toMatchObject({ float: 10000, cashSales: 30000, cashRefunds: 0, sales: 1 })
    expect((await shiftOf(MANAGER)).cashRefunds).toBe(30000)
  })

  it('refuses cash without an open drawer but still takes MoMo', async () => {
    await shifts.closeShift(ctx(STAFF), { counted: 10000 })
    await expectRule(sell(STAFF, [{ productId: 'cream', quantity: 1 }]), 'no_shift')
    await sell(STAFF, [{ productId: 'cream', quantity: 1 }], { payment: { method: 'momo', received: 30000, reference: 'MM7654321', network: 'MTN' } })
    await expectRule(shifts.closeShift(ctx(STAFF), { counted: 0 }), 'no_shift')
  })

  it('needs a manager to take cash out, and a note when the count is different', async () => {
    await sell(STAFF, [{ productId: 'cream', quantity: 1 }], { payment: { method: 'cash', received: 30000 } })
    await expectRule(shifts.cashMovement(ctx(STAFF), { kind: 'out', amount: 5000, reason: 'Paid the rider' }), 'approval_required')
    await shifts.cashMovement(ctx(STAFF), { kind: 'out', amount: 5000, reason: 'Paid the rider', approval: { approverId: MANAGER, pin: '5000' } })
    await shifts.cashMovement(ctx(STAFF), { kind: 'in', amount: 2000, reason: 'Change from the bank' })
    await expectRule(shifts.cashMovement(ctx(MANAGER), { kind: 'out', amount: 999999, reason: 'Too much' }), 'not_enough_cash')
    // 100 float + 300 sale − 50 out + 20 in = 370 GHS expected
    await expectRule(shifts.closeShift(ctx(STAFF), { counted: 36000 }), 'reason_required')
    const { shift } = await shifts.closeShift(ctx(STAFF), { counted: 36000, note: 'Gave wrong change' })
    expect(shift).toMatchObject({ status: 'closed', expected: 37000, difference: -1000 })
    expect((await db.doc(`staff/${STAFF}`).get()).data().openShiftId).toBeNull()
  })

  it('lets a manager close a drawer someone left open', async () => {
    const left = await shiftOf(STAFF)
    await expectRule(shifts.closeShift(ctx(OWNER), { shiftId: 'nope-000000' , counted: 0 }), 'not_found')
    await expectRule(shifts.closeShift({ ...ctx(STAFF) }, { shiftId: (await shiftOf(MANAGER)).id, counted: 10000 }), 'forbidden')
    await shifts.closeShift(ctx(MANAGER), { shiftId: left.id, counted: 10000 })
    expect(await shiftOf(STAFF)).toBeNull()
  })
})

describe('offline sales and taxes', () => {
  it('keeps the time and price of an offline sale and records any price change', async () => {
    const shiftId = (await shiftOf(STAFF)).id
    const at = NOW - 60 * 60 * 1000
    const { sale } = await sell(STAFF, [{ productId: 'cream', quantity: 1 }], { payment: { method: 'cash', received: 28000 }, offline: { at, shiftId, clientTotal: 28000 } })
    expect(sale).toMatchObject({ at, total: 28000, subtotal: 30000, offline: { clientTotal: 28000, adjustment: 2000 } })
    expect((await shiftOf(STAFF)).cashSales).toBe(28000)
    await shifts.closeShift(ctx(STAFF), { counted: 38000 })
    // Synced after the drawer closed: counted as late cash on that drawer, not lost.
    await sell(STAFF, [{ productId: 'cream', quantity: 1 }], { payment: { method: 'cash', received: 30000 }, offline: { at, shiftId, clientTotal: 30000 } })
    expect((await db.doc(`shifts/${shiftId}`).get()).data().lateCash).toBe(30000)
    await expectRule(sell(STAFF, [{ productId: 'cream', quantity: 1 }], { offline: { at: NOW - 8 * DAY, shiftId, clientTotal: 30000 } }), 'offline_too_old')
  })

  it('splits VAT, NHIL and GETFund out of the total when the shop is registered', async () => {
    await expectRule(settings.saveShopSettings(ctx(MANAGER), { tax: { registered: true, tin: 'P0012345678' } }), 'forbidden')
    await expectRule(settings.saveShopSettings(ctx(OWNER), { tax: { registered: true, tin: 'x' } }), 'bad_tin')
    await settings.saveShopSettings(ctx(OWNER), { tax: { registered: true, tin: 'P0012345678', vatBp: 1500, nhilBp: 250, getfundBp: 250 } })
    const { sale } = await sell(STAFF, [{ productId: 'cream', quantity: 1 }])
    expect(sale.tax).toMatchObject({ tin: 'P0012345678', net: 25000, nhil: 625, getfund: 625, vat: 3750 })
    expect(sale.tax.net + sale.tax.vat + sale.tax.nhil + sale.tax.getfund).toBe(sale.total)
  })
})

describe('website checkout on the server', () => {
  const details = { name: 'Esi Mensah', phone: '0241234567', email: 'esi@test.dev', method: 'delivery', address: 'East Legon, near the mall', notes: '' }
  const place = (extra = {}, now = NOW) => web.placeWebOrder({ db, now, secrets: {} }, { requestId: rid(), payment: 'pay_later', details, lines: [{ id: 'cream', qty: 2, price: 1 }], ...extra })
  const content = (checkout) => db.doc('site/content').set({ shop: { legalName: 'SkinMatrix Ltd', phone: '030 000 0000' }, home: {}, checkout: { deliveryFee: 2000, pickup: true, paystackPublicKey: '', ...checkout }, terms: {} })

  it('prices the order from the catalogue, not the browser', async () => {
    await content({})
    const order = await place()
    expect(order).toMatchObject({ status: 'new', subtotal: 60000, deliveryFee: 2000, total: 62000, payment: { method: 'pay_later', status: 'unpaid' } })
    expect(order.lines[0]).toMatchObject({ id: 'cream', price: 30000, qty: 2 })
    expect(order.customer.phone).toBe('024 123 4567')
    const saved = (await db.doc(`orders/${order.ref}`).get()).data()
    expect(saved.total).toBe(62000)
    expect(saved.createdAt.toMillis()).toBe(NOW)
  })

  it('refuses hidden, unpriced and out-of-stock products and bad details', async () => {
    await content({})
    await expectRule(place({ lines: [{ id: 'pouch', qty: 1 }] }), 'unknown_product')
    await db.doc('site/availability').update({ 'products.cream': false })
    await expectRule(place(), 'out_of_stock')
    await expectRule(place({ lines: [{ id: 'serum', qty: 1 }], details: { ...details, phone: '12' } }), 'bad_details')
    await expectRule(place({ lines: [{ id: 'serum', qty: 1 }], payment: 'paystack' }), 'bad_payment')
  })

  it('is idempotent per request', async () => {
    await content({})
    const requestId = rid()
    const args = { requestId, payment: 'pay_later', details, lines: [{ id: 'serum', qty: 1 }] }
    const first = await web.placeWebOrder({ db, now: NOW, secrets: {} }, args)
    const again = await web.placeWebOrder({ db, now: NOW, secrets: {} }, args)
    expect(again.ref).toBe(first.ref)
  })

  it('confirms a Paystack payment with Paystack and refuses a wrong amount', async () => {
    await content({ paystackPublicKey: 'pk_test_abc' })
    const order = await place({ payment: 'paystack' })
    expect(order.payment.status).toBe('pending')
    await expectRule(h.updateWebOrder(ctx(STAFF), { orderId: order.ref, action: 'confirm' }), 'awaiting_payment')
    const paystack = (amount) => async (url, init) => {
      expect(url).toContain(`${order.ref}-A1`)
      expect(init.headers.Authorization).toBe('Bearer sk_test_secret')
      return { ok: true, json: async () => ({ data: { status: 'success', reference: `${order.ref}-A1`, amount, currency: 'GHS', channel: 'mobile_money', paid_at: '2026-09-26T12:00:00Z' } }) }
    }
    const verify = (amount) => web.verifyWebPayment({ db, now: NOW, secrets: { paystack: 'sk_test_secret' }, fetch: paystack(amount) }, { ref: order.ref, reference: `${order.ref}-A1` })
    await expectRule(web.verifyWebPayment({ db, now: NOW, secrets: {} }, { ref: order.ref, reference: 'SM-ZZZZZZ-A1' }), 'bad_reference')
    expect((await verify(100)).status).toBe('mismatch')
    await db.doc(`orders/${order.ref}`).update({ 'payment.status': 'pending' })
    expect((await verify(62000)).status).toBe('paid')
    expect((await db.doc(`orders/${order.ref}`).get()).data().payment).toMatchObject({ status: 'paid', amountPaid: 62000, verifiedBy: 'verify', channel: 'mobile_money' })
    await h.updateWebOrder(ctx(STAFF), { orderId: order.ref, action: 'confirm' })
  })

  it('accepts only webhooks signed with the Paystack secret', async () => {
    await content({ paystackPublicKey: 'pk_test_abc' })
    const order = await place({ payment: 'paystack' })
    const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { status: 'success', reference: `${order.ref}-B2`, amount: 62000, currency: 'GHS' } }))
    const hook = (signature) => web.handlePaystackWebhook({ db, now: NOW, secrets: { paystack: 'sk_test_secret' } }, { rawBody: body, signature })
    expect(await hook('forged')).toBe(401)
    expect((await db.doc(`orders/${order.ref}`).get()).data().payment.status).toBe('pending')
    expect(await hook(createHmac('sha512', 'sk_test_secret').update(body).digest('hex'))).toBe(200)
    expect((await db.doc(`orders/${order.ref}`).get()).data().payment).toMatchObject({ status: 'paid', verifiedBy: 'webhook' })
  })

  it('texts the customer when SMS is on, and never fails the order when the provider is down', async () => {
    await content({})
    await settings.saveShopSettings(ctx(OWNER), { sms: { enabled: true, senderId: 'SkinMatrix', orderPlaced: true, orderUpdates: true } })
    const sent = []
    const fetcher = async (url, init) => { sent.push({ url, body: JSON.parse(init.body), key: init.headers['api-key'] }); return { ok: true, status: 200, json: async () => ({ status: 'success' }) } }
    const order = await web.placeWebOrder({ db, now: NOW, secrets: { smsKey: 'arkesel-key' }, fetch: fetcher }, { requestId: rid(), payment: 'pay_later', details, lines: [{ id: 'serum', qty: 1 }] })
    expect(sent[0]).toMatchObject({ url: 'https://sms.arkesel.com/api/v2/sms/send', key: 'arkesel-key', body: { sender: 'SkinMatrix', recipients: ['233241234567'] } })
    expect(sent[0].body.message).toContain(order.ref)
    await h.updateWebOrder({ ...ctx(STAFF), secrets: { smsKey: 'arkesel-key' }, fetch: fetcher }, { orderId: order.ref, action: 'confirm' })
    expect(sent[1].body.message).toContain('confirmed')
    const down = async () => { throw new Error('network down') }
    const second = await web.placeWebOrder({ db, now: NOW, secrets: { smsKey: 'arkesel-key' }, fetch: down }, { requestId: rid(), payment: 'pay_later', details, lines: [{ id: 'serum', qty: 1 }] })
    expect(second.ref).toMatch(/^SM-/)
    const log = (await db.collection('smsLog').get()).docs.map((doc) => doc.data())
    expect(log.filter((row) => row.ok)).toHaveLength(2)
    expect(log.find((row) => !row.ok).error).toBe('network down')
  })
})
