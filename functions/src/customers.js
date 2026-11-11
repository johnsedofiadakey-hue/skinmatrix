// Customer records, built from the till: when the cashier types a customer's phone number on a sale, the shop
// remembers them (customers/{2332XXXXXXXX}: name, phone, visits, total spent, first and last visit). Staff can
// read them (the till fills in the name when the number is typed again); only these server functions write them,
// inside the same transaction as the sale, cancel or return, so the totals always match the sales.
import { normalizePhone } from './core/sale.js'

export const customerKey = (customer) => (customer?.phone ? normalizePhone(customer.phone) : null)

// Reads must come before writes in a Firestore transaction: call this with the other reads.
export async function readCustomer(tx, db, key) {
  if (!key) return null
  const snap = await tx.get(db.doc(`customers/${key}`))
  return { key, data: snap.exists ? snap.data() : null }
}

// A completed sale: one more visit and its total.
export function recordVisit(tx, db, read, { name, phone, total, at, saleId }) {
  if (!read) return
  const before = read.data
  tx.set(db.doc(`customers/${read.key}`), {
    phone,
    name: name || before?.name || '',
    visits: (before?.visits || 0) + 1,
    totalSpent: (before?.totalSpent || 0) + total,
    firstVisit: Math.min(before?.firstVisit ?? at, at),
    lastVisit: Math.max(before?.lastVisit ?? at, at),
    lastSaleId: saleId,
  })
}

// A cancelled sale (visit: true) or returned items: money given back comes off the total.
export function takeBack(tx, db, read, { amount, visit = false }) {
  if (!read?.data) return
  tx.update(db.doc(`customers/${read.key}`), {
    totalSpent: Math.max(0, (read.data.totalSpent || 0) - amount),
    visits: Math.max(0, (read.data.visits || 0) - (visit ? 1 : 0)),
  })
}
