// MoMo prompts at the till ("request to pay"). The cashier types the customer's number; Paystack sends a prompt to
// that phone; the customer approves with their MoMo PIN; the sale then completes by itself.
//
//   startMomoPrompt   prices the sale on the server, checks stock and any discount approval, saves
//                     momoCharges/{reference} and asks Paystack to charge the phone.
//   checkMomoPrompt   the till asks every few seconds; the server asks Paystack and, once paid, saves the sale.
//   submitMomoOtp     some networks send the customer a code instead of a prompt; the cashier types it in.
//   cancelMomoPrompt  the cashier gives up (the customer pays another way).
//   applyMomoCharge   Paystack says a charge succeeded (from checkMomoPrompt or the webhook): save the sale once.
//
// The amount always comes from the catalogue, never from the till. One sale (requestId) can only be paid once:
// a second successful charge for the same sale, or one approved after the cashier cancelled, is recorded for a
// manager to refund in Paystack. momoCharges has no client access (see firestore.rules: no rule = no access).
import { randomBytes } from 'node:crypto'
import { checkMomoTarget, maskMomoNumber, PAYSTACK_PROVIDER, PROMPT_STATUS } from './core/momo.js'
import { DISCOUNT_LIMIT, RuleError } from './core/rules.js'
import { applyDiscount, discountNeedsApproval, priceCart } from './core/sale.js'
import { businessDay } from './core/time.js'
import { completeSale } from './handlers.js'
import { approvalCheck, checkRequestId, readBatches, readCatalog, requireStaff, takeFromBatches, verifyApproval } from './shared.js'

// PAYSTACK_TEST_BASE points at a pretend Paystack, and only works inside the local emulator.
const PAYSTACK = (process.env.FUNCTIONS_EMULATOR === 'true' && process.env.PAYSTACK_TEST_BASE) || 'https://api.paystack.co'
// Paystack needs an email on every charge. Till customers have none, so the shop's own address is used.
const TILL_EMAIL = 'pos@skinmatrixgh.com'
const OPEN = ['sending', 'waiting', 'otp']
const FINAL = ['paid', 'paid_not_sold', 'mismatch', 'duplicate', 'paid_after_cancel']
const ABANDONED_AFTER = 60000 // Paystack may call a charge "abandoned" early; only believe it after a minute.

const newReference = () => `POS-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`
const money = (pesewas) => `${(pesewas / 100).toFixed(2)} GHS`

