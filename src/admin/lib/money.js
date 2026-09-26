// All money in the operations system is integer pesewas (1 GHS = 100 pesewas).
// Values are only turned into cedi strings at the UI edge, never stored as floats or strings.

export function assertPesewas(value) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`Money must be integer pesewas, got ${value}`)
  return value
}

export function formatMoney(pesewas, { signed = false } = {}) {
  assertPesewas(pesewas)
  const negative = pesewas < 0
  const abs = Math.abs(pesewas)
  const cedis = Math.floor(abs / 100).toLocaleString('en-US')
  const minor = String(abs % 100).padStart(2, '0')
  const sign = negative ? '−' : signed && pesewas > 0 ? '+' : ''
  return `${sign}GHS ${cedis}.${minor}`
}

// Parses what a cashier types ("12", "12.5", "1,250.00") into pesewas without floating point.
// Returns null for anything that is not a plain non-negative amount with at most two decimals.
export function parseCedis(input) {
  const text = String(input ?? '').replace(/,/g, '').trim()
  const match = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(text)
  if (!match) return null
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'))
}

export function sumPesewas(list, pick = (value) => value) {
  return list.reduce((total, item) => total + assertPesewas(pick(item)), 0)
}
