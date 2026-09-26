// Ghana is UTC+0 with no daylight saving, so the business day is the UTC calendar date.
export function businessDayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

export function sameBusinessDay(a, b) {
  return businessDayKey(a) === businessDayKey(b)
}

export const MINUTE = 60 * 1000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR
