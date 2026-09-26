// DEMO DATA ONLY. Deterministic sample shop, staff, catalog, suppliers, stock batches and history for the /admin prototype.
// Nothing here is a real SkinMatrix employee, customer, supplier, order, price, cost, batch or stock level.

import { STATUS } from '../lib/orderStates.js'
import { DAY, MINUTE, HOUR, businessDayKey } from '../lib/time.js'
import { demoPinHash } from '../lib/demoPin.js'
import { ean13CheckDigit, returnValue } from '../lib/pricing.js'
import { actorRef, historyEntry, priceLines, SYSTEM_ACTOR } from './records.js'

export const SEED_VERSION = 4

// One shop. Records keep a branchId so a second shop later is configuration, not a rebuild.
export const SHOP_ID = 'shop'
export const DEMO_BRANCHES = [{ id: SHOP_ID, name: 'SkinMatrix Shop (demo)', short: 'Shop' }]

// Demo PINs are shown on the sign-in screen so the prototype can be tried. Only hashes are stored.
export const DEMO_PINS = { 'st-owner': '9000', 'st-kwame': '5000', 'st-akosua': '1111', 'st-yaw': '2222' }

const person = (id, name, role, extra = {}) => ({ id, name, role, branchId: SHOP_ID, active: true, phone: '', pinHash: DEMO_PINS[id] ? demoPinHash(id, DEMO_PINS[id]) : null, createdAt: null, lastActiveAt: null, ...extra })
export const DEMO_STAFF = [
  person('st-owner', 'Owner (demo)', 'owner'),
  person('st-kwame', 'Kwame O.', 'manager'),
  person('st-akosua', 'Akosua M.', 'staff'),
  person('st-yaw', 'Yaw B.', 'staff'),
  person('st-kofi', 'Kofi T.', 'staff', { active: false }),
]

// 603 is Ghana's GS1 barcode prefix; the rest are made up.
let barcodeSeq = 0
const barcode = () => { barcodeSeq += 1; const body = `6030001${String(barcodeSeq).padStart(5, '0')}`; return body + ean13CheckDigit(body) }
const variant = (id, name, sku, price, costRatio) => ({ id, name, sku, price, cost: Math.round(price * costRatio / 100) * 100, barcode: barcode() })
const product = (id, name, category, reorderPoint, variants, extra = {}) => ({ id, name, category, reorderPoint, walkInOnly: false, tracksExpiry: true, active: true, variants, ...extra })

// Prices and costs are integer pesewas.
export const DEMO_CATALOG = [
  product('p-collagen', 'Collagen Complex', 'Nutrition', 6, [variant('v-collagen-30', '30 servings', 'SM-COL-30', 34000, 0.55), variant('v-collagen-60', '60 servings', 'SM-COL-60', 62000, 0.52)]),
  product('p-barrier', 'Barrier Serum', 'Skincare', 5, [variant('v-barrier-30', '30 ml', 'SM-BAR-30', 28500, 0.48), variant('v-barrier-50', '50 ml', 'SM-BAR-50', 41000, 0.46)]),
  product('p-magnesium', 'Magnesium Night', 'Nutrition', 6, [variant('v-magnesium-60', '60 capsules', 'SM-MAG-60', 19000, 0.5)]),
  product('p-vitc', 'Vitamin C Brightening Serum', 'Skincare', 5, [variant('v-vitc-30', '30 ml', 'SM-VTC-30', 26000, 0.45)]),
  product('p-biotin', 'Biotin Hair Gummies', 'Nutrition', 8, [variant('v-biotin-60', '60 gummies', 'SM-BIO-60', 16500, 0.55)]),
  product('p-spf', 'Daily SPF 50 Fluid', 'Skincare', 8, [variant('v-spf-50', '50 ml', 'SM-SPF-50', 22000, 0.5)]),
  product('p-omega', 'Omega 3 Softgels', 'Nutrition', 6, [variant('v-omega-90', '90 softgels', 'SM-OMG-90', 21000, 0.58)]),
  product('p-ha', 'Hyaluronic Hydration Serum', 'Skincare', 5, [variant('v-ha-30', '30 ml', 'SM-HYA-30', 24500, 0.44)]),
  product('p-niacinamide', 'Niacinamide Balancing Drops', 'Skincare', 5, [variant('v-niacinamide-30', '30 ml', 'SM-NIA-30', 19500, 0.42)]),
  product('p-sleeptea', 'Rest Ritual Sleep Tea', 'Wellness', 10, [variant('v-sleeptea-20', '20 sachets', 'SM-TEA-20', 9500, 0.4)]),
  product('p-probiotic', 'Daily Probiotic', 'Nutrition', 6, [variant('v-probiotic-30', '30 capsules', 'SM-PRO-30', 23000, 0.57)]),
  product('p-d3', 'Vitamin D3 + K2', 'Nutrition', 6, [variant('v-d3-60', '60 capsules', 'SM-D3K-60', 15000, 0.5)]),
  // Counter-only: sold through the POS, never shown on the website.
  product('p-pouch', 'SkinMatrix Gift Pouch', 'Accessories', 10, [variant('v-pouch', 'Standard', 'SM-GFT-01', 2500, 0.3)], { walkInOnly: true, tracksExpiry: false }),
]

