// Text messages to customers through mNotify (a Ghana SMS provider, BMS API v2 "quick SMS"). Sending never
// blocks or undoes a sale or an order: a failed text is logged in smsLog and the shop carries on. Nothing is
// sent unless the owner turns SMS on in Settings and the MNOTIFY_API_KEY secret is set.
import { logger } from 'firebase-functions'
import { displayPhone, normalizePhone } from './core/sale.js'
import { sellableFromSummary } from './core/stock.js'
import { businessDay } from './core/time.js'

export const DEFAULT_SMS = { enabled: false, senderId: 'SkinMatrix', orderPlaced: true, orderUpdates: true, saleReceipt: false, daySummary: false, ownerPhone: '' }

const MNOTIFY_URL = 'https://api.mnotify.com/api/sms/quick'
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
    // The day's takings texted to the owner when the day is closed (Reports → Close the day).
    daySummary: sms.daySummary === true,
    ownerPhone: normalizePhone(sms.ownerPhone) ? displayPhone(normalizePhone(sms.ownerPhone)) : '',
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
  const local = `0${phone.slice(3)}` // mNotify takes Ghana numbers as 0XXXXXXXXX
  const log = { at: ctx.now, day: businessDay(ctx.now), kind, ref: ref || null, to: phone, text, ok: false, error: null }
  try {
    const response = await (ctx.fetch || fetch)(`${MNOTIFY_URL}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ recipient: [local], sender: sms.senderId, message: text, is_schedule: false, schedule_date: '' }),
    })
    const body = await response.json().catch(() => ({}))
    log.ok = response.ok && (body?.status === 'success' || String(body?.code) === '2000')
    if (!log.ok) log.error = String(body?.message || `HTTP ${response.status}`).slice(0, 200)
  } catch (error) {
    log.error = String(error?.message || error).slice(0, 200)
  }
  if (!log.ok) logger.warn('SMS not sent', { kind, ref, error: log.error })
  await ctx.db.collection('smsLog').add(log).catch(() => {})
  return log.ok
}

// The owner's end-of-day text: takings by payment method, refunds, cancels and what is running low.
// report: the Z report (core/zreport.js). low: [{ name, units }]. Kept to about two SMS.
export function daySummaryText({ shopName = 'SkinMatrix', report, low = [] }) {
  const short = (pesewas) => `${(pesewas / 100).toFixed(2)}`
  const methods = Object.entries(report.byMethod || {}).filter(([, value]) => value).map(([method, value]) => `${{ cash: 'Cash', momo: 'MoMo', card: 'Card' }[method] || method} ${short(value)}`)
  const lines = [
    `${shopName} ${report.day} closed (${report.number}).`,
    `Takings GHS ${short(report.net)} from ${report.count} sale${report.count === 1 ? '' : 's'}.`,
    methods.length ? `${methods.join(', ')}.` : '',
    report.refunds ? `Refunds ${short(report.refunds)}.` : '',
    report.voidedCount ? `Cancelled ${report.voidedCount}.` : '',
    report.drawers?.some((drawer) => drawer.status === 'closed' && drawer.difference) ? `Drawer ${report.drawers.filter((drawer) => drawer.status === 'closed' && drawer.difference).map((drawer) => `${drawer.cashier} ${drawer.difference > 0 ? '+' : ''}${short(drawer.difference)}`).join(', ')}.` : '',
    low.length ? `Low: ${low.slice(0, 4).map((item) => `${item.name} (${item.units})`).join(', ')}${low.length > 4 ? ` +${low.length - 4} more` : ''}.` : '',
  ]
  return lines.filter(Boolean).join(' ')
}

// Products at or below their warning level, lowest first. db: Firestore. now: ms.
export async function lowStock(db, now) {
  const [catalog, ops, stock] = await Promise.all([db.doc('site/catalog').get(), db.collection('catalogOps').get(), db.collection('stock').get()])
  const warnAt = new Map(ops.docs.map((doc) => [doc.id, doc.data().reorderPoint ?? 3]))
  const units = new Map(stock.docs.map((doc) => [doc.id, sellableFromSummary(doc.data(), now)]))
  return (catalog.data()?.products || [])
    .filter((product) => product.price > 0)
    .map((product) => ({ name: product.name, units: units.get(product.id) || 0, warnAt: warnAt.get(product.id) ?? 3 }))
    .filter((item) => item.units <= item.warnAt)
    .sort((a, b) => a.units - b.units)
}
