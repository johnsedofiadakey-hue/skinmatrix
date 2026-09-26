// Display formatting. Times are shown in Ghana time regardless of the device's zone.
const TIME_ZONE = 'Africa/Accra'

const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' })
const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: 'numeric', month: 'short' })
const fullFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })

export const fmtTime = (ms) => timeFormat.format(ms)
export const fmtDate = (ms) => dateFormat.format(ms)
export const fmtFull = (ms) => fullFormat.format(ms)
export const fmtDayKey = (key) => dayFormat.format(Date.parse(`${key}T00:00:00Z`))

export function fmtWhen(ms, now) {
  const minutes = Math.round((now - ms) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (new Date(ms).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10)) return `Today ${fmtTime(ms)}`
  return `${fmtDate(ms)} ${fmtTime(ms)}`
}

export function fmtCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export const ROLE_LABEL = {
  staff: 'Staff',
  manager: 'Manager',
  owner: 'Owner',
  system: 'System',
}

export const PAYMENT_METHOD = { cash: 'Cash', momo: 'Mobile money', card: 'Card' }

// 'Cash' | 'MoMo · to shop number' | 'MoMo · prompt' | 'Card'
export function paymentLabel(payment, { short = false } = {}) {
  if (payment.method !== 'momo') return PAYMENT_METHOD[payment.method]
  if (payment.mode === 'recorded') return short ? 'MoMo (shop no.)' : 'MoMo · paid to shop number'
  return short ? 'MoMo (prompt)' : 'MoMo · payment prompt'
}

export const EXPIRY_LABEL = { expired: 'Expired', urgent: '≤30 days', soon: '≤90 days', ok: 'OK', none: 'No expiry' }
export const EXPIRY_TONE = { expired: 'red', urgent: 'red', soon: 'amber', ok: 'green', none: 'grey' }

const monthFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short', year: 'numeric' })
const expiryFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
export const fmtExpiry = (iso) => (iso ? expiryFormat.format(Date.parse(`${iso}T00:00:00Z`)) : 'No expiry')
export const fmtExpiryMonth = (iso) => (iso ? monthFormat.format(Date.parse(`${iso}T00:00:00Z`)) : '')

export const PAYMENT_STATE = {
  paid: { label: 'Paid', tone: 'green' },
  part_refunded: { label: 'Part refunded', tone: 'amber' },
  pending: { label: 'Awaiting payment', tone: 'amber' },
  refund_due: { label: 'Refund due', tone: 'red' },
  refunded: { label: 'Refunded', tone: 'grey' },
  cancelled: { label: 'Payment cancelled', tone: 'grey' },
}

export const STATUS_TONE = {
  Draft: 'grey',
  'Awaiting payment': 'amber',
  Paid: 'blue',
  Processing: 'violet',
  Ready: 'teal',
  'Out for delivery': 'violet',
  Fulfilled: 'green',
  Cancelled: 'grey',
}

export function downloadCsv(filename, rows) {
  const escape = (value) => {
    const text = String(value ?? '')
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const blob = new Blob([rows.map((row) => row.map(escape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
