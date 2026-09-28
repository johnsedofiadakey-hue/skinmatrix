// Sales made while the till has no internet. They are kept on this device (per staff member) and sent to the
// server when the connection is back. Each keeps the request id of the original attempt, so a sale that did
// reach the server before the connection dropped is never recorded twice.
//
// entry: { requestId, at, shiftId, lines, discount, payment, customer, clientTotal, localNumber, status: 'waiting' | 'problem', error, receipt }
const key = (uid) => `skinmatrix-offline-sales-${uid}`

export function readQueue(uid) {
  try {
    const list = JSON.parse(localStorage.getItem(key(uid)) || '[]')
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

// Returns false if this device cannot store it (private window, storage full): the sale must not be made then.
export function writeQueue(uid, list) {
  try { localStorage.setItem(key(uid), JSON.stringify(list)); return true } catch { return false }
}

// What completeSale needs, from a stored entry.
export const salePayload = (entry) => ({
  requestId: entry.requestId,
  lines: entry.lines,
  discount: entry.discount,
  payment: entry.payment,
  customer: entry.customer,
  offline: { at: entry.at, shiftId: entry.shiftId || null, clientTotal: entry.clientTotal },
})

// Codes that mean "the server was not reached": try again later rather than asking a person.
export const isConnectionProblem = (code) => ['unavailable', 'deadline-exceeded', 'network', 'internal', 'unknown'].includes(code) || !navigator.onLine
