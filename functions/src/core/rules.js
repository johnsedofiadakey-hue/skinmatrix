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
  manager: new Set(['sell', 'viewSales', 'webOrders', 'viewStock', 'approve', 'void', 'return', 'stock', 'deliveries', 'reports', 'costs', 'cashOut', 'closeAnyShift']),
  owner: new Set(['sell', 'viewSales', 'webOrders', 'viewStock', 'approve', 'void', 'return', 'stock', 'deliveries', 'reports', 'costs', 'cashOut', 'closeAnyShift', 'products', 'staff', 'website', 'settings', 'voidAnyDay']),
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

// ── Staff sign-in with a username ("ama") instead of an email ──
// Firebase Auth signs people in with an email, so each username is stored as a sign-in address on a domain the
// shop owns that never receives mail. Staff never see it: they type their username and password.
export const STAFF_LOGIN_DOMAIN = 'staff.skinmatrixgh.com'
export const MIN_PASSWORD = 6

// "Ama " -> "ama". Letters, numbers, dot, dash and underscore; starts with a letter; 2–24 characters.
export const cleanUsername = (value) => String(value ?? '').trim().toLowerCase()
export const isValidUsername = (value) => /^[a-z][a-z0-9._-]{1,23}$/.test(cleanUsername(value))
export const usernameEmail = (value) => `${cleanUsername(value)}@${STAFF_LOGIN_DOMAIN}`
// What the sign-in box accepts: a username, or the owner's own email.
export const signInEmail = (value) => (String(value ?? '').includes('@') ? String(value).trim().toLowerCase() : usernameEmail(value))
export const usernameOf = (email) => (String(email || '').toLowerCase().endsWith(`@${STAFF_LOGIN_DOMAIN}`) ? String(email).split('@')[0] : null)
