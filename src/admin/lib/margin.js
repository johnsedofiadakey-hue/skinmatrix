import { isCountedSale } from './ledger.js'
import { returnedQuantity } from './pricing.js'

// Cost of goods comes from the BATCHES a sale actually took (each delivery records its own unit cost), so margin
// reflects what those exact units cost, not today's price list. Returned units have already been taken out of the
// order's stock deductions, so they carry no cost here.
export function orderCost(order, batchCost) {
  return (order.stockDeductions || []).reduce((sum, deduction) => sum + deduction.quantity * (batchCost.get(deduction.batchId) ?? 0), 0)
}

// Per-product sales for the counted orders: net units, revenue after discounts and returns, cost and margin.
export function productPerformance(orders, batches) {
  const batchCost = new Map(batches.map((batch) => [batch.id, batch.unitCost ?? 0]))
  const rows = new Map()
  for (const order of orders) {
    if (!isCountedSale(order)) continue
    const share = order.subtotal ? order.total / order.subtotal : 1
    for (const item of order.items) {
      const units = item.quantity - returnedQuantity(order, item.variantId)
      if (units <= 0) continue
      if (!rows.has(item.variantId)) rows.set(item.variantId, { variantId: item.variantId, name: item.name, variantName: item.variantName, sku: item.sku, units: 0, revenue: 0, cost: 0, orders: 0 })
      const row = rows.get(item.variantId)
      row.units += units
      row.orders += 1
      row.revenue += Math.round(item.unitPrice * units * share)
      row.cost += (order.stockDeductions || []).filter((deduction) => deduction.variantId === item.variantId).reduce((sum, deduction) => sum + deduction.quantity * (batchCost.get(deduction.batchId) ?? 0), 0)
    }
  }
  return [...rows.values()].map((row) => ({ ...row, margin: row.revenue - row.cost, marginPct: row.revenue ? Math.round(((row.revenue - row.cost) / row.revenue) * 1000) / 10 : 0 }))
}

export function marginTotals(rows) {
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0)
  const cost = rows.reduce((sum, row) => sum + row.cost, 0)
  return { revenue, cost, margin: revenue - cost, marginPct: revenue ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : 0 }
}
