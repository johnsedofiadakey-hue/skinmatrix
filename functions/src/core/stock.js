import { RuleError } from './rules.js'
import { businessDay, daysBetween, isDate } from './time.js'

// Stock is held in batches: { id, productId, lot, expiresOn ('YYYY-MM-DD' or null), quantity, unitCost }.
// Expired units stay on the shelf until written off, but can never be sold.

export const EXPIRY_SOON_DAYS = 90
export const EXPIRY_URGENT_DAYS = 30

// 'none' | 'expired' | 'urgent' (≤30 days) | 'soon' (≤90 days) | 'ok'
export function expiryStatus(expiresOn, now) {
  if (!expiresOn) return 'none'
  const days = daysBetween(businessDay(now), expiresOn)
  if (days < 0) return 'expired'
  if (days <= EXPIRY_URGENT_DAYS) return 'urgent'
  if (days <= EXPIRY_SOON_DAYS) return 'soon'
  return 'ok'
}

const byExpiry = (a, b) => (a.expiresOn || '9999-12-31').localeCompare(b.expiresOn || '9999-12-31') || (a.receivedAt ?? 0) - (b.receivedAt ?? 0)

export const sellable = (batch, now) => batch.quantity > 0 && expiryStatus(batch.expiresOn, now) !== 'expired'

// Soonest expiry first. Returns [{ batchId, quantity }] or null when there is not enough sellable stock.
export function allocateFefo(batches, quantity, now) {
  const allocations = []
  let remaining = quantity
  for (const batch of [...batches].sort(byExpiry)) {
    if (remaining === 0) break
    if (!sellable(batch, now)) continue
    const take = Math.min(batch.quantity, remaining)
    allocations.push({ batchId: batch.id, quantity: take })
    remaining -= take
  }
  return remaining === 0 ? allocations : null
}

// The summary everyone may read (stock/{productId}); unit costs are left out on purpose.
export function summarize(batches, now) {
  const live = batches.filter((batch) => batch.quantity > 0).sort(byExpiry)
  const onHand = live.filter((batch) => sellable(batch, now)).reduce((sum, batch) => sum + batch.quantity, 0)
  const expired = live.filter((batch) => !sellable(batch, now)).reduce((sum, batch) => sum + batch.quantity, 0)
  return {
    onHand,
    expired,
    nextExpiry: live.find((batch) => sellable(batch, now))?.expiresOn || null,
    batches: live.map((batch) => ({ id: batch.id, lot: batch.lot, expiresOn: batch.expiresOn || null, quantity: batch.quantity })),
  }
}

// Sellable units right now from a stored summary (expiry moves on even when nothing is written).
export function sellableFromSummary(summary, now) {
  return (summary?.batches || []).filter((batch) => sellable(batch, now)).reduce((sum, batch) => sum + batch.quantity, 0)
}

export function stockLevel(units, reorderPoint = 3) {
  if (units <= 0) return 'out'
  if (units <= reorderPoint) return 'low'
  return 'ok'
}

export function checkLot(lot) {
  const text = String(lot ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9./-]{1,24}$/.test(text)) throw new RuleError('bad_lot', 'Type the batch (lot) number printed on the box. Use "NONE" if there is no batch number.')
  return text
}

export function checkExpiry(expiresOn, { required, now }) {
  if (!expiresOn) {
    if (required) throw new RuleError('expiry_required', 'Type the expiry date printed on the box.')
    return null
  }
  if (!isDate(expiresOn)) throw new RuleError('bad_expiry', 'The expiry date is not a real date.')
  if (expiryStatus(expiresOn, now) === 'expired') throw new RuleError('already_expired', 'This stock has already expired. Do not accept it.')
  return expiresOn
}
