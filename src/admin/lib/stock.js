import { businessDayKey, DAY } from './time.js'

// Stock is held in BATCHES: { id, variantId, branchId, lot, expiresOn ('YYYY-MM-DD' or null), quantity, receivedAt }.
// A branch sells a variant only if it is LISTED there (state.listings[variantId][branchId]); an unlisted branch has no
// stock of it and never borrows another branch's. Expired units stay in their batch (they are physically on the
// shelf) but are never sellable: they must be written off.

export const EXPIRY_SOON_DAYS = 90
export const EXPIRY_URGENT_DAYS = 30

export function isListed(state, variantId, branchId) {
  return Boolean(state.listings?.[variantId]?.[branchId])
}

// 'none' (does not expire) | 'expired' | 'urgent' (≤30 days) | 'soon' (≤90 days) | 'ok'
export function expiryStatus(expiresOn, now) {
  if (!expiresOn) return 'none'
  const today = businessDayKey(now)
  if (expiresOn < today) return 'expired'
  const days = daysUntil(expiresOn, now)
  if (days <= EXPIRY_URGENT_DAYS) return 'urgent'
  if (days <= EXPIRY_SOON_DAYS) return 'soon'
  return 'ok'
}

export function daysUntil(expiresOn, now) {
  return Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${businessDayKey(now)}T00:00:00Z`)) / DAY)
}

const byExpiry = (a, b) => (a.expiresOn || '9999-12-31').localeCompare(b.expiresOn || '9999-12-31') || a.receivedAt - b.receivedAt

// Batches with units at a branch, soonest expiry first (non-expiring last).
export function batchesAt(state, variantId, branchId) {
  return state.batches.filter((batch) => batch.variantId === variantId && batch.branchId === branchId && batch.quantity > 0).sort(byExpiry)
}

// Sellable units (listed, not expired). null when the branch does not carry the variant.
export function onHand(state, variantId, branchId, now) {
  if (!isListed(state, variantId, branchId)) return null
  return batchesAt(state, variantId, branchId)
    .filter((batch) => expiryStatus(batch.expiresOn, now) !== 'expired')
    .reduce((total, batch) => total + batch.quantity, 0)
}

export function expiredUnits(state, variantId, branchId, now) {
  return batchesAt(state, variantId, branchId)
    .filter((batch) => expiryStatus(batch.expiresOn, now) === 'expired')
    .reduce((total, batch) => total + batch.quantity, 0)
}

// The soonest expiry among sellable batches, or null.
export function nextExpiry(state, variantId, branchId, now) {
  const batch = batchesAt(state, variantId, branchId).find((candidate) => expiryStatus(candidate.expiresOn, now) !== 'expired')
  return batch?.expiresOn || null
}

// First-expiry-first-out: which batches a sale of `quantity` units takes from. null if not enough sellable stock.
export function allocateFefo(batches, quantity, now) {
  const allocations = []
  let remaining = quantity
  for (const batch of [...batches].sort(byExpiry)) {
    if (remaining === 0) break
    if (batch.quantity <= 0 || expiryStatus(batch.expiresOn, now) === 'expired') continue
    const take = Math.min(batch.quantity, remaining)
    allocations.push({ batchId: batch.id, quantity: take })
    remaining -= take
  }
  return remaining === 0 ? allocations : null
}

export function stockStatus(quantity, reorderPoint) {
  if (quantity === null) return 'unlisted'
  if (quantity <= 0) return 'out'
  if (quantity <= reorderPoint) return 'low'
  return 'ok'
}

// Units currently held by open mobile-money reservations (already off the shelf).
export function heldUnits(holds, variantId, branchId) {
  return holds
    .filter((hold) => hold.status === 'reserved' && hold.branchId === branchId)
    .flatMap((hold) => hold.items)
    .filter((item) => item.variantId === variantId)
    .reduce((total, item) => total + item.quantity, 0)
}

// Old and new order lines -> [{ variantId, delta }] for every variant whose quantity changed.
// delta > 0 needs that many more units taken from stock; delta < 0 returns that many.
export function stockDeltas(oldItems, newItems) {
  const quantities = new Map()
  for (const item of oldItems) quantities.set(item.variantId, (quantities.get(item.variantId) || 0) - item.quantity)
  for (const item of newItems) quantities.set(item.variantId, (quantities.get(item.variantId) || 0) + item.quantity)
  return [...quantities.entries()]
    .filter(([, delta]) => delta !== 0)
    .map(([variantId, delta]) => ({ variantId, delta }))
}

// Units and selling-price worth per branch, for the given branches. Expired stock is reported separately
// because it cannot be sold. Worth uses the selling price: cost prices are not recorded.
export function stockValue(state, branchIds, now) {
  const price = new Map(state.catalog.flatMap((product) => product.variants.map((variant) => [variant.id, variant.price])))
  const byBranch = Object.fromEntries(branchIds.map((id) => [id, { units: 0, worth: 0, soonUnits: 0, soonWorth: 0, expiredUnits: 0, expiredWorth: 0 }]))
  for (const batch of state.batches) {
    const bucket = byBranch[batch.branchId]
    if (!bucket || batch.quantity <= 0 || !isListed(state, batch.variantId, batch.branchId)) continue
    const worth = batch.quantity * (price.get(batch.variantId) || 0)
    const status = expiryStatus(batch.expiresOn, now)
    if (status === 'expired') { bucket.expiredUnits += batch.quantity; bucket.expiredWorth += worth; continue }
    bucket.units += batch.quantity
    bucket.worth += worth
    if (status === 'soon' || status === 'urgent') { bucket.soonUnits += batch.quantity; bucket.soonWorth += worth }
  }
  const total = Object.values(byBranch).reduce((sum, bucket) => {
    for (const key of Object.keys(sum)) sum[key] += bucket[key]
    return sum
  }, { units: 0, worth: 0, soonUnits: 0, soonWorth: 0, expiredUnits: 0, expiredWorth: 0 })
  return { byBranch, total }
}