async function paystack(ctx, method, path, body) {
  const response = await (ctx.fetch || fetch)(PAYSTACK + path, {
    method,
    headers: { Authorization: `Bearer ${ctx.secrets.paystack}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await response.json() } catch { /* not JSON: treated as a failure below */ }
  return { ok: response.ok && json?.status === true, message: String(json?.message || ''), data: json?.data || null }
}

function requireKey(ctx) {
  if (!ctx.secrets?.paystack) throw new RuleError('prompt_off', 'MoMo prompts are not switched on yet (the Paystack key is not set). Use “Customer sends to shop number” instead.')
}

// What the till sees. Never includes the full phone number.
async function view(db, reference, charge) {
  const result = { reference, status: charge.status, message: charge.message || PROMPT_STATUS[charge.status] || '', phone: maskMomoNumber(charge.phone), network: charge.network, amount: charge.amount, startedAt: charge.createdAt }
  if (charge.saleId) {
    const sale = await db.doc(`sales/${charge.saleId}`).get()
    if (sale.exists) result.sale = sale.data()
  }
  return result
}

async function note(db, now, charge, summary, detail = '') {
  await db.collection('audit').add({ at: now, day: businessDay(now), type: 'momo_prompt', actor: charge.cashier, ref: charge.reference, summary, detail })
}

async function loadOwn(ctx, data, action = 'sell') {
  const staff = await requireStaff(ctx.db, ctx.uid, action)
  const reference = String(data?.reference ?? '')
  if (!/^POS-[A-Z0-9-]{6,40}$/.test(reference)) throw new RuleError('not_found', 'Payment not found.')
  const ref = ctx.db.doc(`momoCharges/${reference}`)
  const snap = await ref.get()
  if (!snap.exists) throw new RuleError('not_found', 'Payment not found.')
  const charge = snap.data()
  if (charge.cashier.uid !== staff.uid && !['manager', 'owner'].includes(staff.role)) throw new RuleError('forbidden', 'This payment belongs to another till.')
  return { staff, ref, charge, reference }
}

// Reads Paystack's answer to a charge or OTP and stores what it means.
async function record(ctx, reference, answer) {
  const { db, now } = ctx
  const ref = db.doc(`momoCharges/${reference}`)
  const data = answer.data || {}
  if (data.status === 'success') return applyMomoCharge(ctx, { ...data, reference }, 'till')
  let status
  let message
  if (!answer.ok || ['failed', 'reversed'].includes(data.status)) {
    status = 'failed'
    message = data.gateway_response || data.message || answer.message || PROMPT_STATUS.failed
  } else if (data.status === 'send_otp') {
    status = 'otp'
    message = data.display_text || PROMPT_STATUS.otp
  } else {
    status = 'waiting'
    message = data.display_text || PROMPT_STATUS.waiting
  }
  await ref.update({ status, message: String(message).slice(0, 300), updatedAt: now })
  return view(db, reference, (await ref.get()).data())
}

// Tells the till whether prompts can be used (the key is set). Never returns the key.
export async function momoPromptReady(ctx) {
  await requireStaff(ctx.db, ctx.uid, 'sell')
  const key = ctx.secrets?.paystack || ''
  return { ready: Boolean(key), testMode: key.startsWith('sk_test_') }
}

// data: { requestId, lines, discount, customer, approval, phone, network }
export async function startMomoPrompt(ctx, data) {
  const { db, uid, now } = ctx
  const staff = await requireStaff(db, uid, 'sell')
  requireKey(ctx)
  const requestId = checkRequestId(data?.requestId)
  const target = checkMomoTarget(data?.phone, data?.network)

  // The amount, from the catalogue. A discount above the cashier's limit needs a manager's PIN now, not later.
  const catalog = (await db.doc('site/catalog').get()).data()?.products || []
  const { items, subtotal } = priceCart(catalog, data?.lines)
  const discount = applyDiscount(subtotal, data?.discount)
  const amount = subtotal - (discount?.amount || 0)
  if (amount < 100) throw new RuleError('too_small', 'A MoMo prompt needs at least GHS 1.00.')
  const check = (person) => (discountNeedsApproval(person.role, subtotal, discount?.amount || 0) ? `Discounts over ${DISCOUNT_LIMIT[person.role]}% need approval.` : '')
  const approver = check(staff) ? await verifyApproval(db, data?.approval, staff, check, now) : null
  approvalCheck(staff, approver, check)

  const reference = newReference()
  await db.runTransaction(async (tx) => {
    const done = await tx.get(db.doc(`requests/${uid}_${requestId}`))
    if (done.exists) throw new RuleError('already_saved', 'This sale is already saved. Start a new sale.')
    const products = await readCatalog(tx, db)
    const batches = await readBatches(tx, db, items.map((item) => item.productId))
    takeFromBatches(batches, items, now, products) // throws if something ran out: never charge for what we cannot sell
    const earlier = await tx.get(db.collection('momoCharges').where('requestId', '==', requestId))
    for (const doc of earlier.docs) if (OPEN.includes(doc.data().status) && doc.data().cashier.uid === uid) tx.update(doc.ref, { status: 'replaced', updatedAt: now })
    tx.set(db.doc(`momoCharges/${reference}`), {
      reference, requestId, status: 'sending', message: '', amount, currency: 'GHS',
      phone: target.phone, network: target.network,
      cashier: { uid: staff.uid, name: staff.name, role: staff.role },
      approver: approver ? { uid: approver.uid, name: approver.name, role: approver.role } : null,
      sale: {
        requestId,
        lines: (data.lines || []).map((line) => ({ productId: String(line.productId), quantity: Number(line.quantity) })),
        discount: data.discount || null,
        customer: data.customer || null,
      },
      saleId: null, createdAt: now, updatedAt: now,
    })
  })

  let answer
  try {
    answer = await paystack(ctx, 'POST', '/charge', {
      email: TILL_EMAIL, amount, currency: 'GHS', reference,
      mobile_money: { phone: target.phone, provider: PAYSTACK_PROVIDER[target.network] },
      metadata: { source: 'till', requestId, cashier: staff.name },
    })
  } catch {
    await db.doc(`momoCharges/${reference}`).update({ status: 'failed', message: 'Could not reach Paystack.', updatedAt: now })
    throw new RuleError('paystack_unreachable', 'Could not reach Paystack. Check the internet and try again, or take another payment.')
  }
  return record(ctx, reference, answer)
}

// data: { reference }
export async function checkMomoPrompt(ctx, data) {
  const { db, now } = ctx
  const { ref, charge, reference } = await loadOwn(ctx, data)
  if (!OPEN.includes(charge.status) || !ctx.secrets?.paystack) return view(db, reference, charge)
  let answer
  try {
    answer = await paystack(ctx, 'GET', `/transaction/verify/${encodeURIComponent(reference)}`)
  } catch {
    return view(db, reference, charge) // no answer yet: the till asks again in a few seconds
  }
  const status = answer.data?.status
  if (status === 'success') return applyMomoCharge(ctx, { ...answer.data, reference }, 'till')
  if (['failed', 'reversed'].includes(status) || (status === 'abandoned' && now - charge.createdAt > ABANDONED_AFTER)) {
    await ref.update({ status: 'failed', message: String(answer.data?.gateway_response || PROMPT_STATUS.failed).slice(0, 300), updatedAt: now })
    return view(db, reference, (await ref.get()).data())
  }
  return view(db, reference, charge)
}

// data: { reference, otp }
export async function submitMomoOtp(ctx, data) {
  const { db, now } = ctx
  requireKey(ctx)
  const { charge, reference } = await loadOwn(ctx, data)
  if (charge.status !== 'otp') return view(db, reference, charge)
  const otp = String(data?.otp ?? '').replace(/\s/g, '')
  if (!/^[A-Za-z0-9]{3,12}$/.test(otp)) throw new RuleError('bad_otp', 'Type the code the customer received.')
  let answer
  try {
    answer = await paystack(ctx, 'POST', '/charge/submit_otp', { otp, reference })
  } catch {
    throw new RuleError('paystack_unreachable', 'Could not reach Paystack. Try again.')
  }
  await db.doc(`momoCharges/${reference}`).update({ updatedAt: now })
  return record(ctx, reference, answer)
}

// data: { reference }
export async function cancelMomoPrompt(ctx, data) {
  const { db, now } = ctx
  const { ref, charge, reference } = await loadOwn(ctx, data)
  if (!OPEN.includes(charge.status)) return view(db, reference, charge)
  await ref.update({ status: 'cancelled', message: PROMPT_STATUS.cancelled, updatedAt: now })
  return view(db, reference, { ...charge, status: 'cancelled', message: PROMPT_STATUS.cancelled })
}

// Paystack says this charge succeeded. Saves the sale exactly once. source: 'till' | 'webhook'.
export async function applyMomoCharge(ctx, paid, source) {
  const { db, now } = ctx
  const reference = String(paid?.reference ?? '')
  const ref = db.doc(`momoCharges/${reference}`)
  const snap = await ref.get()
  if (!snap.exists) return { status: 'ignored' }
  const charge = snap.data()
  if (FINAL.includes(charge.status)) return view(db, reference, charge)
  if (paid.status !== 'success') return view(db, reference, charge)

  const set = async (patch, summary, detail) => {
    await ref.update({ ...patch, paidAt: now, verifiedBy: source, updatedAt: now })
    if (summary) await note(db, now, charge, summary, detail)
    return view(db, reference, { ...charge, ...patch })
  }
  if (paid.currency !== 'GHS' || paid.amount !== charge.amount) {
    return set({ status: 'mismatch', message: PROMPT_STATUS.mismatch }, `MoMo prompt ${reference}: amount does not match`, `Paystack: ${Number.isInteger(paid.amount) ? money(paid.amount) : '?'} ${paid.currency || ''}; sale: ${money(charge.amount)}. Check it in Paystack.`)
  }
  if (charge.status === 'cancelled') {
    return set({ status: 'paid_after_cancel', message: 'The customer approved after the payment was cancelled. A manager must refund it in Paystack.' },
      `MoMo prompt ${reference}: paid after it was cancelled`, `${money(charge.amount)} from ${maskMomoNumber(charge.phone)}. No sale was saved for it: refund it in Paystack unless the customer paid nothing else.`)
  }
  try {
    const { sale } = await completeSale({ ...ctx, uid: charge.cashier.uid }, charge.sale, {
      prompt: { reference, network: charge.network, phone: charge.phone, amount: charge.amount },
      approver: charge.approver,
    })
    if (sale.payment?.reference !== reference) {
      return set({ status: 'duplicate', saleId: sale.id, message: `This sale was already paid (sale ${sale.number}). A manager must refund this second payment in Paystack.` },
        `MoMo prompt ${reference}: second payment for sale ${sale.number}`, `${money(charge.amount)} from ${maskMomoNumber(charge.phone)}. Refund it in Paystack.`)
    }
    return set({ status: 'paid', saleId: sale.id, message: PROMPT_STATUS.paid })
  } catch (error) {
    return set({ status: 'paid_not_sold', message: `Paid, but the sale could not be saved: ${error.message} A manager must refund the customer in Paystack.` },
      `MoMo prompt ${reference}: paid but the sale was not saved`, `${money(charge.amount)} from ${maskMomoNumber(charge.phone)}. ${error.message}`)
  }
}
