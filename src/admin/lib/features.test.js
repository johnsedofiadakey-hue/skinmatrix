import { describe, expect, it } from 'vitest'
import { allocateFefo, expiryStatus, stockValue } from './stock.js'
import { buildCustomers, displayPhone, normalizePhone, whatsappLink } from './customers.js'
import { parseExpiry, parseSheet, readWalkInSheet } from './walkInImport.js'
import { chooseFulfilmentBranch } from './routing.js'
import { STATUS, transitionOptions } from './orderStates.js'

const NOW = Date.parse('2026-09-26T12:00:00Z')
const branches = [{ id: 'branch-a', name: 'Demo Branch A', short: 'Branch A' }, { id: 'branch-b', name: 'Demo Branch B', short: 'Branch B' }]

describe('expiry', () => {
  it('classifies by the Ghana business day', () => {
    expect(expiryStatus(null, NOW)).toBe('none')
    expect(expiryStatus('2026-09-25', NOW)).toBe('expired')
    expect(expiryStatus('2026-09-26', NOW)).toBe('urgent')
    expect(expiryStatus('2026-10-20', NOW)).toBe('urgent')
    expect(expiryStatus('2026-12-01', NOW)).toBe('soon')
    expect(expiryStatus('2027-06-01', NOW)).toBe('ok')
  })

  it('allocates first-expiry-first-out, skipping expired and empty batches', () => {
    const batches = [
      { id: 'late', quantity: 10, expiresOn: '2028-01-01', receivedAt: 1 },
      { id: 'none', quantity: 10, expiresOn: null, receivedAt: 0 },
      { id: 'expired', quantity: 10, expiresOn: '2026-01-01', receivedAt: 0 },
      { id: 'soon', quantity: 2, expiresOn: '2026-11-01', receivedAt: 2 },
      { id: 'empty', quantity: 0, expiresOn: '2026-10-01', receivedAt: 0 },
    ]
    expect(allocateFefo(batches, 5, NOW)).toEqual([{ batchId: 'soon', quantity: 2 }, { batchId: 'late', quantity: 3 }])
    expect(allocateFefo(batches, 22, NOW)).toEqual([{ batchId: 'soon', quantity: 2 }, { batchId: 'late', quantity: 10 }, { batchId: 'none', quantity: 10 }])
    expect(allocateFefo(batches, 23, NOW)).toBeNull()
  })

  it('values stock at selling price and separates expiring and expired stock', () => {
    const state = {
      catalog: [{ variants: [{ id: 'v', price: 1000 }] }],
      listings: { v: { 'branch-a': true } },
      batches: [
        { variantId: 'v', branchId: 'branch-a', quantity: 3, expiresOn: '2028-01-01' },
        { variantId: 'v', branchId: 'branch-a', quantity: 2, expiresOn: '2026-10-10' },
        { variantId: 'v', branchId: 'branch-a', quantity: 1, expiresOn: '2026-01-01' },
      ],
    }
    const { total } = stockValue(state, ['branch-a'], NOW)
    expect(total).toMatchObject({ units: 5, worth: 5000, soonUnits: 2, soonWorth: 2000, expiredUnits: 1, expiredWorth: 1000 })
  })
})

describe('customers', () => {
  it('normalises Ghanaian phone numbers', () => {
    expect(normalizePhone('024 123 4567')).toBe('233241234567')
    expect(normalizePhone('+233 24 123 4567')).toBe('233241234567')
    expect(normalizePhone('00233241234567')).toBe('233241234567')
    expect(normalizePhone('0556702040/0556564142')).toBe('233556702040')
    expect(normalizePhone('12345')).toBeNull()
    expect(displayPhone('233241234567')).toBe('024 123 4567')
    expect(whatsappLink('0241234567')).toBe('https://wa.me/233241234567')
  })

  it('builds records keyed by phone, counting only collected sales as spend', () => {
    const paid = (id, phone, total, createdAt, extra = {}) => ({ id, createdAt, channel: 'pos', branchId: 'branch-a', total, status: STATUS.FULFILLED, payment: { state: 'paid' }, customer: { name: 'Ama', phone }, ...extra })
    const customers = buildCustomers([
      paid('1', '0241234567', 1000, 1),
      paid('2', '+233241234567', 2000, 2, { customer: { name: 'Ama K.', phone: '+233241234567' } }),
      paid('3', '0241234567', 500, 3, { status: STATUS.CANCELLED, payment: { state: 'refunded' }, customer: { name: '', phone: '0241234567' } }),
      paid('4', '', 999, 4),
    ])
    expect(customers.size).toBe(1)
    expect(customers.get('233241234567')).toMatchObject({ name: 'Ama K.', orders: 2, spend: 3000, orderIds: ['1', '2', '3'] })
  })
})

