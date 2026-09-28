import { DISCOUNT_LIMIT, MOMO_NETWORKS, RuleError } from './rules.js'

// All money is whole pesewas (GHS 1 = 100 pesewas).

// Prices a cart from the website catalogue. Only product ids and quantities come from the device.
export function priceCart(products, lines) {
  if (!Array.isArray(lines) || !lines.length) throw new RuleError('empty_cart', 'The cart is empty.')
  if (lines.length > 40) throw new RuleError('cart_too_big', 'Split this into two sales.')
  const byId = new Map(products.map((product) => [product.id, product]))
  const merged = new Map()
  for (const line of lines) {
    const quantity = line?.quantity
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new RuleError('bad_quantity', 'Quantities must be whole numbers from 1 to 999.')
    const product = byId.get(line.productId)
    if (!product) throw new RuleError('unknown_product', 'One of the products is no longer in the catalogue. Remove it and scan again.')
    if (!Number.isInteger(product.price) || product.price <= 0) throw new RuleError('no_price', `${product.name} has no price yet. The owner can set it in Website → Products.`)
    merged.set(product.id, (merged.get(product.id) || 0) + quantity)
  }
  const items = [...merged.entries()].map(([productId, quantity]) => {
    const product = byId.get(productId)
    return { productId, name: product.name, brand: product.brand || '', size: product.size || '', unitPrice: product.price, quantity, lineTotal: product.price * quantity }
  })
  return { items, subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0) }
}

// discount: { type: 'percent', value: 1–100 } | { type: 'amount', value: pesewas }, with a reason.
export function applyDiscount(subtotal, discount) {
  if (!discount) return null
  let amount = null
  if (discount.type === 'percent' && Number.isInteger(discount.value) && discount.value >= 1 && discount.value <= 100) amount = Math.round((subtotal * discount.value) / 100)
  if (discount.type === 'amount' && Number.isSafeInteger(discount.value) && discount.value >= 1 && discount.value <= subtotal) amount = discount.value
  if (!amount) throw new RuleError('bad_discount', 'The discount must be more than zero and not more than the total.')
  const reason = String(discount.reason ?? '').trim()
  if (reason.length < 3) throw new RuleError('reason_required', 'Write why you are giving the discount.')
  return { type: discount.type, value: discount.value, amount, reason: reason.slice(0, 120) }
}

// Discount as a percentage of the cart, rounded up, so 10.01% counts as over a 10% limit.
export const discountPercent = (subtotal, amount) => (subtotal ? Math.ceil((amount * 10000) / subtotal) / 100 : 0)

export const discountNeedsApproval = (role, subtotal, amount) => amount > 0 && discountPercent(subtotal, amount) > (DISCOUNT_LIMIT[role] ?? 0)

// payment: { method: 'cash', received } | { method: 'momo', received, reference, network } | { method: 'card', received, reference }
export function checkPayment(payment, total) {
  const method = payment?.method
  const received = payment?.received
  if (!['cash', 'momo', 'card'].includes(method)) throw new RuleError('bad_payment', 'Choose how the customer paid.')
  if (!Number.isSafeInteger(received) || received < total) throw new RuleError('short_payment', 'The amount received is less than the total.')
  if (method === 'card' && received !== total) throw new RuleError('bad_payment', 'A card payment must be the exact total.')
  const result = { method, received, change: received - total, reference: null, network: null }
  if (method === 'momo') {
    const reference = String(payment.reference ?? '').trim().toUpperCase()
    if (!/^[A-Z0-9.-]{6,30}$/.test(reference)) throw new RuleError('bad_reference', 'Type the MoMo transaction ID from the payment message (at least 6 characters).')
    if (!MOMO_NETWORKS.includes(payment.network)) throw new RuleError('bad_network', 'Choose the MoMo network.')
    result.reference = reference
    result.network = payment.network
  }
  if (method === 'card') {
    const reference = String(payment.reference ?? '').trim().toUpperCase()
    if (reference && !/^[A-Z0-9.-]{3,30}$/.test(reference)) throw new RuleError('bad_reference', 'The card slip number looks wrong.')
    result.reference = reference || null
  }
  return result
}

export const returnedQuantity = (sale, productId) => (sale.returns || [])
  .flatMap((entry) => entry.lines).filter((line) => line.productId === productId).reduce((sum, line) => sum + line.quantity, 0)

// What returning `quantity` of a line is worth: the customer's share after the sale's discount.
export function returnValue(sale, productId, quantity) {
  const item = sale.items.find((line) => line.productId === productId)
  if (!item || !quantity) return 0
  return Math.round((item.unitPrice * quantity * sale.total) / sale.subtotal)
}

export const refundedAmount = (sale) => (sale.returns || []).reduce((sum, entry) => sum + entry.amount, 0)

export function normalizePhone(raw) {
  const first = String(raw ?? '').split(/[/,;]| or /i)[0]
  let digits = first.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 10 && digits.startsWith('0')) digits = `233${digits.slice(1)}`
  if (digits.length === 9) digits = `233${digits}`
  return /^233\d{9}$/.test(digits) ? digits : null
}

export const displayPhone = (key) => (key ? `0${key.slice(3, 5)} ${key.slice(5, 8)} ${key.slice(8)}` : '')

export function cleanCustomer(customer) {
  const name = String(customer?.name ?? '').trim().slice(0, 80)
  const key = customer?.phone ? normalizePhone(customer.phone) : null
  if (customer?.phone && !key) throw new RuleError('bad_phone', 'The customer phone number should have 10 digits, like 024 123 4567.')
  return name || key ? { name, phone: key ? displayPhone(key) : '' } : null
}

// EAN-13 / UPC-A check digit; other codes (Code 128 etc.) just need to be sensible.
export function isValidBarcode(code) {
  const text = String(code ?? '')
  if (/^\d{13}$/.test(text) || /^\d{12}$/.test(text) || /^\d{8}$/.test(text)) {
    const digits = [...text].map(Number)
    const check = digits.pop()
    const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0)
    return (10 - (sum % 10)) % 10 === check
  }
  return /^[A-Za-z0-9-]{4,32}$/.test(text)
}

// A sale made while the till had no internet, sent when it is back. offline: { at, shiftId, clientTotal }.
// `at` is when the sale was really made; it must be within the last 7 days.
export const OFFLINE_MAX_AGE = 7 * 24 * 60 * 60 * 1000
export function checkOffline(offline, now) {
  if (!offline) return null
  const at = offline.at
  if (!Number.isSafeInteger(at) || at < now - OFFLINE_MAX_AGE || at > now + 5 * 60 * 1000) throw new RuleError('offline_too_old', 'This offline sale is more than 7 days old or has a wrong time. A manager must record it by hand.')
  if (!Number.isSafeInteger(offline.clientTotal) || offline.clientTotal <= 0) throw new RuleError('bad_offline', 'This offline sale has no total. A manager must record it by hand.')
  const shiftId = offline.shiftId ? String(offline.shiftId) : null
  if (shiftId && !/^[A-Za-z0-9]{10,40}$/.test(shiftId)) throw new RuleError('bad_offline', 'This offline sale is damaged. A manager must record it by hand.')
  return { at, shiftId, clientTotal: offline.clientTotal }
}
