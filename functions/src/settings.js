// Shop settings the owner controls from the admin: taxes on receipts and text messages to customers.
// Stored in settings/shop. Every active staff member can read it (receipts need it); only the owner changes it.
import { cleanTax, DEFAULT_TAX } from './core/tax.js'
import { businessDay } from './core/time.js'
import { actorRef, requireStaff } from './shared.js'
import { cleanSms } from './sms.js'

export function withDefaults(data) {
  return { tax: { ...DEFAULT_TAX, ...(data?.tax || {}) }, sms: cleanSms(data?.sms) }
}

// Reads settings inside a transaction (tx) or directly (db only).
export async function readSettings(db, tx = null) {
  const ref = db.doc('settings/shop')
  const snap = tx ? await tx.get(ref) : await ref.get()
  return withDefaults(snap.data())
}

export async function saveShopSettings({ db, uid, now }, data) {
  const owner = await requireStaff(db, uid, 'settings')
  const settings = { tax: cleanTax(data?.tax), sms: cleanSms(data?.sms), updatedAt: now, updatedBy: uid }
  await db.doc('settings/shop').set(settings)
  const parts = [settings.tax.registered ? 'VAT on receipts' : 'no VAT on receipts', settings.sms.enabled ? 'SMS on' : 'SMS off']
  await db.collection('audit').add({ at: now, day: businessDay(now), type: 'settings', actor: actorRef(owner), ref: 'shop', summary: `Saved shop settings: ${parts.join(', ')}`, detail: '' })
  return withDefaults(settings)
}
