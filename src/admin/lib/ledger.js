import { STATUS } from './orderStates.js'
import { businessDayKey } from './time.js'

// Payment states in which the sale's money was collected. A return keeps the sale in the record; the refunded amount
// is subtracted separately, so gross − returns is what the shop actually kept.
const COLLECTED = ['paid', 'part_refunded', 'refunded']

// Money counted as a sale: collected, and not voided or cancelled.
export function isCountedSale(order) {
  return order.status !== STATUS.CANCELLED && COLLECTED.includes(order.payment.state)
}

// A void/cancellation of an order whose money had been collected.
export function isReversedSale(order) {
  return order.status === STATUS.CANCELLED && ['refunded', 'refund_due'].includes(order.payment.state)
}

export function returnedAmount(order) {
  return (order.returns || []).reduce((sum, entry) => sum + entry.amount, 0)
}

export function ledgerTotals(orders) {
  const totals = {
    gross: 0,
    net: 0,
    count: 0,
    discounts: 0,
    returns: 0,
    returnCount: 0,
    byMethod: { cash: 0, momo: 0, card: 0 },
    byChannel: { pos: 0, web: 0 },
    reversedCount: 0,
    reversedValue: 0,
    refundsDue: 0,
  }
  for (const order of orders) {
    if (isCountedSale(order)) {
      totals.gross += order.total
      totals.count += 1
      totals.discounts += order.discount?.amount || 0
      totals.returns += returnedAmount(order)
      totals.returnCount += (order.returns || []).length
      totals.byMethod[order.payment.method] = (totals.byMethod[order.payment.method] || 0) + order.total
      totals.byChannel[order.channel] += order.total
    } else if (isReversedSale(order)) {
      totals.reversedCount += 1
      totals.reversedValue += order.total
      if (order.payment.state === 'refund_due') totals.refundsDue += 1
    }
  }
  totals.net = totals.gross - totals.returns
  return totals
}

// [{ day, orders, totals }] newest day first.
export function groupByDay(orders) {
  const days = new Map()
  for (const order of orders) {
    const day = businessDayKey(order.createdAt)
    if (!days.has(day)) days.set(day, [])
    days.get(day).push(order)
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, list]) => ({ day, orders: list, totals: ledgerTotals(list) }))
}
