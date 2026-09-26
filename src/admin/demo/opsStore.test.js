import { beforeEach, describe, expect, it } from 'vitest'
import { createOpsStore, HOLD_TTL_MS } from './opsStore.js'
import { DEMO_PINS, SHOP_ID } from './seed.js'
import { STATUS } from '../lib/orderStates.js'
import { batchesAt, expiredUnits, onHand } from '../lib/stock.js'
import { ledgerTotals } from '../lib/ledger.js'
import { productPerformance } from '../lib/margin.js'
import { DAY, MINUTE, businessDayKey } from '../lib/time.js'

const START = Date.parse('2026-09-26T12:00:00Z')
const staffA = { id: 'st-akosua' }
const staffB = { id: 'st-yaw' }
const manager = { id: 'st-kwame' }
const owner = { id: 'st-owner' }
const managerApproval = { approverId: 'st-kwame', pin: DEMO_PINS['st-kwame'] }
const ownerApproval = { approverId: 'st-owner', pin: DEMO_PINS['st-owner'] }

let clock
let store
const state = () => store.getState()
const shelf = (variantId) => onHand(state(), variantId, SHOP_ID, clock)
const cash = (tendered = 999999) => ({ method: 'cash', tendered })
const sell = (lines, extra = {}, actor = staffA) => store.completeCounterSale(actor, { branchId: SHOP_ID, lines, payment: cash(), ...extra })
const later = (days) => businessDayKey(clock + days * DAY)

beforeEach(() => {
  clock = START
  store = createOpsStore({ now: () => clock })
})

describe('counter sales', () => {
  it('re-prices from the catalog, takes stock once and is idempotent', async () => {
    const before = shelf('v-omega-90')
    const args = { branchId: SHOP_ID, lines: [{ variantId: 'v-omega-90', quantity: 2, unitPrice: 1 }], payment: cash(50000), idempotencyKey: 'k1' }
    const order = await store.completeCounterSale(staffA, args)
    expect(order).toMatchObject({ total: 42000, status: STATUS.FULFILLED, payment: { change: 8000 } })
    expect((await store.completeCounterSale(staffA, args)).id).toBe(order.id)
    expect(shelf('v-omega-90')).toBe(before - 2)
  })

  it('changes nothing when it fails', async () => {
    const before = structuredClone(state())
    await expect(sell([{ variantId: 'v-collagen-60', quantity: 150 }])).rejects.toMatchObject({ code: 'bad_quantity' })
    await expect(sell([{ variantId: 'v-omega-90', quantity: 1 }, { variantId: 'v-collagen-60', quantity: 4 }])).rejects.toMatchObject({ code: 'insufficient_stock' })
    expect(state()).toEqual(before)
  })

  it('records MoMo paid to the shop number once only', async () => {
    const momo = { method: 'momo', reference: '55012345678', network: 'MTN', amountReceived: 21000 }
    const order = await sell([{ variantId: 'v-omega-90', quantity: 1 }], { payment: momo })
    expect(order.payment).toMatchObject({ mode: 'recorded', reference: '55012345678' })
    await expect(sell([{ variantId: 'v-omega-90', quantity: 1 }], { payment: momo })).rejects.toMatchObject({ code: 'duplicate_reference' })
  })

  it('sells the soonest-expiring batch first and never an expired one', async () => {
    const [soonest] = batchesAt(state(), 'v-vitc-30', SHOP_ID)
    expect(soonest.lot).toBe('L2412X')
    const order = await sell([{ variantId: 'v-vitc-30', quantity: 4 }])
    expect(order.stockDeductions[0]).toMatchObject({ batchId: soonest.id, quantity: 3 })
    expect(expiredUnits(state(), 'v-ha-30', SHOP_ID, clock)).toBe(2)
    await expect(sell([{ variantId: 'v-ha-30', quantity: shelf('v-ha-30') + 1 }])).rejects.toMatchObject({ code: 'insufficient_stock' })
  })
})

describe('discounts and PIN approval', () => {
  const lines = [{ variantId: 'v-omega-90', quantity: 2 }]

  it('lets staff give up to 10% with a reason', async () => {
    const order = await sell(lines, { discount: { type: 'percent', value: 10, reason: 'Loyal customer' } })
    expect(order).toMatchObject({ subtotal: 42000, total: 37800, discount: { amount: 4200, approvedBy: null } })
    await expect(sell(lines, { discount: { type: 'percent', value: 5, reason: '' } })).rejects.toMatchObject({ code: 'reason_required' })
  })

  it('needs a manager PIN above the staff limit and records who approved', async () => {
    const discount = { type: 'percent', value: 20, reason: 'Bulk purchase' }
    await expect(sell(lines, { discount })).rejects.toMatchObject({ code: 'approval_required' })
    await expect(sell(lines, { discount, approval: { approverId: 'st-kwame', pin: '0000' } })).rejects.toMatchObject({ code: 'bad_pin' })
    await expect(sell(lines, { discount, approval: { approverId: 'st-yaw', pin: DEMO_PINS['st-yaw'] } })).rejects.toMatchObject({ code: 'bad_approval' })
    const order = await sell(lines, { discount, approval: managerApproval })
    expect(order.discount.approvedBy.name).toBe('Kwame O.')
    expect(state().audit.some((entry) => entry.type === 'approval' && entry.ref === order.id)).toBe(true)
  })

  it('lets a manager discount without approval, and never below zero', async () => {
    await expect(sell(lines, { discount: { type: 'percent', value: 30, reason: 'Clearance' } }, manager)).resolves.toMatchObject({ total: 29400 })
    await expect(sell(lines, { discount: { type: 'amount', value: 50000, reason: 'Too much' } }, manager)).rejects.toMatchObject({ code: 'bad_discount' })
  })

  it('applies the discount to a MoMo prompt as well', async () => {
    const hold = await store.startMomoSale(staffA, { branchId: SHOP_ID, lines, payerPhone: '0241234567', network: 'MTN', discount: { type: 'amount', value: 2000, reason: 'Promo' } })
    expect(hold.amount).toBe(40000)
    const { order } = await store.settleMomoPayment({ reference: hold.reference, amount: 40000 })
    expect(order).toMatchObject({ subtotal: 42000, total: 40000, discount: { amount: 2000 } })
  })
})

describe('voids and corrections', () => {
  it('lets staff void only with a manager PIN, and restocks exactly once', async () => {
    const before = shelf('v-omega-90')
    const order = await sell([{ variantId: 'v-omega-90', quantity: 2 }])
    await expect(store.setOrderStatus(staffA, { orderId: order.id, to: STATUS.CANCELLED, reason: 'Wrong item rung up' })).rejects.toMatchObject({ code: 'approval_required' })
    const result = await store.setOrderStatus(staffA, { orderId: order.id, to: STATUS.CANCELLED, reason: 'Wrong item rung up', approval: managerApproval })
    expect(result.restocked).toBe(true)
    expect(result.order.statusHistory.at(-1).reason).toMatch(/approved by Kwame O\./)
    expect(shelf('v-omega-90')).toBe(before)
    expect((await store.setOrderStatus(manager, { orderId: order.id, to: STATUS.CANCELLED, reason: 'again' })).unchanged).toBe(true)
  })

  it('limits the manager to same-day voids; the owner can void any day', async () => {
    const order = await sell([{ variantId: 'v-omega-90', quantity: 1 }])
    clock += DAY
    await expect(store.setOrderStatus(manager, { orderId: order.id, to: STATUS.CANCELLED, reason: 'Late correction' })).rejects.toMatchObject({ code: 'approval_required' })
    await expect(store.setOrderStatus(staffA, { orderId: order.id, to: STATUS.CANCELLED, reason: 'Late correction', approval: managerApproval })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(store.setOrderStatus(staffA, { orderId: order.id, to: STATUS.CANCELLED, reason: 'Late correction', approval: ownerApproval })).resolves.toMatchObject({ restocked: true })
  })

  it('corrects a sale by moving only the difference, keeping the discount percentage', async () => {
    const omega = shelf('v-omega-90')
    const order = await sell([{ variantId: 'v-omega-90', quantity: 2 }], { discount: { type: 'percent', value: 10, reason: 'Loyal' } })
    const corrected = await store.correctPosSale(staffA, { orderId: order.id, lines: [{ variantId: 'v-omega-90', quantity: 1 }], reason: 'Only one taken', approval: managerApproval })
    expect(corrected).toMatchObject({ subtotal: 21000, total: 18900, discount: { amount: 2100 } })
    expect(shelf('v-omega-90')).toBe(omega - 1)
  })
})

describe('returns', () => {
  it('needs a manager, restocks resaleable units to their batch and refunds what was paid', async () => {
    const before = shelf('v-omega-90')
    const order = await sell([{ variantId: 'v-omega-90', quantity: 3 }], { discount: { type: 'percent', value: 10, reason: 'Loyal' } })
    const request = { orderId: order.id, lines: [{ variantId: 'v-omega-90', quantity: 1 }], condition: 'resaleable', refundMethod: 'cash', reason: 'Bought one too many' }
    await expect(store.returnItems(staffA, request)).rejects.toMatchObject({ code: 'approval_required' })
    const { entry, order: updated } = await store.returnItems(staffA, { ...request, approval: managerApproval })
    expect(entry.amount).toBe(18900)
    expect(updated.payment.state).toBe('part_refunded')
    expect(shelf('v-omega-90')).toBe(before - 2)
    await expect(store.returnItems(manager, { ...request, lines: [{ variantId: 'v-omega-90', quantity: 3 }] })).rejects.toMatchObject({ code: 'too_many' })
  })

  it('keeps damaged units off the shelf and nets returns out of the ledger', async () => {
    const before = shelf('v-d3-60')
    const order = await sell([{ variantId: 'v-d3-60', quantity: 2 }])
    await store.returnItems(manager, { orderId: order.id, lines: [{ variantId: 'v-d3-60', quantity: 2 }], condition: 'damaged', refundMethod: 'momo', reference: 'RF12345678', reason: 'Seal broken on both' })
    expect(shelf('v-d3-60')).toBe(before - 2)
    const updated = state().orders.find((candidate) => candidate.id === order.id)
    expect(updated.payment.state).toBe('refunded')
    expect(updated.stockDeductions).toHaveLength(0)
    const totals = ledgerTotals([updated])
    expect(totals).toMatchObject({ gross: 30000, returns: 30000, net: 0 })
    await expect(store.setOrderStatus(owner, { orderId: order.id, to: STATUS.CANCELLED, reason: 'Void after return' })).resolves.toMatchObject({ restocked: false })
  })

  it('requires a MoMo refund reference and the owner past the return window', async () => {
    const order = await sell([{ variantId: 'v-d3-60', quantity: 1 }])
    await expect(store.returnItems(manager, { orderId: order.id, lines: [{ variantId: 'v-d3-60', quantity: 1 }], condition: 'resaleable', refundMethod: 'momo', reason: 'Changed mind' })).rejects.toMatchObject({ code: 'bad_reference' })
    clock += 31 * DAY
    await expect(store.returnItems(manager, { orderId: order.id, lines: [{ variantId: 'v-d3-60', quantity: 1 }], condition: 'resaleable', refundMethod: 'cash', reason: 'Changed mind' })).rejects.toMatchObject({ code: 'approval_required' })
    await expect(store.returnItems(staffA, { orderId: order.id, lines: [{ variantId: 'v-d3-60', quantity: 1 }], condition: 'resaleable', refundMethod: 'cash', reason: 'Changed mind', approval: managerApproval })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(store.returnItems(owner, { orderId: order.id, lines: [{ variantId: 'v-d3-60', quantity: 1 }], condition: 'resaleable', refundMethod: 'cash', reason: 'Changed mind' })).resolves.toBeTruthy()
  })
})

describe('staff accounts', () => {
  it('signs in with a PIN and refuses a wrong one', async () => {
    await expect(store.signIn('st-akosua', '0000')).rejects.toMatchObject({ code: 'bad_pin' })
    const member = await store.signIn('st-akosua', DEMO_PINS['st-akosua'])
    expect(member).not.toHaveProperty('pinHash')
    expect(state().audit[0].type).toBe('login')
  })

  it('lets only the owner add, change and deactivate staff', async () => {
    await expect(store.createStaff(manager, { name: 'Efua D.', role: 'staff', pin: '4444' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(store.createStaff(owner, { name: 'Efua D.', role: 'staff', pin: '44' })).rejects.toMatchObject({ code: 'bad_pin' })
    const created = await store.createStaff(owner, { name: 'Efua D.', role: 'staff', pin: '4444', phone: '0241110000' })
    await expect(store.signIn(created.id, '4444')).resolves.toMatchObject({ name: 'Efua D.' })
    await store.updateStaff(owner, { staffId: created.id, active: false })
    await expect(store.signIn(created.id, '4444')).rejects.toMatchObject({ code: 'account_disabled' })
    await expect(sell([{ variantId: 'v-omega-90', quantity: 1 }], {}, { id: created.id })).rejects.toMatchObject({ code: 'account_disabled' })
  })

  it('protects the owner from locking themselves out', async () => {
    await expect(store.updateStaff(owner, { staffId: 'st-owner', role: 'staff' })).rejects.toMatchObject({ code: 'self_change' })
    await store.updateStaff(owner, { staffId: 'st-kwame', role: 'owner' })
    await expect(store.updateStaff({ id: 'st-kwame' }, { staffId: 'st-owner', active: false })).resolves.toMatchObject({ active: false })
  })

  it('lets staff change only their own PIN', async () => {
    await expect(store.setStaffPin(staffA, { staffId: 'st-yaw', pin: '9999' })).rejects.toMatchObject({ code: 'forbidden' })
    await store.setStaffPin(staffA, { staffId: 'st-akosua', pin: '7777' })
    await expect(store.signIn('st-akosua', '7777')).resolves.toBeTruthy()
  })
})

describe('products, deliveries and margin', () => {
  const product = () => structuredClone(state().catalog.find((entry) => entry.id === 'p-omega'))

  it('lets only the owner edit prices, and keeps the price history', async () => {
    const edit = product()
    edit.variants[0].price = 22500
    await expect(store.saveProduct(manager, { product: edit })).rejects.toMatchObject({ code: 'forbidden' })
    await store.saveProduct(owner, { product: edit })
    expect(state().priceHistory[0]).toMatchObject({ sku: 'SM-OMG-90', from: 21000, to: 22500 })
    const order = await sell([{ variantId: 'v-omega-90', quantity: 1 }])
    expect(order.total).toBe(22500)
  })

  it('rejects duplicate SKUs and bad barcodes, never removes sizes, and archives instead', async () => {
    const edit = product()
    edit.variants[0].sku = 'SM-COL-30'
    await expect(store.saveProduct(owner, { product: edit })).rejects.toMatchObject({ code: 'duplicate_sku' })
    const barcode = product()
    barcode.variants[0].barcode = '6030001000011'
    await expect(store.saveProduct(owner, { product: barcode })).rejects.toMatchObject({ code: 'bad_barcode' })
    const collagen = structuredClone(state().catalog.find((entry) => entry.id === 'p-collagen'))
    collagen.variants.pop()
    await expect(store.saveProduct(owner, { product: collagen })).rejects.toMatchObject({ code: 'variant_removed' })
    const archived = product()
    archived.active = false
    await store.saveProduct(owner, { product: archived })
    await expect(sell([{ variantId: 'v-omega-90', quantity: 1 }])).rejects.toMatchObject({ code: 'inactive_product' })
  })

  it('adds a new product that can then be received and sold', async () => {
    const created = await store.saveProduct(owner, { product: { name: 'Retinal Night Cream', category: 'Skincare', reorderPoint: 4, walkInOnly: false, tracksExpiry: true, variants: [{ name: '50 ml', sku: 'SM-RET-50', barcode: '', price: 38000, cost: 17000 }] } })
    const variantId = created.variants[0].id
    expect(shelf(variantId)).toBe(0)
    await store.receiveDelivery(manager, { branchId: SHOP_ID, supplierId: 'sup-2', invoiceRef: 'INV-1', lines: [{ variantId, lot: 'R2609', expiresOn: later(400), quantity: 10, unitCost: 16500 }] })
    expect(shelf(variantId)).toBe(10)
    const order = await sell([{ variantId, quantity: 2 }])
    const [row] = productPerformance([order], state().batches)
    expect(row).toMatchObject({ units: 2, revenue: 76000, cost: 33000, margin: 43000 })
  })

  it('records unit cost per batch on delivery and validates each line', async () => {
    await expect(store.receiveDelivery(staffA, { branchId: SHOP_ID, supplierId: 'sup-1', lines: [] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(store.receiveDelivery(manager, { branchId: SHOP_ID, supplierId: 'sup-1', lines: [{ variantId: 'v-omega-90', lot: 'L1', quantity: 5, unitCost: 12000 }] })).rejects.toMatchObject({ code: 'expiry_required' })
    const before = structuredClone(state())
    await expect(store.receiveDelivery(manager, { branchId: SHOP_ID, supplierId: 'sup-1', lines: [
      { variantId: 'v-omega-90', lot: 'L9', expiresOn: later(300), quantity: 5, unitCost: 12000 },
      { variantId: 'v-d3-60', lot: 'L9', expiresOn: '2020-01-01', quantity: 5, unitCost: 7000 },
    ] })).rejects.toMatchObject({ code: 'already_expired' })
    expect(state()).toEqual(before)
    const delivery = await store.receiveDelivery(manager, { branchId: SHOP_ID, supplierId: 'sup-1', invoiceRef: 'INV-77', lines: [{ variantId: 'v-omega-90', lot: 'L9', expiresOn: later(300), quantity: 5, unitCost: 12500 }] })
    expect(delivery.totalCost).toBe(62500)
    expect(state().catalog.find((entry) => entry.id === 'p-omega').variants[0].cost).toBe(12500)
  })

  it('costs margin from the batches a sale actually took', async () => {
    const order = await sell([{ variantId: 'v-vitc-30', quantity: 4 }])
    const cost = order.stockDeductions.reduce((sum, deduction) => sum + deduction.quantity * state().batches.find((batch) => batch.id === deduction.batchId).unitCost, 0)
    const [row] = productPerformance([order], state().batches)
    expect(row.cost).toBe(cost)
  })
})

describe('web orders, stock take and exceptions', () => {
  it('holds a web order the shop cannot supply until stock arrives, then takes it', async () => {
    const order = state().orders.find((candidate) => candidate.needsBranch)
    expect(order.stockDeductions).toBeNull()
    await expect(store.assignOrderBranch(staffA, { orderId: order.id, branchId: SHOP_ID, reason: 'Stock arrived' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(store.assignOrderBranch(manager, { orderId: order.id, branchId: SHOP_ID, reason: 'Stock arrived' })).rejects.toMatchObject({ code: 'insufficient_stock' })
    await store.receiveDelivery(manager, { branchId: SHOP_ID, supplierId: 'sup-1', lines: [{ variantId: 'v-collagen-60', lot: 'L2609Z', expiresOn: later(400), quantity: 5, unitCost: 32000 }] })
    const before = shelf('v-collagen-60')
    await expect(store.assignOrderBranch(manager, { orderId: order.id, branchId: SHOP_ID, reason: 'Delivery on the shelf' })).resolves.toMatchObject({ needsBranch: false })
    expect(shelf('v-collagen-60')).toBe(before - 4)
  })

  it('keeps delivery orders from going out without a rider', async () => {
    const order = state().orders.find((candidate) => candidate.status === STATUS.READY && candidate.fulfilment.method === 'delivery' && !candidate.fulfilment.rider)
    await expect(store.setOrderStatus(staffA, { orderId: order.id, to: STATUS.OUT_FOR_DELIVERY })).rejects.toMatchObject({ code: 'forbidden' })
    await store.assignRider(staffA, { orderId: order.id, rider: { name: 'Ebo R.', phone: '0240003001', vehicle: 'Motorbike' } })
    await store.setOrderStatus(staffA, { orderId: order.id, to: STATUS.OUT_FOR_DELIVERY })
    await expect(store.setOrderStatus(staffA, { orderId: order.id, to: STATUS.FULFILLED })).resolves.toMatchObject({ order: { status: STATUS.FULFILLED } })
  })

  it('refuses a stale stock count and applies a fresh one', async () => {
    const sheet = batchesAt(state(), 'v-omega-90', SHOP_ID).map((batch) => ({ batchId: batch.id, expected: batch.quantity, counted: batch.quantity }))
    sheet[0].counted -= 1
    await expect(store.submitStockCount(staffA, { branchId: SHOP_ID, lines: sheet, note: 'Count' })).rejects.toMatchObject({ code: 'forbidden' })
    await sell([{ variantId: 'v-omega-90', quantity: 1 }])
    await expect(store.submitStockCount(manager, { branchId: SHOP_ID, lines: sheet, note: 'Shelf count' })).rejects.toMatchObject({ code: 'stale_count' })
    const fresh = batchesAt(state(), 'v-omega-90', SHOP_ID).map((batch) => ({ batchId: batch.id, expected: batch.quantity, counted: batch.quantity }))
    fresh[0].counted -= 1
    const before = shelf('v-omega-90')
    await store.submitStockCount(manager, { branchId: SHOP_ID, lines: fresh, note: 'Shelf count, one missing' })
    expect(shelf('v-omega-90')).toBe(before - 1)
  })

  it('expires MoMo prompts and turns late payments into exceptions', async () => {
    const before = shelf('v-d3-60')
    const orders = state().orders.length
    const hold = await store.startMomoSale(staffA, { branchId: SHOP_ID, lines: [{ variantId: 'v-d3-60', quantity: 2 }], payerPhone: '0241234567', network: 'MTN' })
    clock += HOLD_TTL_MS + MINUTE
    expect(await store.sweepExpiredHolds()).toBe(1)
    expect(shelf('v-d3-60')).toBe(before)
    expect((await store.settleMomoPayment({ reference: hold.reference, amount: hold.amount })).outcome).toBe('exception')
    expect(state().orders).toHaveLength(orders)
  })

  it('seed data is internally consistent', () => {
    for (const order of state().orders) {
      expect(order.total).toBe(order.subtotal - (order.discount?.amount || 0))
      expect(order.subtotal).toBe(order.items.reduce((sum, item) => sum + item.lineTotal, 0))
      if (order.stockDeductions) expect(order.stockDeductions.every((deduction) => state().batches.some((batch) => batch.id === deduction.batchId))).toBe(true)
    }
    for (const batch of state().batches) {
      expect(batch.quantity).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(batch.unitCost)).toBe(true)
    }
    const references = state().orders.map((order) => order.payment.reference).filter(Boolean)
    expect(new Set(references).size).toBe(references.length)
    expect(state().staff.every((member) => !('pin' in member))).toBe(true)
  })
})
