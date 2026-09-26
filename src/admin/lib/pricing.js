// Cart-level discounts, the refund value of returned lines, and barcode checks. All money is integer pesewas.

// discount: { type: 'percent', value: 1–100 } | { type: 'amount', value: pesewas }. Returns the pesewas taken off.
export function discountAmount(subtotal, discount) {
  if (!discount) return 0
  if (discount.type === 'percent') {
    if (!Number.isInteger(discount.value) || discount.value < 1 || discount.value > 100) return null
    return Math.round((subtotal * discount.value) / 100)
  }
  if (discount.type === 'amount') {
    if (!Number.isSafeInteger(discount.value) || discount.value < 1 || discount.value > subtotal) return null
    return discount.value
  }
  return null
}

// Discount as a whole percentage of the subtotal (for limit checks), rounded up so 10.01% counts as over 10%.
export function discountPercent(subtotal, amount) {
  return subtotal ? Math.ceil((amount * 10000) / subtotal) / 100 : 0
}

// What returning `quantity` of a line is worth after the order's discount: the customer paid total/subtotal of list.
export function returnValue(order, variantId, quantity) {
  const item = order.items.find((line) => line.variantId === variantId)
  if (!item || !quantity) return 0
  return Math.round((item.unitPrice * quantity * order.total) / order.subtotal)
}

// Units of a variant already returned on an order.
export function returnedQuantity(order, variantId) {
  return (order.returns || []).flatMap((entry) => entry.lines).filter((line) => line.variantId === variantId).reduce((sum, line) => sum + line.quantity, 0)
}

// EAN-13 check digit for a 12-digit body.
export function ean13CheckDigit(body) {
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return String((10 - (sum % 10)) % 10)
}

export function isValidBarcode(code) {
  const text = String(code || '')
  if (/^\d{13}$/.test(text)) return ean13CheckDigit(text.slice(0, 12)) === text[12]
  return /^[A-Za-z0-9-]{6,20}$/.test(text)
}
