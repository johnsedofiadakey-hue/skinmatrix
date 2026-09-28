// Website orders from the checkout. The browser shows the cart and checks the customer's details as they type,
// then sends only product ids, quantities and details to the placeWebOrder Cloud Function, which prices the order
// from the catalogue and saves it. Paystack payments are confirmed by the server with Paystack itself.
import { canBuy } from './site.js'
import { callSite } from './functions.js'
import { checkDetails, MAX_QTY, normalizeGhanaPhone } from '../../functions/src/core/order.js'

export { checkDetails, MAX_QTY, normalizeGhanaPhone }
export const PAYMENT = { paystack: 'paystack', later: 'pay_later' }

// Cart is { productId: quantity }. Only products that can be bought are kept.
export function cartLines(cart, products) {
  return products
    .filter((product) => canBuy(product) && cart[product.id] > 0)
    .map((product) => {
      const qty = Math.min(MAX_QTY, Math.floor(cart[product.id]))
      // Keep the image that was shown at checkout with the order. This lets the
      // fulfilment team identify a box even if the catalogue artwork changes later.
      return { id: product.id, name: product.name, brand: product.brand, size: product.size, image: String(product.image || '').slice(0, 1000), price: product.price, qty, lineTotal: product.price * qty }
    })
}

export function orderTotals(lines, method, deliveryFee) {
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0)
  const fee = method === 'delivery' && Number.isInteger(deliveryFee) ? deliveryFee : 0
  return { subtotal, deliveryFee: method === 'delivery' ? (Number.isInteger(deliveryFee) ? deliveryFee : null) : 0, total: subtotal + fee }
}

const randomId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`

// What the server needs to place the order. The same requestId sent twice places the order only once.
export function orderRequest({ requestId = randomId(), cart, products, details, payment }) {
  return {
    requestId,
    payment,
    details: { name: String(details.name || '').trim(), phone: String(details.phone || ''), email: String(details.email || '').trim(), method: details.method, address: String(details.address || '').trim(), notes: String(details.notes || '').trim().slice(0, 500) },
    lines: cartLines(cart, products).map((line) => ({ id: line.id, qty: line.qty })),
  }
}

// Each Paystack attempt on the same order needs its own reference: "SM-ABC234-K7Q2".
export function paystackReference(ref, random = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let suffix = ''
  for (let i = 0; i < 4; i += 1) suffix += alphabet[random() % alphabet.length]
  return `${ref}-${suffix}`
}

export const placeOrder = (request) => callSite('placeWebOrder', request)
export const verifyPayment = (ref, reference) => callSite('verifyWebPayment', { ref, reference })
