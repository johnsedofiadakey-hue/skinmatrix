// Problems the till should warn about before they cost the shop a record. Pure: Sell and Home show the list.
import { OFFLINE_MAX_AGE } from '../../../functions/src/core/sale.js'

const DAY = 24 * 60 * 60 * 1000
export const CLOCK_LIMIT = 5 * 60 * 1000 // the server refuses offline sales dated more than 5 minutes ahead
const WARN_AGE = 2 * DAY
const URGENT_AGE = 5 * DAY

const minutes = (ms) => Math.max(1, Math.round(Math.abs(ms) / 60000))
const day = (at) => new Date(at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

// [{ key, tone: 'warn' | 'bad', text }]
export function tillWarnings({ online, offlineSales = [], backup = {}, clockSkew = 0, now = Date.now() }) {
  const list = []

  if (Math.abs(clockSkew) > CLOCK_LIMIT) {
    const ahead = clockSkew > 0
    const size = Math.abs(clockSkew) >= 2 * 60 * 60 * 1000 ? `${Math.round(Math.abs(clockSkew) / 3600000)} hours` : `${minutes(clockSkew)} minutes`
    list.push({ key: 'clock', tone: 'bad', text: `This computer’s clock is ${size} ${ahead ? 'fast' : 'slow'}. Offline sales and receipts take their time from it. Fix it in Windows: Settings → Time & language → Date & time → turn on “Set time automatically”, then Sync now.` })
  }

  const waiting = offlineSales.filter((entry) => entry.status === 'waiting' && Number.isFinite(entry.at))
  if (waiting.length && !online) {
    const oldest = Math.min(...waiting.map((entry) => entry.at))
    const age = now - oldest
    if (age >= WARN_AGE) {
      const days = Math.floor(age / DAY)
      const deadline = oldest + OFFLINE_MAX_AGE
      list.push({
        key: 'age',
        tone: age >= URGENT_AGE ? 'bad' : 'warn',
        text: deadline <= now
          ? `Some unsent sales are more than 7 days old and can no longer be sent automatically. Connect to the internet, then a manager records them from the list of sales waiting to send.`
          : `The oldest unsent sale is ${days} day${days === 1 ? '' : 's'} old. Connect this till to the internet before ${day(deadline)}: sales older than 7 days cannot be sent automatically.`,
      })
    }
  }

  if (backup.available && backup.error && offlineSales.length) list.push({ key: 'backup', tone: 'bad', text: backup.error })

  return list
}
