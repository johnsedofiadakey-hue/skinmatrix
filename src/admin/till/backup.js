// The copy of offline sales on the till computer's disk, through the desktop till app (desktop/lib/backup.js).
// In a plain browser there is no disk copy: these do nothing and say so (available: false).
import { bridge } from './device.js'

export const backupAvailable = () => Boolean(bridge()?.backupUnsent)

const items = (entry) => (Array.isArray(entry.items) && entry.items.length
  ? entry.items.map((item) => `${item.quantity} x ${item.name}`).join('; ')
  : (entry.lines || []).map((line) => `${line.quantity} x ${line.productId}`).join('; '))

// One line of the log (offline-sales-YYYY-MM.csv) about an offline sale.
export function logRow(event, entry, { cashier, saleNumber, note } = {}) {
  return {
    event,
    at: event === 'made' ? entry.at : Date.now(),
    localNumber: entry.localNumber || '',
    saleNumber: saleNumber ? String(saleNumber) : '',
    cashier: cashier || '',
    items: items(entry),
    total: Number.isSafeInteger(entry.clientTotal) ? entry.clientTotal : null,
    payment: entry.payment?.method || '',
    note: note || (event === 'made' ? `made offline at ${new Date(entry.at).toLocaleString()}` : ''),
  }
}

export async function saveUnsentCopy(uid, name, sales, pending) {
  const app = bridge()
  if (!app?.backupUnsent) return null
  return app.backupUnsent({ uid, name, sales, pending })
}

export async function readUnsentCopy(uid) {
  const app = bridge()
  if (!app?.readUnsent) return null
  return app.readUnsent(uid)
}

export async function logOffline(rows) {
  const app = bridge()
  if (!app?.logOffline || !rows.length) return null
  return app.logOffline(rows)
}

export async function backupInfo() {
  const app = bridge()
  return app?.backupInfo ? app.backupInfo() : null
}

export const openBackupFolder = () => bridge()?.openBackupFolder?.()
export const chooseBackupFolder = (clear) => bridge()?.chooseBackupFolder?.(clear)