export const DEMO_SUPPLIERS = [
  { id: 'sup-1', name: 'Demo Supplier — Nutrition', contact: 'A. Mensah', phone: '030 200 0001', active: true },
  { id: 'sup-2', name: 'Demo Supplier — Skincare', contact: 'B. Owusu', phone: '030 200 0002', active: true },
  { id: 'sup-3', name: 'Demo Supplier — Packaging', contact: 'C. Adjei', phone: '030 200 0003', active: true },
]
const supplierFor = (category) => (category === 'Nutrition' || category === 'Wellness' ? 'sup-1' : category === 'Skincare' ? 'sup-2' : 'sup-3')

// Repeat customers so the customer records have history. Phones are fictional.
const CUSTOMER_POOL = [
  ['Ama K.', '0241002001'], ['Esi A.', '0201002002'], ['Kojo M.', '0551002003'], ['Afia D.', '0271002004'],
  ['Selasi N.', '0241002005'], ['Dede O.', '0501002006'], ['Mawuli T.', '0261002007'], ['Naa B.', '0541002008'],
  ['Fiifi G.', '0241002009'], ['Ekua F.', '0201002010'], ['Kweku A.', '0551002011'], ['Adjoa M.', '0591002012'],
  ['Yaa S.', '0241002013'], ['Nii O.', '0271002014'],
]
const RIDERS = [
  { name: 'Ebo R.', phone: '024 000 3001', vehicle: 'Motorbike', plate: 'M-26-1011', company: 'Demo Dispatch' },
  { name: 'Musah I.', phone: '055 000 3002', vehicle: 'Motorbike', plate: 'M-25-2217', company: 'Demo Dispatch' },
  { name: 'Kwesi P.', phone: '020 000 3003', vehicle: 'Car', plate: 'GR 4410-24', company: '' },
]

