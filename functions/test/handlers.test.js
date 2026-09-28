// Runs the real handlers against the Firestore and Auth emulators:
//   npm run test:functions
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import * as h from '../src/handlers.js'

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
