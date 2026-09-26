import { sumPesewas } from '../lib/money.js'

export class OpsError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OpsError'
    this.code = code
  }
}

export const SYSTEM_ACTOR = Object.freeze({ id: 'system', name: 'Payment service', role: 'system' })

export function actorRef(staff) {
  return { id: staff.id, name: staff.name, role: staff.role }
}

export function variantIndex(catalog) {
  const index = new Map()
  for (const product of catalog) {
    for (const variant of product.variants) index.set(variant.id, { product, variant })
  }
  return index
}

// Turns [{ variantId, quantity }] into an immutable snapshot of what was ordered, priced from the catalog.
// Browser-supplied prices are never accepted: only the variant id and quantity cross the boundary.
export function priceLines(catalog, lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw new OpsError('empty_cart', 'The cart is empty.')
  const index = variantIndex(catalog)
  const merged = new Map()
  for (const line of lines) {
    const quantity = line?.quantity
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new OpsError('bad_quantity', 'Quantities must be whole numbers between 1 and 99.')
    }
    if (!index.has(line.variantId)) throw new OpsError('unknown_product', 'A product in the cart is no longer in the catalog.')
    if (index.get(line.variantId).product.active === false) throw new OpsError('inactive_product', `${index.get(line.variantId).product.name} has been archived and can no longer be sold.`)
    merged.set(line.variantId, (merged.get(line.variantId) || 0) + quantity)
  }
  const items = [...merged.entries()].map(([variantId, quantity]) => {
    const { product, variant } = index.get(variantId)
    return {
      productId: product.id,
      variantId,
      name: product.name,
      variantName: variant.name,
      sku: variant.sku,
      unitPrice: variant.price,
      quantity,
      lineTotal: variant.price * quantity,
    }
  })
  return { items, subtotal: sumPesewas(items, (item) => item.lineTotal) }
}

export function cleanCustomer(customer) {
  const name = String(customer?.name || '').trim().slice(0, 80)
  const phone = String(customer?.phone || '').replace(/[^\d+]/g, '').slice(0, 16)
  const email = String(customer?.email || '').trim().slice(0, 120)
  return name || phone || email ? { name, phone, email } : null
}

export function historyEntry({ at, from, to, by, reason = '' }) {
  return Object.freeze({ at, from, to, by, reason })
}