describe('walk-in sheet', () => {
  it('parses CSV with quotes and tab-separated pastes', () => {
    expect(parseSheet('a,"b, c",d\n1,2,3')).toEqual([['a', 'b, c', 'd'], ['1', '2', '3']])
    expect(parseSheet('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('reads expiry in common formats', () => {
    expect(parseExpiry('2027-08-31')).toBe('2027-08-31')
    expect(parseExpiry('31/08/2027')).toBe('2027-08-31')
    expect(parseExpiry('02/2028')).toBe('2028-02-29')
    expect(parseExpiry('31/02/2027')).toBeNull()
  })

  it('never uses a cost column as the price', () => {
    const result = readWalkInSheet('Name,SKU,Cost,Branch A\nSerum,SM-1,50,3', { branches })
    expect(result.problems.join(' ')).toMatch(/cost column is never used/i)
  })

  it('validates each row', () => {
    const text = [
      'Name,SKU,Price,Lot,Expiry,Branch A,Branch B',
      'Good,SM-1,10.50,L1,2027-01-01,3,',
      'No lot,SM-2,10,,2027-01-01,3,0',
      'Pouch,SM-3,5,P1,none,4,4',
      'Bad qty,SM-4,5,L1,2027-01-01,two,',
      'Exists,SM-OLD,5,L1,2027-01-01,1,',
      'Twice,SM-1,5,L1,2027-01-01,1,',
    ].join('\n')
    const { rows } = readWalkInSheet(text, { branches, existingSkus: new Set(['SM-OLD']) })
    expect(rows.map((row) => row.ok)).toEqual([true, false, true, false, false, false])
    expect(rows[0].value).toMatchObject({ price: 1050, quantities: { 'branch-a': 3 }, tracksExpiry: true })
    expect(rows[2].value).toMatchObject({ expiresOn: null, tracksExpiry: false })
  })
})

describe('routing and delivery transitions', () => {
  it('routes to a branch that can supply every line, preferring the most units', () => {
    const state = {
      branches,
      listings: { x: { 'branch-a': true, 'branch-b': true }, y: { 'branch-a': true } },
      batches: [
        { variantId: 'x', branchId: 'branch-a', quantity: 2, expiresOn: null, receivedAt: 0 },
        { variantId: 'x', branchId: 'branch-b', quantity: 9, expiresOn: null, receivedAt: 0 },
        { variantId: 'y', branchId: 'branch-a', quantity: 1, expiresOn: null, receivedAt: 0 },
      ],
    }
    expect(chooseFulfilmentBranch(state, [{ variantId: 'x', quantity: 2 }], NOW)).toBe('branch-b')
    expect(chooseFulfilmentBranch(state, [{ variantId: 'x', quantity: 2 }, { variantId: 'y', quantity: 1 }], NOW)).toBe('branch-a')
    expect(chooseFulfilmentBranch(state, [{ variantId: 'y', quantity: 2 }], NOW)).toBeNull()
  })

  it('sends deliveries out with a rider and hands pickups over directly', () => {
    const staff = { role: 'manager', branchId: 'branch-a' }
    const edges = (fulfilment) => transitionOptions({ order: { status: STATUS.READY, branchId: 'branch-a', channel: 'web', fulfilment }, staff, now: NOW })
    expect(edges({ method: 'pickup' }).map((edge) => edge.to)).toEqual([STATUS.FULFILLED, STATUS.CANCELLED])
    const delivery = edges({ method: 'delivery', rider: null })
    expect(delivery.map((edge) => edge.to)).toEqual([STATUS.OUT_FOR_DELIVERY, STATUS.CANCELLED])
    expect(delivery[0]).toMatchObject({ allowed: false, why: 'Assign a rider first' })
    expect(edges({ method: 'delivery', rider: { name: 'Ebo' } })[0].allowed).toBe(true)
  })
})
