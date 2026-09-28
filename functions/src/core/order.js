import { RuleError } from './rules.js'

// Website orders, shared by the checkout (to show problems as the customer types) and the server (which
// re-checks everything and prices the order from the catalogue). All money is whole pesewas.

export const MAX_QTY = 20
export const MAX_LINES = 30

export function normalizeGhanaPhone(text) {
  let digits = String(text || '').replace(/\D/g, '')
  if (digits.startsWith('233') && digits.length === 12) digits = `0${digits.slice(3)}`
  if (!/^0\d{9}$/.test(digits)) return null
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Returns { field: message } for anything the customer must fix. Messages are shown as written.
export function checkDetails(details, { needEmail = false, delivery = true } = {}) {
  const errors = {}
  const name = String(details?.name || '').trim()
  if (name.length < 2 || name.length > 80) errors.name = 'Enter your full name.'
  if (!normalizeGhanaPhone(details?.phone)) errors.phone = 'Enter a Ghana phone number, like 024 123 4567.'
  const email = String(details?.email || '').trim()
  if (needEmail && !email) errors.email = 'Enter your email. Paystack sends your receipt there.'
  else if (email && (!EMAIL.test(email) || email.length > 120)) errors.email = 'This email does not look right.'
  if (details?.method !== 'pickup' && details?.method !== 'delivery') errors.method = 'Choose delivery or pickup.'
  if (details?.method === 'delivery' && !delivery) errors.method = 'Delivery is not available right now. Choose pickup.'
  if (details?.method === 'delivery' && String(details?.address || '').trim().length < 5) errors.address = 'Enter your address, with a landmark or GPS address.'
  return errors
}

// In stock for the website: the stock system's flag when it has one, otherwise the editor's own switch.
export function inStockOnline(product, availability = {}) {
  return Object.prototype.hasOwnProperty.call(availability, product.id) ? availability[product.id] === true : product.inStock !== false
}

// Server side: prices the customer's cart from the catalogue. Only product ids and quantities come from the browser.
// lines: [{ id, qty }]. Throws a RuleError the customer can read.
export function priceWebOrder({ products, availability, lines, method, deliveryFee }) {
  if (!Array.isArray(lines) || !lines.length) throw new RuleError('empty_cart', 'Your cart is empty.')
  if (lines.length > MAX_LINES) throw new RuleError('cart_too_big', 'Your cart has too many different items. Please split it into two orders.')
  const byId = new Map(products.map((product) => [product.id, product]))
  const merged = new Map()
  for (const line of lines) {
    const qty = line?.qty
    if (!Number.isInteger(qty) || qty < 1) throw new RuleError('bad_quantity', 'Quantities must be whole numbers.')
    const product = byId.get(String(line?.id ?? ''))
    if (!product || product.visible === false) throw new RuleError('unknown_product', 'One of the products in your cart is no longer sold. Remove it and try again.')
    if (!Number.isInteger(product.price) || product.price <= 0) throw new RuleError('no_price', `${product.name} cannot be bought yet. Remove it and try again.`)
    if (!inStockOnline(product, availability)) throw new RuleError('out_of_stock', `Sorry, ${product.name} just went out of stock. Remove it and try again.`)
    merged.set(product.id, Math.min(MAX_QTY, (merged.get(product.id) || 0) + qty))
  }
  const priced = [...merged.entries()].map(([id, qty]) => {
    const product = byId.get(id)
    return { id, name: String(product.name || ''), brand: String(product.brand || ''), size: String(product.size || ''), image: String(product.image || '').slice(0, 1000), price: product.price, qty, lineTotal: product.price * qty }
  })
  const subtotal = priced.reduce((sum, line) => sum + line.lineTotal, 0)
  const fee = method === 'delivery' ? (Number.isInteger(deliveryFee) && deliveryFee >= 0 ? deliveryFee : null) : 0
  return { lines: priced, subtotal, deliveryFee: fee, total: subtotal + (fee || 0) }
}

// Paystack references are "<order ref>-<attempt>", so a customer can retry a failed payment on the same order.
export const ORDER_REF = /^SM-[A-Z2-9]{6}$/
export function orderRefFromReference(reference) {
  const match = /^(SM-[A-Z2-9]{6})(-[A-Z0-9]{1,12})?$/.exec(String(reference ?? ''))
  return match ? match[1] : null
}
