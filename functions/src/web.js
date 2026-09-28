// Website orders. The browser only sends what the customer chose (product ids, quantities, their details);
// the server prices the order from the catalogue and saves it. Paystack payments are confirmed by asking
// Paystack directly (verifyWebPayment) and by Paystack's signed webhook, never by the browser's word.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { checkDetails, normalizeGhanaPhone, ORDER_REF, orderRefFromReference, priceWebOrder } from './core/order.js'
import { RuleError } from './core/rules.js'
import { businessDay } from './core/time.js'
import { checkRequestId } from './shared.js'
import { readSettings } from './settings.js'
import { sendSms, smsText } from './sms.js'

const WEBSITE = { uid: null, name: 'Website', role: 'customer' }
const PAYSTACK_VERIFY = 'https://api.paystack.co/transaction/verify/'
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const OPEN_ORDER_LIMIT = 5

const newRef = () => `SM-${Array.from(randomBytes(6), (byte) => REF_ALPHABET[byte % REF_ALPHABET.length]).join('')}`

function webAudit(tx, db, now, ref, summary, detail = '') {
  tx.set(db.collection('audit').doc(), { at: now, day: businessDay(now), type: 'web_order', actor: WEBSITE, ref, summary, detail })
}

const money = (pesewas) => `${(pesewas / 100).toFixed(2)} GHS`

// Texts the customer about their order, if the owner turned that message on. Never throws.
export async function notifyCustomer(ctx, order, kind) {
  try {
    const settings = await readSettings(ctx.db)
    const wanted = kind === 'order_placed' || kind === 'order_paid' ? settings.sms.orderPlaced : settings.sms.orderUpdates
    if (!wanted) return false
    const shop = (await ctx.db.doc('site/content').get()).data()?.shop || {}
    const text = smsText(kind, { ref: order.ref, total: order.total, shopName: shop.legalName || 'SkinMatrix', phone: shop.phone || '' })
    return await sendSms(ctx, settings, { to: order.customer?.phone, kind, ref: order.ref, text })
  } catch {
    return false
  }
}

// data: { requestId, payment: 'paystack' | 'pay_later', details: { name, phone, email, method, address, notes }, lines: [{ id, qty }] }
export async function placeWebOrder(ctx, data) {
  const { db, now } = ctx
  const requestId = checkRequestId(data?.requestId)
  const paymentMethod = ['paystack', 'pay_later'].includes(data?.payment) ? data.payment : null
  if (!paymentMethod) throw new RuleError('bad_payment', 'Choose how you want to pay.')
  const details = data?.details || {}

  const { order, created } = await db.runTransaction(async (tx) => {
    const requestRef = db.doc(`requests/web_${requestId}`)
    const request = await tx.get(requestRef)
    if (request.exists) return { order: request.data().result, created: false }
    const [contentSnap, catalogSnap, availabilitySnap] = await tx.getAll(db.doc('site/content'), db.doc('site/catalog'), db.doc('site/availability'))
    const checkout = { deliveryFee: null, pickup: true, paystackPublicKey: '', ...(contentSnap.data()?.checkout || {}) }
    const online = Boolean(checkout.paystackPublicKey)
    if (paymentMethod === 'paystack' && !online) throw new RuleError('bad_payment', 'Online payment is not available right now. Please try again later.')
    if (paymentMethod === 'pay_later' && online) throw new RuleError('bad_payment', 'Please pay online to place your order.')

    const errors = checkDetails(details, { needEmail: paymentMethod === 'paystack', delivery: true })
    if (details.method === 'pickup' && checkout.pickup === false) errors.method = 'Pickup is not available right now. Choose delivery.'
    if (Object.keys(errors).length) {
      const error = new RuleError('bad_details', Object.values(errors)[0])
      error.details = { fields: errors }
      throw error
    }
    const phone = normalizeGhanaPhone(details.phone)
    const waiting = await tx.get(db.collection('orders').where('customer.phone', '==', phone).where('status', '==', 'new').limit(OPEN_ORDER_LIMIT))
    if (waiting.size >= OPEN_ORDER_LIMIT) throw new RuleError('too_many_orders', 'You already have several orders waiting. We will call you soon. To change an order, please call us.')

    const priced = priceWebOrder({
      products: Array.isArray(catalogSnap.data()?.products) ? catalogSnap.data().products : [],
      availability: availabilitySnap.data()?.products || {},
      lines: data?.lines,
      method: details.method,
      deliveryFee: checkout.deliveryFee,
    })

    let ref = null
    for (let attempt = 0; attempt < 5 && !ref; attempt += 1) {
      const candidate = newRef()
      if (!(await tx.get(db.doc(`orders/${candidate}`))).exists) ref = candidate
    }
    if (!ref) throw new RuleError('busy', 'Please press the button again.')

    const method = details.method
    const next = {
      ref,
      channel: 'website',
      status: 'new',
      customer: { name: String(details.name).trim().slice(0, 80), phone, email: String(details.email || '').trim().slice(0, 120) },
      fulfilment: { method, address: method === 'delivery' ? String(details.address || '').trim().slice(0, 300) : '', notes: String(details.notes || '').trim().slice(0, 500) },
      ...priced,
      payment: paymentMethod === 'paystack'
        ? { method: 'paystack', status: 'pending', reference: null }
        : { method: 'pay_later', status: 'unpaid', reference: null },
      placedAt: now,
    }
    tx.set(db.doc(`orders/${ref}`), { ...next, createdAt: Timestamp.fromMillis(now) })
    tx.set(requestRef, { at: now, result: next })
    webAudit(tx, db, now, ref, `New website order ${ref}: ${priced.lines.reduce((sum, line) => sum + line.qty, 0)} item(s), ${money(priced.total)}`, paymentMethod === 'paystack' ? 'Waiting for Paystack payment' : 'Pay on delivery or pickup')
    return { order: next, created: true }
  })

  if (created && order.payment.method === 'pay_later') await notifyCustomer(ctx, order, 'order_placed')
  return order
}

