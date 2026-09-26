import { describe, expect, it } from 'vitest'
import { formatMoney, parseCedis, sumPesewas } from './money.js'
import { canAccessBranch, visibleBranchIds } from './permissions.js'
import { STATUS, transitionOptions } from './orderStates.js'
import { stockDeltas, stockStatus } from './stock.js'
import { ledgerTotals } from './ledger.js'
import { DAY } from './time.js'

const NOW = Date.parse('2026-09-26T12:00:00Z')
const cashier = { id: 'c', role: 'staff', branchId: 'a' }
const manager = { id: 'm', role: 'manager', branchId: 'a' }
const ops = { id: 'o', role: 'owner', branchId: 'a' }

describe('money', () => {
  it('formats integer pesewas at the edge', () => {
    expect(formatMoney(34000)).toBe('GHS 340.00')
    expect(formatMoney(123456789)).toBe('GHS 1,234,567.89')
    expect(formatMoney(-550)).toBe('−GHS 5.50')
    expect(formatMoney(550, { signed: true })).toBe('+GHS 5.50')
  })
  it('refuses non-integer money', () => {
    expect(() => formatMoney(3.5)).toThrow(TypeError)
    expect(() => sumPesewas([100, 0.1])).toThrow(TypeError)
  })
  it('parses typed cedi amounts without floating point', () => {
    expect(parseCedis('12')).toBe(1200)
    expect(parseCedis('12.5')).toBe(1250)
    expect(parseCedis('0.29')).toBe(29)
    expect(parseCedis('1,250.05')).toBe(125005)
    expect(parseCedis('12.345')).toBeNull()
    expect(parseCedis('-3')).toBeNull()
    expect(parseCedis('abc')).toBeNull()
  })
})

describe('branch scope', () => {
  it('limits branch staff to their branch', () => {
    expect(canAccessBranch(cashier, 'a')).toBe(true)
    expect(canAccessBranch(cashier, 'b')).toBe(false)
    expect(canAccessBranch(ops, 'b')).toBe(true)
    const branches = [{ id: 'a' }, { id: 'b' }]
    expect(visibleBranchIds(cashier, branches, 'b')).toEqual(['a'])
    expect(visibleBranchIds(ops, branches, 'all')).toEqual(['a', 'b'])
    expect(visibleBranchIds(ops, branches, 'b')).toEqual(['b'])
  })
})

describe('order transitions', () => {
  const order = (status, extra = {}) => ({ status, branchId: 'a', channel: 'web', createdAt: NOW, completedAt: NOW, ...extra })
  const option = (o, staff, to) => transitionOptions({ order: o, staff, now: NOW }).find((edge) => edge.to === to)

  it('never lets staff mark an order paid', () => {
    const edges = transitionOptions({ order: order(STATUS.AWAITING_PAYMENT), staff: ops, now: NOW }).map((edge) => edge.to)
    expect(edges).toEqual([STATUS.CANCELLED])
  })
  it('lets cashiers progress but not cancel', () => {
    expect(option(order(STATUS.PAID), cashier, STATUS.PROCESSING).allowed).toBe(true)
    expect(option(order(STATUS.PAID), cashier, STATUS.CANCELLED).allowed).toBe(false)
  })
  it('requires a reason for every cancellation', () => {
    expect(option(order(STATUS.PAID), manager, STATUS.CANCELLED).requiresReason).toBe(true)
  })
  it('denies staff acting outside their branch', () => {
    expect(option(order(STATUS.PAID, { branchId: 'b' }), cashier, STATUS.PROCESSING).allowed).toBe(false)
  })
  it('bounds manager voids to the same business day', () => {
    const today = order(STATUS.FULFILLED, { channel: 'pos' })
    const yesterday = order(STATUS.FULFILLED, { channel: 'pos', completedAt: NOW - DAY })
    expect(option(today, manager, STATUS.CANCELLED).allowed).toBe(true)
    expect(option(yesterday, manager, STATUS.CANCELLED).allowed).toBe(false)
    expect(option(yesterday, ops, STATUS.CANCELLED).allowed).toBe(true)
  })
  it('treats Cancelled as terminal', () => {
    expect(transitionOptions({ order: order(STATUS.CANCELLED), staff: ops, now: NOW })).toEqual([])
  })
})

describe('stock', () => {
  it('computes only the changed quantities', () => {
    const before = [{ variantId: 'x', quantity: 2 }, { variantId: 'y', quantity: 1 }]
    const after = [{ variantId: 'x', quantity: 1 }, { variantId: 'y', quantity: 1 }, { variantId: 'z', quantity: 3 }]
    expect(stockDeltas(before, after)).toEqual([{ variantId: 'x', delta: -1 }, { variantId: 'z', delta: 3 }])
  })
  it('classifies stock levels, treating a missing branch as unlisted', () => {
    expect(stockStatus(null, 5)).toBe('unlisted')
    expect(stockStatus(0, 5)).toBe('out')
    expect(stockStatus(5, 5)).toBe('low')
    expect(stockStatus(6, 5)).toBe('ok')
  })
})

describe('ledger', () => {
  it('counts collected sales and separates reversals', () => {
    const totals = ledgerTotals([
      { status: STATUS.FULFILLED, channel: 'pos', total: 1000, payment: { method: 'cash', state: 'paid' } },
      { status: STATUS.PROCESSING, channel: 'web', total: 2500, payment: { method: 'momo', state: 'paid' } },
      { status: STATUS.AWAITING_PAYMENT, channel: 'web', total: 9999, payment: { method: 'card', state: 'pending' } },
      { status: STATUS.CANCELLED, channel: 'pos', total: 700, payment: { method: 'momo', state: 'refund_due' } },
    ])
    expect(totals.gross).toBe(3500)
    expect(totals.count).toBe(2)
    expect(totals.byMethod).toEqual({ cash: 1000, momo: 2500, card: 0 })
    expect(totals.reversedCount).toBe(1)
    expect(totals.refundsDue).toBe(1)
  })
})
