// Ghana is UTC+0 with no daylight saving, so the business day is the UTC calendar date.
export const MINUTE = 60 * 1000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export const businessDay = (ms) => new Date(ms).toISOString().slice(0, 10)

export function daysBetween(fromDay, toDay) {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY)
}

export function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
