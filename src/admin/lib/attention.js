import { STATUS } from './orderStates.js'
import { MINUTE } from './time.js'

export const UNPAID_ATTENTION_MS = 30 * MINUTE

// Why an order needs a person to look at it now, or null. Ordered by urgency.
export function orderAttention(order, now) {
  if (order.payment.state === 'refund_due') return { level: 'high', text: 'Refund due' }
  if (!order.branchId && order.payment.state === 'paid' && order.status !== STATUS.CANCELLED) return { level: 'high', text: 'Waiting for stock' }
  if (order.status === STATUS.PAID) return { level: 'high', text: 'Paid — not started' }
  if (order.status === STATUS.AWAITING_PAYMENT && now - order.createdAt > UNPAID_ATTENTION_MS) {
    return { level: 'medium', text: `Unpaid for ${Math.round((now - order.createdAt) / MINUTE)} min` }
  }
  if (order.status === STATUS.READY) return { level: 'medium', text: order.fulfilment?.method === 'delivery' ? (order.fulfilment.rider ? 'Ready to dispatch' : 'Needs a rider') : 'Ready for pickup' }
  if (order.status === STATUS.OUT_FOR_DELIVERY && now - (order.statusHistory.at(-1)?.at ?? now) > 3 * 60 * MINUTE) return { level: 'medium', text: 'Out 3h+ — check rider' }
  return null
}
