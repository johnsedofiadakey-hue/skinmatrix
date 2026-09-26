import { onHand } from './stock.js'

// Which branch fulfils a paid web order: one that can supply EVERY line from its own sellable stock, preferring the
// branch with the most of those units (the least likely to run out). null when no single branch can, in which case the
// order waits for an operations manager to choose, and no stock is taken until then.
export function chooseFulfilmentBranch(state, items, now) {
  let best = null
  for (const branch of state.branches) {
    let units = 0
    let possible = true
    for (const item of items) {
      const available = onHand(state, item.variantId, branch.id, now)
      if (available === null || available < item.quantity) { possible = false; break }
      units += available
    }
    if (possible && (!best || units > best.units)) best = { branchId: branch.id, units }
  }
  return best?.branchId || null
}