// Small seeded PRNG so every reset produces the same shape of history.
function mulberry32(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const dayOffset = (now, days) => businessDayKey(now + days * DAY)

export function createSeedState(now) {
  const rand = mulberry32(20260926)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const int = (min, max) => min + Math.floor(rand() * (max - min + 1))
  const catalog = structuredClone(DEMO_CATALOG)
  const allVariants = catalog.flatMap((entry) => entry.variants.map((item) => ({ product: entry, variant: item })))
  const variantOf = (id) => allVariants.find((entry) => entry.variant.id === id)
  const staffById = (id) => DEMO_STAFF.find((member) => member.id === id)
  const tillStaff = ['st-akosua', 'st-akosua', 'st-yaw', 'st-kwame'].map(staffById)
  const owner = staffById('st-owner')
  const manager = staffById('st-kwame')

  const state = {
    version: SEED_VERSION,
    seededAt: now,
    catalog,
    branches: DEMO_BRANCHES,
    staff: DEMO_STAFF.map((member) => ({ ...member, createdAt: now - 200 * DAY, lastActiveAt: member.active ? now - int(1, 30) * HOUR : now - 40 * DAY })),
    suppliers: DEMO_SUPPLIERS,
    listings: {},
    batches: [],
    deliveries: [],
    priceHistory: [],
    orders: [],
    holds: [],
    exceptions: [],
    movements: [],
    audit: [],
    stockCounts: [],
    idempotency: {},
    counters: { web: 10400, pos: 20400, momo: 5100, audit: 0, movement: 0, note: 0, batch: 0, count: 0, delivery: 0, return: 0, staff: 10, supplier: 3, product: 0 },
  }

  const audit = (entry) => {
    state.counters.audit += 1
    state.audit.push({ id: `AU-${state.counters.audit}`, ...entry })
  }
  const movement = (entry) => {
    state.counters.movement += 1
    state.movements.push({ id: `MV-${state.counters.movement}`, batchId: null, lot: null, reason: '', ...entry })
  }
  const addBatch = (variantId, quantity, lot, expiresOn, receivedAt, costFactor = 1) => {
    state.counters.batch += 1
    const { product: item, variant: line } = variantOf(variantId)
    const batch = { id: `B-${state.counters.batch}`, variantId, branchId: SHOP_ID, lot, expiresOn, quantity, receivedAt, unitCost: Math.round((line.cost * costFactor) / 100) * 100, supplierId: supplierFor(item.category), deliveryId: null }
    state.batches.push(batch)
    return batch
  }

  // ── Listings and current shelf stock, in batches ──────────────────────────────────────────
  const targets = { 'v-collagen-60': 3, 'v-spf-50': 5, 'v-ha-30': 4, 'v-vitc-30': 9 }
  for (const { product: item, variant: line } of allVariants) {
    state.listings[line.id] = { [SHOP_ID]: true }
    const quantity = targets[line.id] ?? int(10, 34)
    const receivedAt = now - int(15, 60) * DAY
    if (!item.tracksExpiry) { addBatch(line.id, quantity, `P${int(10, 99)}`, null, receivedAt); continue }
    const split = quantity >= 12 && rand() < 0.5
    const older = split ? int(2, Math.floor(quantity / 3)) : 0
    // Older stock was bought a little cheaper: cost differs by batch, which is why margin is costed per batch.
    if (older) addBatch(line.id, older, `L${int(2501, 2512)}`, dayOffset(now, int(120, 240)), receivedAt - 45 * DAY, 0.94)
    addBatch(line.id, quantity - older, `L${int(2601, 2609)}`, dayOffset(now, int(300, 720)), receivedAt)
  }
  // Deliberate expiry cases to exercise the Expiry view and first-expiry-first-out selling.
  addBatch('v-vitc-30', 3, 'L2412X', dayOffset(now, 21), now - 200 * DAY, 0.95)
  addBatch('v-probiotic-30', 6, 'L2501X', dayOffset(now, 62), now - 180 * DAY, 0.95)
  addBatch('v-sleeptea-20', 4, 'L2502X', dayOffset(now, 76), now - 150 * DAY, 0.95)
  addBatch('v-ha-30', 2, 'L2406X', dayOffset(now, -5), now - 300 * DAY, 0.95)

  // Supplier deliveries: the batches received in the last 60 days, grouped by supplier.
  for (const supplier of DEMO_SUPPLIERS) {
    const received = state.batches.filter((batch) => batch.supplierId === supplier.id && batch.receivedAt >= now - 60 * DAY)
    if (!received.length) continue
    state.counters.delivery += 1
    const id = `DL-${state.counters.delivery}`
    const at = Math.min(...received.map((batch) => batch.receivedAt))
    for (const batch of received) { batch.deliveryId = id; batch.receivedAt = at }
    const lines = received.map((batch) => ({ variantId: batch.variantId, batchId: batch.id, lot: batch.lot, expiresOn: batch.expiresOn, quantity: batch.quantity + int(0, 6), unitCost: batch.unitCost }))
    state.deliveries.push({ id, at, by: actorRef(manager), supplierId: supplier.id, invoiceRef: `INV-${int(1000, 9999)}`, note: '', lines, totalCost: lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0) })
    audit({ at, type: 'delivery_received', actor: actorRef(manager), branchId: SHOP_ID, ref: id, summary: `Delivery ${id} from ${supplier.name}: ${lines.length} lines` })
  }

  // The batch a past sale took from (history only: shelf numbers above are already after these sales).
  const firstBatch = (variantId) => state.batches.find((batch) => batch.variantId === variantId) || null
  const deductionsFor = (items) => items.map((item) => ({ variantId: item.variantId, branchId: SHOP_ID, batchId: firstBatch(item.variantId)?.id || null, quantity: item.quantity }))
  const saleMovements = (deductions, at, ref, actorName, kind = 'sale', reason = '') => {
    for (const deduction of deductions) {
      const batch = state.batches.find((candidate) => candidate.id === deduction.batchId)
      movement({ at, variantId: deduction.variantId, branchId: SHOP_ID, batchId: deduction.batchId, lot: batch?.lot || null, delta: kind === 'sale' ? -deduction.quantity : deduction.quantity, kind, ref, actorName, reason })
    }
  }

  const randomLines = () => {
    const count = int(1, 3)
    const chosen = new Map()
    while (chosen.size < count) chosen.set(pick(allVariants).variant.id, int(1, 2))
    return [...chosen.entries()].map(([variantId, quantity]) => ({ variantId, quantity }))
  }
  // About half of named customers are regulars from the pool; the rest are one-off buyers.
  const customerFrom = (required) => {
    if (!required && rand() < 0.4) return null
    if (rand() < 0.5) {
      const [name, phone] = pick(CUSTOMER_POOL)
      return { name, phone, email: '' }
    }
    return { name: `${pick(['Akos', 'Edem', 'Kafui', 'Nhyira', 'Sena', 'Baaba', 'Kobby', 'Aseye'])} ${pick(['A.', 'B.', 'D.', 'K.', 'O.'])}`, phone: `02${int(0, 9)}${int(1000000, 9999999)}`, email: '' }
  }
  const momoRef = () => `${int(10000, 99999)}${int(100000, 999999)}`

  // ── Order history: 14 days ────────────────────────────────────────────────────────────────
  const todayStart = Date.parse(`${businessDayKey(now)}T00:00:00Z`)
  const TODAY_WEB = [
    { status: STATUS.AWAITING_PAYMENT, method: 'delivery' },
    { status: STATUS.PAID, method: 'delivery' },
    { status: STATUS.PROCESSING, method: 'pickup' },
    { status: STATUS.READY, method: 'delivery', rider: false },
    { status: STATUS.OUT_FOR_DELIVERY, method: 'delivery', rider: true },
    { status: STATUS.READY, method: 'pickup' },
  ]
  let todayWeb = 0

  for (let daysAgo = 13; daysAgo >= 0; daysAgo -= 1) {
    const count = daysAgo === 0 ? 12 : int(4, 8)
    for (let i = 0; i < count; i += 1) {
      const createdAt = daysAgo === 0
        ? now - int(4, 420) * MINUTE
        : todayStart - daysAgo * DAY + int(8 * 60, 20 * 60) * MINUTE
      const channel = daysAgo === 0 ? (i % 2 ? 'pos' : 'web') : rand() < 0.6 ? 'pos' : 'web'
      const { items, subtotal } = priceLines(catalog, randomLines())

      if (channel === 'pos') {
        const cashier = pick(tillStaff)
        // Some counter sales carry a discount; the bigger ones were approved by the manager.
        let discount = null
        const discountRoll = rand()
        if (discountRoll < 0.12) {
          const value = discountRoll < 0.03 ? 20 : pick([5, 10])
          const approvedBy = value > 10 && cashier.role === 'staff' ? actorRef(manager) : null
          discount = { type: 'percent', value, amount: Math.round((subtotal * value) / 100), reason: value > 10 ? 'Regular customer, bulk purchase' : pick(['Loyal customer', 'Bundle offer', 'Slightly dented box']), approvedBy }
        }
        const total = subtotal - (discount?.amount || 0)
        const roll = rand()
        const method = roll < 0.5 ? 'cash' : 'momo'
        const mode = roll < 0.88 ? 'recorded' : 'live'
        state.counters.pos += 1
        let payment
        if (method === 'cash') {
          const tendered = Math.ceil(total / 5000) * 5000
          payment = { method, state: 'paid', reference: null, tendered, change: tendered - total }
        } else if (mode === 'recorded') {
          payment = { method, mode, state: 'paid', reference: momoRef(), network: pick(['MTN', 'MTN', 'Telecel', 'AT']), amountReceived: total, change: 0 }
        } else {
          state.counters.momo += 1
          payment = { method, mode, state: 'paid', reference: `DEMO-MOMO-${state.counters.momo}`, network: pick(['MTN', 'Telecel', 'AT']) }
        }
        const deductions = deductionsFor(items)
        const order = {
          id: `POS-${state.counters.pos}`, channel: 'pos', branchId: SHOP_ID, createdAt, completedAt: createdAt, createdBy: actorRef(cashier),
          customer: customerFrom(false), fulfilment: { method: 'counter', assigneeId: cashier.id, rider: null },
          items, subtotal, discount, total, payment, status: STATUS.FULFILLED,
          statusHistory: [historyEntry({ at: createdAt, from: null, to: STATUS.FULFILLED, by: actorRef(cashier), reason: 'Counter sale completed' })],
          notes: [], corrections: [], returns: [], stockDeductions: deductions, restockedAt: null, needsBranch: false,
        }
        state.orders.push(order)
        saleMovements(deductions, createdAt, order.id, cashier.name)
        audit({ at: createdAt, type: 'sale_created', actor: actorRef(cashier), branchId: SHOP_ID, ref: order.id, summary: `${method === 'cash' ? 'Cash' : mode === 'live' ? 'MoMo (prompt)' : 'MoMo (to shop)'} counter sale ${order.id}${discount ? ` · ${discount.value}% off` : ''}` })
        if (discount?.approvedBy) audit({ at: createdAt, type: 'approval', actor: discount.approvedBy, branchId: SHOP_ID, ref: order.id, summary: `${manager.name} approved a ${discount.value}% discount for ${cashier.name}`, detail: discount.reason })
        continue
      }

      // Web order. Older ones are finished; today's are spread across the working states.
      let plan = { status: STATUS.FULFILLED, method: rand() < 0.6 ? 'delivery' : 'pickup' }
      if (daysAgo === 1) plan = pick([{ status: STATUS.FULFILLED, method: 'delivery' }, { status: STATUS.FULFILLED, method: 'pickup' }, { status: STATUS.READY, method: 'pickup' }])
      if (daysAgo === 0) plan = TODAY_WEB[todayWeb++ % TODAY_WEB.length]
      const { status, method: fulfilmentMethod } = plan
      const cancelled = daysAgo > 2 && rand() < 0.08
      const paymentMethod = rand() < 0.7 ? 'momo' : 'card'
      const paid = status !== STATUS.AWAITING_PAYMENT
      state.counters.web += 1
      const handler = pick(tillStaff)
      const rider = fulfilmentMethod === 'delivery' && (status === STATUS.FULFILLED || plan.rider) ? { ...pick(RIDERS), assignedAt: createdAt + HOUR, assignedBy: actorRef(handler) } : null
      const order = {
        id: `WEB-${state.counters.web}`, channel: 'web', branchId: SHOP_ID, createdAt, completedAt: null, createdBy: null,
        customer: customerFrom(true), fulfilment: { method: fulfilmentMethod, assigneeId: status === STATUS.PAID ? null : handler.id, rider },
        items, subtotal, discount: null, total: subtotal,
        payment: { method: paymentMethod, mode: 'live', state: paid ? 'paid' : 'pending', reference: `DEMO-PAY-${state.counters.web}` },
        status,
        statusHistory: [historyEntry({ at: createdAt, from: null, to: STATUS.AWAITING_PAYMENT, by: SYSTEM_ACTOR, reason: 'Web checkout started' })],
        notes: [], corrections: [], returns: [], stockDeductions: null, restockedAt: null, needsBranch: false,
      }
      if (paid) {
        const paidAt = Math.min(createdAt + int(1, 6) * MINUTE, now - 2 * MINUTE)
        order.statusHistory.push(historyEntry({ at: paidAt, from: STATUS.AWAITING_PAYMENT, to: STATUS.PAID, by: SYSTEM_ACTOR, reason: 'Payment verified · stock reserved from the shop' }))
        order.stockDeductions = deductionsFor(items)
        saleMovements(order.stockDeductions, paidAt, order.id, SYSTEM_ACTOR.name)
        const path = fulfilmentMethod === 'delivery'
          ? [STATUS.PROCESSING, STATUS.READY, STATUS.OUT_FOR_DELIVERY, STATUS.FULFILLED]
          : [STATUS.PROCESSING, STATUS.READY, STATUS.FULFILLED]
        let previous = STATUS.PAID
        let at = paidAt
        for (const next of path) {
          if (path.indexOf(next) > path.indexOf(status)) break
          at = Math.min(at + int(20, 150) * MINUTE, now - MINUTE)
          order.statusHistory.push(historyEntry({ at, from: previous, to: next, by: actorRef(handler) }))
          previous = next
          if (next === STATUS.FULFILLED) order.completedAt = at
        }
        if (cancelled) {
          at += HOUR
          const reason = 'Customer cancelled before dispatch'
          order.statusHistory.push(historyEntry({ at, from: previous, to: STATUS.CANCELLED, by: actorRef(manager), reason }))
          order.status = STATUS.CANCELLED
          order.payment.state = 'refunded'
          order.restockedAt = at
          saleMovements(order.stockDeductions, at, order.id, manager.name, 'restock', reason)
          audit({ at, type: 'status_change', actor: actorRef(manager), branchId: SHOP_ID, ref: order.id, summary: `${order.id} cancelled and refunded`, detail: reason })
        }
      }
      if (daysAgo === 0 && status === STATUS.AWAITING_PAYMENT) {
        order.createdAt = now - 95 * MINUTE
        order.statusHistory = [historyEntry({ at: order.createdAt, from: null, to: STATUS.AWAITING_PAYMENT, by: SYSTEM_ACTOR, reason: 'Web checkout started' })]
      }
      state.orders.push(order)
    }
  }

  // A paid web order the shop cannot supply in full (4 × Collagen 60, only 3 on the shelf): no stock taken until restocked.
  {
    const { items, subtotal } = priceLines(catalog, [{ variantId: 'v-collagen-60', quantity: 4 }, { variantId: 'v-omega-90', quantity: 1 }])
    const createdAt = now - 40 * MINUTE
    state.counters.web += 1
    state.orders.push({
      id: `WEB-${state.counters.web}`, channel: 'web', branchId: null, createdAt, completedAt: null, createdBy: null,
      customer: { name: 'Yaa S.', phone: '0241002013', email: '' },
      fulfilment: { method: 'delivery', assigneeId: null, rider: null },
      items, subtotal, discount: null, total: subtotal,
      payment: { method: 'card', mode: 'live', state: 'paid', reference: `DEMO-PAY-${state.counters.web}` },
      status: STATUS.PAID,
      statusHistory: [
        historyEntry({ at: createdAt, from: null, to: STATUS.AWAITING_PAYMENT, by: SYSTEM_ACTOR, reason: 'Web checkout started' }),
        historyEntry({ at: createdAt + 2 * MINUTE, from: STATUS.AWAITING_PAYMENT, to: STATUS.PAID, by: SYSTEM_ACTOR, reason: 'Payment verified · not enough stock in the shop for every item' }),
      ],
      notes: [], corrections: [], returns: [], stockDeductions: null, restockedAt: null, needsBranch: true,
    })
  }

  // A voided counter sale from yesterday, restocked once.
  const yesterday = businessDayKey(now - DAY)
  const voidable = state.orders.find((order) => order.channel === 'pos' && order.payment.method === 'cash' && !order.discount && businessDayKey(order.createdAt) === yesterday)
  if (voidable) {
    const at = voidable.createdAt + 25 * MINUTE
    const reason = 'Rang up wrong product; customer re-purchased correct item'
    voidable.status = STATUS.CANCELLED
    voidable.payment.state = 'refunded'
    voidable.restockedAt = at
    voidable.statusHistory.push(historyEntry({ at, from: STATUS.FULFILLED, to: STATUS.CANCELLED, by: actorRef(manager), reason }))
    saleMovements(voidable.stockDeductions, at, voidable.id, manager.name, 'restock', reason)
    audit({ at, type: 'void', actor: actorRef(manager), branchId: SHOP_ID, ref: voidable.id, summary: `Voided ${voidable.id}; stock restored`, detail: reason })
  }

  // Two returns: a resaleable partial return approved by the manager, and a damaged item returned on a web order.
  const returnable = state.orders.filter((order) => order.status === STATUS.FULFILLED && order.createdAt < now - 2 * DAY && order.items.some((item) => item.quantity >= 2))
  for (const [index, order] of returnable.slice(0, 2).entries()) {
    const item = order.items.find((line) => line.quantity >= 2)
    const condition = index === 0 ? 'resaleable' : 'damaged'
    const at = order.createdAt + DAY
    const amount = returnValue(order, item.variantId, 1)
    const deduction = order.stockDeductions.find((candidate) => candidate.variantId === item.variantId)
    deduction.quantity -= 1
    order.stockDeductions = order.stockDeductions.filter((candidate) => candidate.quantity > 0)
    state.counters.return += 1
    const refundMethod = order.payment.method === 'cash' ? 'cash' : 'momo'
    const reason = condition === 'resaleable' ? 'Bought two by mistake, one unopened' : 'Pump broken on arrival'
    order.returns.push({ id: `RT-${state.counters.return}`, at, by: actorRef(pick(tillStaff)), approvedBy: actorRef(manager), lines: [{ variantId: item.variantId, quantity: 1 }], condition, amount, refundMethod, reference: refundMethod === 'momo' ? momoRef() : null, reason })
    order.payment.state = 'part_refunded'
    if (condition === 'resaleable') movement({ at, variantId: item.variantId, branchId: SHOP_ID, batchId: deduction.batchId, lot: firstBatch(item.variantId)?.lot, delta: 1, kind: 'return', ref: order.id, actorName: manager.name, reason })
    audit({ at, type: 'return', actor: actorRef(manager), branchId: SHOP_ID, ref: order.id, summary: `Return on ${order.id}: 1 × ${item.name} (${condition})`, detail: reason })
  }

  // A price change in the history.
  {
    const at = now - 9 * DAY
    state.priceHistory.push({ at, by: actorRef(owner), variantId: 'v-magnesium-60', sku: 'SM-MAG-60', from: 18000, to: 19000 })
    audit({ at, type: 'price_change', actor: actorRef(owner), branchId: null, ref: 'SM-MAG-60', summary: 'Price of Magnesium Night (60 capsules) GHS 180.00 → GHS 190.00' })
  }

  // A stock take three days ago that found one unit missing.
  {
    const at = morningOf(now, 3, 7 * HOUR)
    const batch = firstBatch('v-biotin-60')
    state.counters.count += 1
    state.stockCounts.push({
      id: `SC-${state.counters.count}`, branchId: SHOP_ID, at, by: actorRef(manager), note: 'Monthly shelf count',
      lines: state.batches.filter((candidate) => candidate.quantity > 0).map((candidate) => ({
        batchId: candidate.id, variantId: candidate.variantId, lot: candidate.lot, expected: candidate.quantity + (candidate.id === batch.id ? 1 : 0), counted: candidate.quantity,
      })),
    })
    movement({ at, variantId: 'v-biotin-60', branchId: SHOP_ID, batchId: batch.id, lot: batch.lot, delta: -1, kind: 'count', ref: `SC-${state.counters.count}`, actorName: manager.name, reason: 'Monthly shelf count' })
    audit({ at, type: 'stock_take', actor: actorRef(manager), branchId: SHOP_ID, ref: `SC-${state.counters.count}`, summary: 'Stock take: 1 line differed (-1 unit)', detail: 'Monthly shelf count' })
  }

  // One live MoMo prompt that expired earlier today, and the late payment that arrived after it: an exception.
  const cashier = staffById('st-akosua')
  const declined = priceLines(catalog, [{ variantId: 'v-barrier-30', quantity: 1 }, { variantId: 'v-spf-50', quantity: 1 }])
  state.counters.momo += 1
  const declinedRef = `DEMO-MOMO-${state.counters.momo}`
  const declinedAt = now - 150 * MINUTE
  state.holds.push({
    reference: declinedRef, branchId: SHOP_ID,
    items: declined.items.map((item) => ({ ...item, allocations: [{ batchId: firstBatch(item.variantId).id, quantity: item.quantity }] })),
    amount: declined.subtotal, discount: null, status: 'released', releaseReason: 'expired',
    createdAt: declinedAt, expiresAt: declinedAt + 5 * MINUTE, closedAt: declinedAt + 5 * MINUTE,
    payer: { phone: '0244000000', network: 'MTN' }, customer: null, createdBy: actorRef(cashier), orderId: null, idempotencyKey: 'seed-declined',
  })
  audit({ at: declinedAt + 5 * MINUTE, type: 'hold_released', actor: SYSTEM_ACTOR, branchId: SHOP_ID, ref: declinedRef, summary: `MoMo hold ${declinedRef} expired; 2 units returned to shelf` })
  state.exceptions.push({
    reference: declinedRef, branchId: SHOP_ID, at: declinedAt + 11 * MINUTE, amount: declined.subtotal, kind: 'hold_released',
    message: 'Payment confirmed after the stock hold had expired. No sale was created and stock was not changed.', status: 'open', resolution: null,
  })
  audit({ at: declinedAt + 11 * MINUTE, type: 'payment_exception', actor: SYSTEM_ACTOR, branchId: SHOP_ID, ref: declinedRef, summary: `Late MoMo payment on released hold ${declinedRef}` })

  // Staff sign-ins for the activity record.
  for (const member of state.staff.filter((candidate) => candidate.active)) {
    audit({ at: member.lastActiveAt, type: 'login', actor: actorRef(member), branchId: SHOP_ID, ref: null, summary: `${member.name} signed in` })
  }

  // A couple of staff notes for realism.
  const withNote = state.orders.filter((order) => order.channel === 'web' && order.status === STATUS.READY).slice(0, 2)
  for (const order of withNote) {
    state.counters.note += 1
    order.notes.push({ id: `N-${state.counters.note}`, at: order.statusHistory.at(-1).at + 10 * MINUTE, by: order.statusHistory.at(-1).by, text: 'Customer asked for a call before dispatch.' })
  }

  state.orders.sort((a, b) => b.createdAt - a.createdAt)
  state.movements.sort((a, b) => b.at - a.at)
  state.audit.sort((a, b) => b.at - a.at)
  return state
}

function morningOf(now, days, offset) {
  return Math.min(now - MINUTE, Date.parse(`${businessDayKey(now - days * DAY)}T00:00:00Z`) + 9 * HOUR + offset)
}
