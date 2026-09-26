// Website orders: build and check an order from the cart, then save it to Firestore `orders/{ref}`.
// firestore.rules re-checks the shape. Prices come from the customer's browser, so staff must compare
// the total with the Paystack payment before sending (a Cloud Function will do this once the project is on Blaze).
import { canBuy } from './site.js'

export const MAX_QTY = 20
export const PAYMENT = { paystack: 'paystack', later: 'pay_later' }

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
  const name = String(details.name || '').trim()
  if (name.length < 2) errors.name = 'Enter your full name.'
  if (!normalizeGhanaPhone(details.phone)) errors.phone = 'Enter a Ghana phone number, like 024 123 4567.'
  const email = String(details.email || '').trim()
  if (needEmail && !email) errors.email = 'Enter your email. Paystack sends your receipt there.'
  else if (email && !EMAIL.test(email)) errors.email = 'This email does not look right.'
  if (details.method !== 'pickup' && details.method !== 'delivery') errors.method = 'Choose delivery or pickup.'
  if (details.method === 'delivery' && !delivery) errors.method = 'Delivery is not available right now. Choose pickup.'
  if (details.method === 'delivery' && String(details.address || '').trim().length < 5) errors.address = 'Enter your address, with a landmark or GPS address.'
  return errors
}

// Cart is { productId: quantity }. Only products that can be bought are kept.
export function cartLines(cart, products) {
  return products
    .filter((product) => canBuy(product) && cart[product.id] > 0)
    .map((product) => {
      const qty = Math.min(MAX_QTY, Math.floor(cart[product.id]))
      return { id: product.id, name: product.name, brand: product.brand, size: product.size, price: product.price, qty, lineTotal: product.price * qty }
    })
}

export function orderTotals(lines, method, deliveryFee) {
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0)
  const fee = method === 'delivery' && Number.isInteger(deliveryFee) ? deliveryFee : 0
  return { subtotal, deliveryFee: method === 'delivery' ? (Number.isInteger(deliveryFee) ? deliveryFee : null) : 0, total: subtotal + fee }
}

export function newOrderRef(random = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let ref = ''
  for (let i = 0; i < 6; i += 1) ref += alphabet[random() % alphabet.length]
  return `SM-${ref}`
}

export function buildOrder({ ref, cart, products, details, checkout, payment }) {
  const lines = cartLines(cart, products)
  const method = details.method
  const totals = orderTotals(lines, method, checkout.deliveryFee)
  return {
    ref,
    channel: 'website',
    status: 'new',
    customer: { name: String(details.name).trim(), phone: normalizeGhanaPhone(details.phone), email: String(details.email || '').trim() },
    fulfilment: { method, address: method === 'delivery' ? String(details.address || '').trim() : '', notes: String(details.notes || '').trim().slice(0, 500) },
    lines,
    ...totals,
    payment,
  }
}

export async function saveOrder(order) {
  const [{ doc, serverTimestamp, setDoc }, { db }] = await Promise.all([import('firebase/firestore/lite'), import('./firebase.js')])
  await setDoc(doc(db, 'orders', order.ref), { ...order, createdAt: serverTimestamp() })
}
