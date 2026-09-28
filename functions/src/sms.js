// Text messages to customers through Arkesel (a Ghana SMS provider). Sending never blocks or undoes a sale or
// an order: a failed text is logged in smsLog and the shop carries on. Nothing is sent unless the owner turns
// SMS on in Settings and the ARKESEL_API_KEY secret is set.
import { logger } from 'firebase-functions'
import { normalizePhone } from './core/sale.js'
import { businessDay } from './core/time.js'

export const DEFAULT_SMS = { enabled: false, senderId: 'SkinMatrix', orderPlaced: true, orderUpdates: true, saleReceipt: false }

const ARKESEL_URL = 'https://sms.arkesel.com/api/v2/sms/send'
const money = (pesewas) => `GHS ${(pesewas / 100).toFixed(2)}`

export function cleanSms(input) {
  const sms = { ...DEFAULT_SMS, ...(input || {}) }
  const senderId = String(sms.senderId ?? '').trim()
  return {
    enabled: sms.enabled === true,
    // Sender IDs are registered with the provider: up to 11 letters or digits.
    senderId: /^[A-Za-z0-9 ]{3,11}$/.test(senderId) ? senderId : DEFAULT_SMS.senderId,
    orderPlaced: sms.orderPlaced !== false,
    orderUpdates: sms.orderUpdates !== false,
    saleReceipt: sms.saleReceipt === true,
  }
}

// The words for each message. Kept short: one SMS is 160 characters.
export function smsText(kind, { ref, total, shopName = 'SkinMatrix', phone = '', number } = {}) {
  const call = phone ? ` Questions? Call ${phone}.` : ''
  switch (kind) {
    case 'order_placed': return `${shopName}: we have your order ${ref} (${money(total)}). We will call you soon to confirm.${call}`
    case 'order_paid': return `${shopName}: payment of ${money(total)} received for order ${ref}. Thank you! We will call you to confirm delivery.`
    case 'order_confirmed': return `${shopName}: your order ${ref} is confirmed and being packed.${call}`
    case 'order_ready': return `${shopName}: your order ${ref} is ready for pickup at our shop.${call}`
    case 'order_out_for_delivery': return `${shopName}: your order ${ref} is on the way to you.${call}`
    case 'order_cancelled': return `${shopName}: your order ${ref} was cancelled. If you paid, your refund is on its way.${call}`
    case 'sale_receipt': return `${shopName}: thank you! Receipt ${number}, total ${money(total)}. Keep this message for returns.`
    default: return ''
  }
}

// ctx: { db, now, secrets: { smsKey }, fetch }. Returns true when the provider accepted the message.
export async function sendSms(ctx, settings, { to, kind, ref, text }) {
  const sms = cleanSms(settings?.sms)
  const key = ctx.secrets?.smsKey
  const phone = normalizePhone(to)
  if (!sms.enabled || !key || !phone || !text) return false
  const log = { at: ctx.now, day: businessDay(ctx.now), kind, ref: ref || null, to: phone, text, ok: false, error: null }
  try {
    const response = await (ctx.fetch || fetch)(ARKESEL_URL, {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: sms.senderId, message: text, recipients: [phone] }),
    })
    const body = await response.json().catch(() => ({}))
    log.ok = response.ok && body?.status === 'success'
    if (!log.ok) log.error = String(body?.message || `HTTP ${response.status}`).slice(0, 200)
  } catch (error) {
    log.error = String(error?.message || error).slice(0, 200)
  }
  if (!log.ok) logger.warn('SMS not sent', { kind, ref, error: log.error })
  await ctx.db.collection('smsLog').add(log).catch(() => {})
  return log.ok
}