// Records what Paystack says about a charge. charge is Paystack's transaction object. source: 'verify' | 'webhook'.
export async function applyPaystackCharge(ctx, charge, source) {
  const { db, now } = ctx
  const ref = orderRefFromReference(charge?.reference)
  if (!ref) return { status: 'ignored' }
  if (charge.status !== 'success') return { status: 'not_paid' }
  const orderRef = db.doc(`orders/${ref}`)
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef)
    if (!snap.exists) return { status: 'ignored' }
    const order = snap.data()
    if (order.payment?.status === 'paid') return { status: 'paid', changed: false, order }
    const ok = charge.currency === 'GHS' && charge.amount === order.total
    const payment = {
      method: 'paystack',
      status: ok ? 'paid' : 'mismatch',
      reference: String(charge.reference),
      amountPaid: Number.isInteger(charge.amount) ? charge.amount : null,
      currency: String(charge.currency || ''),
      channel: charge.channel ? String(charge.channel) : null,
      paidAt: Date.parse(charge.paid_at || charge.paidAt || '') || now,
      verifiedAt: now,
      verifiedBy: source,
    }
    tx.update(orderRef, { payment, updatedAt: now })
    webAudit(tx, db, now, ref, ok ? `Website order ${ref}: Paystack payment of ${money(order.total)} verified` : `Website order ${ref}: Paystack amount does not match`,
      ok ? `${payment.channel || 'paystack'} · ${payment.reference}${order.status === 'cancelled' ? ' · order was already cancelled, refund the customer' : ''}` : `Paid ${payment.amountPaid === null ? '?' : money(payment.amountPaid)} ${payment.currency}, order total ${money(order.total)}`)
    return { status: payment.status, changed: true, order: { ...order, payment } }
  })
  if (result.changed && result.status === 'paid') await notifyCustomer(ctx, result.order, 'order_paid')
  return { status: result.status }
}

// Called by the checkout after Paystack's popup reports success. data: { ref, reference }
export async function verifyWebPayment(ctx, data) {
  const { db, now } = ctx
  const ref = String(data?.ref ?? '')
  const reference = String(data?.reference ?? '')
  if (!ORDER_REF.test(ref) || orderRefFromReference(reference) !== ref) throw new RuleError('bad_reference', 'This payment does not belong to this order.')
  const orderRef = db.doc(`orders/${ref}`)
  const snap = await orderRef.get()
  if (!snap.exists) throw new RuleError('not_found', 'Order not found.')
  const order = snap.data()
  if (order.payment?.method !== 'paystack') throw new RuleError('bad_state', 'This order is not paid online.')
  if (['paid', 'mismatch'].includes(order.payment?.status)) return { status: order.payment.status }

  const secret = ctx.secrets?.paystack
  if (!secret) {
    // No secret key on the server yet: staff check the payment in the Paystack dashboard by hand.
    await orderRef.update({ payment: { ...order.payment, status: 'reported', reference }, updatedAt: now })
    return { status: 'reported' }
  }
  let charge
  try {
    const response = await (ctx.fetch || fetch)(PAYSTACK_VERIFY + encodeURIComponent(reference), { headers: { Authorization: `Bearer ${secret}` } })
    charge = (await response.json())?.data
  } catch {
    throw new RuleError('paystack_unreachable', 'We could not reach Paystack to confirm your payment. Your order is saved; we will confirm the payment and call you.')
  }
  if (!charge || charge.status !== 'success') return { status: 'pending' }
  return applyPaystackCharge(ctx, charge, 'verify')
}

// Paystack's webhook. Returns the HTTP status to send back. The signature is an HMAC-SHA512 of the raw body.
export async function handlePaystackWebhook(ctx, { rawBody, signature }) {
  const secret = ctx.secrets?.paystack
  if (!secret || !rawBody || !signature) return 401
  const expected = Buffer.from(createHmac('sha512', secret).update(rawBody).digest('hex'))
  const given = Buffer.from(String(signature))
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 401
  let event
  try { event = JSON.parse(rawBody.toString('utf8')) } catch { return 400 }
  if (event?.event === 'charge.success') await applyPaystackCharge(ctx, event.data, 'webhook')
  return 200
}
