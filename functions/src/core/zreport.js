// The Z report: the shop's closing record for one business day, worked out from that day's sales and cash
// drawers. Pure JavaScript so the till can preview exactly what the server will record.
import { expectedCash } from './shift.js'
import { refundedAmount } from './sale.js'

const zeroTax = () => ({ net: 0, vat: 0, nhil: 0, getfund: 0 })

// sales: sales/{id} documents with day == the business day. shifts: shifts/{id} documents opened that day.
export function summarizeDay(sales, shifts) {
  const report = {
    count: 0, gross: 0, discounts: 0, refunds: 0, net: 0, voided: 0, voidedCount: 0,
    byMethod: { cash: 0, momo: 0, card: 0 }, tax: zeroTax(), firstSale: null, lastSale: null, drawers: [],
  }
  const numbers = []
  for (const sale of sales) {
    numbers.push(sale.number)
    if (sale.status === 'voided') { report.voided += sale.total; report.voidedCount += 1; continue }
    const refunded = refundedAmount(sale)
    report.count += 1
    report.gross += sale.total
    report.discounts += sale.discount?.amount || 0
    report.refunds += refunded
    report.byMethod[sale.payment.method] = (report.byMethod[sale.payment.method] || 0) + sale.total
    for (const entry of sale.returns || []) report.byMethod[entry.refundMethod] = (report.byMethod[entry.refundMethod] || 0) - entry.amount
    if (sale.tax) for (const key of ['net', 'vat', 'nhil', 'getfund']) report.tax[key] += sale.tax[key] || 0
  }
  report.net = report.gross - report.refunds
  if (numbers.length) {
    report.firstSale = Math.min(...numbers)
    report.lastSale = Math.max(...numbers)
  }
  report.drawers = shifts
    .slice()
    .sort((a, b) => a.openedAt - b.openedAt)
    .map((shift) => ({
      id: shift.id,
      cashier: shift.cashier?.name || 'Unknown',
      status: shift.status,
      float: shift.float || 0,
      cashSales: shift.cashSales || 0,
      cashRefunds: shift.cashRefunds || 0,
      noSales: shift.noSales || 0,
      expected: shift.status === 'closed' ? shift.expected : expectedCash(shift),
      counted: shift.status === 'closed' ? shift.counted : null,
      difference: shift.status === 'closed' ? shift.difference : null,
    }))
  report.cashDifference = report.drawers.reduce((sum, drawer) => sum + (drawer.difference || 0), 0)
  return report
}

export const zNumber = (value) => `Z${String(value).padStart(4, '0')}`
