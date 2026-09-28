// Shared by the server (Cloud Functions) and the admin screens. Pure JavaScript, no imports from Firebase,
// so the rule a cashier sees on screen is the same rule the server enforces.

export class RuleError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'RuleError'
    this.code = code
  }
}

export const ROLES = ['staff', 'manager', 'owner']
export const ROLE_LABEL = { staff: 'Staff', manager: 'Manager', owner: 'Owner' }

// What each role may do without anyone else's approval.
const CAN = {
  staff: new Set(['sell', 'viewSales', 'webOrders', 'viewStock']),
  manager: new Set(['sell', 'viewSales', 'webOrders', 'viewStock', 'approve', 'void', 'return', 'stock', 'deliveries', 'reports', 'costs']),
  owner: new Set(['sell', 'viewSales', 'webOrders', 'viewStock', 'approve', 'void', 'return', 'stock', 'deliveries', 'reports', 'costs', 'products', 'staff', 'website', 'voidAnyDay']),
}

export function can(role, action) {
  return Boolean(CAN[role]?.has(action))
}

// Largest discount (percent of the cart) each role may give alone. Above this, a manager or the owner approves.
export const DISCOUNT_LIMIT = { staff: 10, manager: 100, owner: 100 }
export const RETURN_WINDOW_DAYS = 30

export const PAYMENT_METHODS = ['cash', 'momo', 'card']
export const MOMO_NETWORKS = ['MTN', 'Telecel', 'AT']

export function requireReason(reason, label = 'reason') {
  const text = String(reason ?? '').trim()
  if (text.length < 3) throw new RuleError('reason_required', `Write a short ${label}.`)
  return text.slice(0, 300)
}

export const isValidPin = (pin) => /^\d{4,6}$/.test(String(pin ?? ''))
