import { isCountedSale, returnedAmount } from './ledger.js'

// Customers are keyed by their phone number in international form (233XXXXXXXXX), the way Ghanaian
// numbers are shared: "024 123 4567", "+233 24 123 4567" and "0241234567/0209998888" all resolve.

// Returns '233XXXXXXXXX' or null. Takes the first number when several were typed into one field.
export function normalizePhone(raw) {
  const first = String(raw || '').split(/[\/,;]| or /i)[0]
  let digits = first.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 10 && digits.startsWith('0')) digits = `233${digits.slice(1)}`
  if (digits.length === 9) digits = `233${digits}`
  return /^233\d{9}$/.test(digits) ? digits : null
}

// '233241234567' -> '024 123 4567'
export function displayPhone(key) {
  if (!key) return ''
  const local = `0${key.slice(3)}`
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`
}

export function whatsappLink(raw) {
  const key = normalizePhone(raw)
  return key ? `https://wa.me/${key}` : null
}

export function callLink(raw) {
  const key = normalizePhone(raw)
  return key ? `tel:+${key}` : null
}

// Customer records derived from orders. In production the server keeps these aggregates up to date in the same
// transaction as each sale; deriving them here keeps the prototype consistent with the orders by construction.
export function buildCustomers(orders) {
  const customers = new Map()
  for (const order of [...orders].sort((a, b) => a.createdAt - b.createdAt)) {
    const key = normalizePhone(order.customer?.phone)
    if (!key) continue
    if (!customers.has(key)) {
      customers.set(key, { key, name: '', email: '', orderIds: [], orders: 0, spend: 0, firstAt: order.createdAt, lastAt: order.createdAt, branches: new Set(), channels: { pos: 0, web: 0 } })
    }
    const customer = customers.get(key)
    if (order.customer.name) customer.name = order.customer.name
    if (order.customer.email) customer.email = order.customer.email
    customer.orderIds.push(order.id)
    customer.lastAt = order.createdAt
    if (order.branchId) customer.branches.add(order.branchId)
    if (isCountedSale(order)) {
      customer.orders += 1
      customer.spend += order.total - returnedAmount(order)
      customer.channels[order.channel] += 1
    }
  }
  return customers
}
