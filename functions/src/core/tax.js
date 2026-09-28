import { RuleError } from './rules.js'

// Ghana taxes on a receipt, for when the shop is VAT-registered. Shelf prices already include the taxes, so
// the receipt shows how the total splits. Rates are in basis points (1500 = 15%) and the owner can change
// them in Settings. The defaults follow the 2026 regime (VAT 15%, NHIL 2.5%, GETFund 2.5%, all on the same
// base, no COVID-19 levy). Check them with your accountant or GRA before turning this on.
export const DEFAULT_TAX = { registered: false, tin: '', vatBp: 1500, nhilBp: 250, getfundBp: 250 }

const MAX_BP = 5000

export function cleanTax(input) {
  const tax = { ...DEFAULT_TAX, ...(input || {}) }
  const registered = tax.registered === true
  const tin = String(tax.tin ?? '').trim().toUpperCase()
  if (registered && !/^[A-Z0-9-]{8,20}$/.test(tin)) throw new RuleError('bad_tin', 'Type the shop’s TIN (Ghana Card number or GRA TIN) as it appears on your VAT certificate.')
  for (const key of ['vatBp', 'nhilBp', 'getfundBp']) {
    if (!Number.isInteger(tax[key]) || tax[key] < 0 || tax[key] > MAX_BP) throw new RuleError('bad_rate', 'Tax rates must be between 0% and 50%.')
  }
  return { registered, tin, vatBp: tax.vatBp, nhilBp: tax.nhilBp, getfundBp: tax.getfundBp }
}

// Splits a tax-inclusive total (pesewas) into the net price and each tax. The parts always add up to the total:
// rounding differences go into VAT. Returns null when the shop is not VAT-registered.
export function taxBreakdown(total, tax) {
  if (!tax?.registered || !Number.isInteger(total) || total <= 0) return null
  const rates = tax.vatBp + tax.nhilBp + tax.getfundBp
  const net = Math.round((total * 10000) / (10000 + rates))
  const nhil = Math.round((net * tax.nhilBp) / 10000)
  const getfund = Math.round((net * tax.getfundBp) / 10000)
  const vat = total - net - nhil - getfund
  return { tin: tax.tin, vatBp: tax.vatBp, nhilBp: tax.nhilBp, getfundBp: tax.getfundBp, net, vat, nhil, getfund }
}

export const percentLabel = (bp) => `${(bp / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`
