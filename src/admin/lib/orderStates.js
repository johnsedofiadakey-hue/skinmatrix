import { businessDayKey } from './time.js'
import { canAccessBranch, capability } from './permissions.js'

export const STATUS = {
  DRAFT: 'Draft',
  AWAITING_PAYMENT: 'Awaiting payment',
  PAID: 'Paid',
  PROCESSING: 'Processing',
  READY: 'Ready',
  OUT_FOR_DELIVERY: 'Out for delivery',
  FULFILLED: 'Fulfilled',
  CANCELLED: 'Cancelled',
}

export const STATUS_ORDER = [
  STATUS.DRAFT, STATUS.AWAITING_PAYMENT, STATUS.PAID, STATUS.PROCESSING, STATUS.READY, STATUS.OUT_FOR_DELIVERY, STATUS.FULFILLED, STATUS.CANCELLED,
]

// Every edge a staff member can request. Draft/Awaiting payment -> Paid is deliberately absent:
// only a verified payment (server webhook) may mark an order paid.
const EDGES = {
  [STATUS.DRAFT]: [STATUS.CANCELLED],
  [STATUS.AWAITING_PAYMENT]: [STATUS.CANCELLED],
  [STATUS.PAID]: [STATUS.PROCESSING, STATUS.CANCELLED],
  [STATUS.PROCESSING]: [STATUS.READY, STATUS.CANCELLED],
  [STATUS.READY]: [STATUS.OUT_FOR_DELIVERY, STATUS.FULFILLED, STATUS.CANCELLED],
  [STATUS.OUT_FOR_DELIVERY]: [STATUS.FULFILLED, STATUS.CANCELLED],
  [STATUS.FULFILLED]: [STATUS.CANCELLED],
  [STATUS.CANCELLED]: [],
}

export function isOpen(order) {
  return ![STATUS.FULFILLED, STATUS.CANCELLED].includes(order.status)
}

function actionLabel(order, to) {
  if (to === STATUS.OUT_FOR_DELIVERY) return 'Send out for delivery'
  if (to === STATUS.FULFILLED && order.status === STATUS.OUT_FOR_DELIVERY) return 'Mark delivered'
  if (to === STATUS.FULFILLED && order.fulfilment?.method === 'pickup') return 'Mark collected'
  if (to !== STATUS.CANCELLED) return `Mark ${to.toLowerCase()}`
  if (order.status === STATUS.FULFILLED) return order.channel === 'pos' ? 'Void sale' : 'Cancel and refund'
  return 'Cancel order'
}

// Returns every edge out of the current state with whether this staff member may take it and why not.
export function transitionOptions({ order, staff, now }) {
  // A delivery goes out with a rider before it is fulfilled; a pickup is fulfilled at the counter.
  const delivery = order.fulfilment?.method === 'delivery'
  const edges = (EDGES[order.status] || []).filter((to) => {
    if (order.status !== STATUS.READY) return true
    if (to === STATUS.OUT_FOR_DELIVERY) return delivery
    if (to === STATUS.FULFILLED) return !delivery
    return true
  })
  return edges.map((to) => {
    const option = { to, label: actionLabel(order, to), requiresReason: to === STATUS.CANCELLED, destructive: to === STATUS.CANCELLED, allowed: true, why: '' }
    const deny = (why) => ({ ...option, allowed: false, why })

    if (!order.branchId) return deny('Assign a fulfilling branch first')
    if (!canAccessBranch(staff, order.branchId)) return deny('Outside your branch')
    if (to === STATUS.OUT_FOR_DELIVERY && !order.fulfilment?.rider) return deny('Assign a rider first')

    if (to !== STATUS.CANCELLED) {
      return capability(staff, 'progressOrders') ? option : deny('Your role cannot progress orders')
    }

    if (order.status !== STATUS.FULFILLED) {
      return capability(staff, 'cancelOpenOrders') ? option : deny('Cancelling needs a manager')
    }

    const voidRule = capability(staff, 'voidSales')
    if (!voidRule) return deny('Voiding a sale needs a manager')
    if (voidRule === 'same_day' && businessDayKey(order.completedAt ?? order.createdAt) !== businessDayKey(now)) {
      return deny('Managers may only void sales on the day they were made')
    }
    return option
  })
}

export function findTransition(args, to) {
  return transitionOptions(args).find((option) => option.to === to) || null
}
