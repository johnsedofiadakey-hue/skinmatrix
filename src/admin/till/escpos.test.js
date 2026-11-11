import { describe, expect, it } from 'vitest'
import { COMMANDS, drawerKickBytes, drawerReportOps, encode, pairLine, PAPER_WIDTH, printerTestOps, saleReceiptOps, toPrinterText, toText, wrap, zReportOps } from './escpos.js'
import { summarizeDay } from '../../../functions/src/core/zreport.js'

const includes = (bytes, sequence) => {
  for (let i = 0; i <= bytes.length - sequence.length; i += 1) if (sequence.every((value, j) => bytes[i + j] === value)) return true
  return false
}

const sale = {
  number: 42, at: Date.parse('2026-11-10T14:05:00Z'), status: 'completed', cashier: { name: 'Akosua' },
  items: [
    { productId: 'serum', name: 'Niacinamide 10% + Zinc 1% Serum with a very long name', size: '30 ml', quantity: 2, unitPrice: 20000, lineTotal: 40000 },
    { productId: 'cream', name: 'Moisturizing Cream', size: '', quantity: 1, unitPrice: 30000, lineTotal: 30000 },
  ],
  subtotal: 70000, discount: { amount: 5000, reason: 'Loyal' }, total: 65000,
  payment: { method: 'cash', received: 70000, change: 5000 }, returns: [],
  tax: { tin: 'P0012345678', vatBp: 1500, nhilBp: 250, getfundBp: 250, net: 54167, vat: 8124, nhil: 1354, getfund: 1355 },
}

describe('ESC/POS receipts', () => {
  it('keeps printer text to plain ASCII', () => {
    expect(toPrinterText('GH₵ 5 × 2 — “ok” · Crème')).toBe('GHS  5 x 2 - "ok" - Creme')
    expect(toPrinterText('😀')).toMatch(/^\?+$/)
  })

  it('lays out left and right columns to the paper width and wraps long names', () => {
    expect(pairLine('TOTAL', 'GHS 650.00', 48)).toHaveLength(48)
    expect(pairLine('A very long product name that will not fit on one line at all', 'GHS 1.00', 32)).toHaveLength(32)
    expect(wrap('one two three four', 9)).toEqual(['one two', 'three', 'four'])
  })

  it('prints the sale with totals, change and taxes, then cuts, and kicks the drawer only when asked', () => {
    const ops = saleReceiptOps(sale, { legalName: 'SkinMatrix', phone: '024 000 0000', returnDays: 7 })
    const text = toText(ops)
    expect(text).toContain('Receipt no.')
    expect(text).toContain('GHS 650.00')
    expect(text).toContain('Change')
    expect(text).toContain('VAT 15%')
    expect(text.split('\n').every((line) => line.length <= 48)).toBe(true)
    const plain = encode(ops)
    expect(Array.from(plain.slice(0, 2))).toEqual(COMMANDS.init)
    expect(includes(plain, COMMANDS.feedAndCut)).toBe(true)
    expect(includes(plain, COMMANDS.kickPin2)).toBe(false)
    expect(includes(encode(ops, { kick: true }), COMMANDS.kickPin2)).toBe(true)
    expect(includes(encode(ops, { kick: true, kickPin: 5 }), COMMANDS.kickPin5)).toBe(true)
    expect(Array.from(plain).every((value) => value < 0x80)).toBe(true)
  })

  it('fits 58 mm paper too', () => {
    const text = toText(saleReceiptOps(sale, {}), 32)
    expect(text.split('\n').every((line) => line.length <= 32)).toBe(true)
  })

  it('opens the drawer on its own for No sale', () => {
    expect(Array.from(drawerKickBytes())).toEqual([...COMMANDS.init, ...COMMANDS.kickPin2])
  })

  it('hides the expected cash on a staff X reading but shows the count once closed', () => {
    const shift = { cashier: { name: 'Akosua' }, openedAt: sale.at, float: 10000, cashSales: 65000, sales: 1, cashRefunds: 0, moves: [{ kind: 'out', amount: 2000, reason: 'Rider' }], status: 'open' }
    const blind = toText(drawerReportOps({ shift, title: 'X READING', at: sale.at, showExpected: false }))
    expect(blind).not.toContain('Cash expected')
    expect(toText(drawerReportOps({ shift, title: 'X READING', at: sale.at, showExpected: true }))).toContain('GHS 730.00')
    const closed = toText(drawerReportOps({ shift: { ...shift, status: 'closed', closedAt: sale.at, expected: 73000, counted: 72000, difference: -1000, note: 'Wrong change' }, title: 'DRAWER CLOSED', at: sale.at }))
    expect(closed).toContain('Short')
    expect(closed).toContain('Wrong change')
  })

  it('prints a Z report from the day summary', () => {
    const summary = summarizeDay([sale, { ...sale, number: 43, status: 'voided' }], [{ id: 'a', cashier: { name: 'Akosua' }, openedAt: 1, status: 'closed', expected: 75000, counted: 75000, difference: 0 }])
    expect(summary).toMatchObject({ count: 1, gross: 65000, net: 65000, voidedCount: 1, firstSale: 42, lastSale: 43 })
    const text = toText(zReportOps({ shop: {}, report: { ...summary, number: 'Z0007', day: '2026-11-10', closedAt: sale.at, closedBy: { name: 'Ama' } }, at: sale.at }))
    expect(text).toContain('Z REPORT Z0007')
    expect(text).toContain('NET TAKINGS')
  })
})

describe('printer test page', () => {
  it('fits the ruler exactly to the paper width', () => {
    for (const paper of [80, 58]) {
      const width = PAPER_WIDTH[paper]
      const ops = printerTestOps({ shop: { legalName: 'SkinMatrix' }, printer: 'POS-80', paper, by: 'Ama', at: Date.UTC(2026, 10, 10, 9) })
      const lines = toText(ops, width).split('\n')
      expect(lines).toContain(Array.from({ length: width }, (_, index) => String((index + 1) % 10)).join(''))
      expect(lines.every((line) => line.length <= width)).toBe(true)
    }
  })
})
