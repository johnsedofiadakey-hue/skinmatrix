import { RuleError } from './rules.js'

// A shift is one cashier's cash drawer from opening float to the count at closing:
//   shifts/{id} = { cashier, status: 'open' | 'closed', openedAt, day, float, cashSales, cashRefunds, lateCash,
//                   moves: [{ at, kind: 'in' | 'out', amount, reason, by, approvedBy }], closedAt, counted, expected, difference, note }
// Only cash lives in the drawer. MoMo and card go straight to the shop's accounts.

export const MAX_FLOAT = 5000000 // GHS 50,000

export function checkAmount(amount, { allowZero = false, label = 'amount' } = {}) {
  if (!Number.isSafeInteger(amount) || amount < (allowZero ? 0 : 1) || amount > MAX_FLOAT) throw new RuleError('bad_amount', `Type the ${label} in GHS.`)
  return amount
}

export const movesTotal = (shift, kind) => (shift?.moves || []).filter((move) => move.kind === kind).reduce((sum, move) => sum + move.amount, 0)

// What should be in the drawer now.
export function expectedCash(shift) {
  if (!shift) return 0
  return (shift.float || 0) + (shift.cashSales || 0) - (shift.cashRefunds || 0) + movesTotal(shift, 'in') - movesTotal(shift, 'out')
}

export function newShift({ id, cashier, float, now, day }) {
  return { id, cashier, status: 'open', openedAt: now, day, float, cashSales: 0, cashRefunds: 0, lateCash: 0, sales: 0, moves: [], closedAt: null, closedBy: null, counted: null, expected: null, difference: null, note: '' }
}
