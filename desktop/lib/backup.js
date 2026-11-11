// A second copy, on this computer's disk, of the sales made while the till has no internet.
//
// The shop system keeps offline sales in the app's own storage (src/admin/live/offlineSales.js). That copy can be
// lost if the app's data is cleared or Windows is reinstalled, so this file also writes:
//  - unsent-<staff id>.json: the sales still waiting to be sent, rewritten (safely) after every change. If the app's
//    own copy disappears, the till puts these back and sends them. Sending one twice is harmless (each has its id).
//  - offline-sales-YYYY-MM.csv: a running log (opens in Excel) of every offline sale: made, sent, refused, removed.
//    It is never rewritten, only added to, so it is a paper trail even after the sales reach the server.
// Both go to Documents\SkinMatrix Till Backups, and also to a second folder (a USB stick, OneDrive…) if one is set.
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const FOLDER_NAME = 'SkinMatrix Till Backups'
const STAFF_ID = /^[A-Za-z0-9_-]{1,128}$/
const MAX_BYTES = 8 * 1024 * 1024
const EVENTS = new Set(['made', 'sent', 'problem', 'removed', 'restored'])
const CSV_HEAD = ['Time (GMT)', 'What happened', 'Offline number', 'Sale number', 'Cashier', 'Items', 'Total (GHS)', 'Paid by', 'Note']

class BackupError extends Error {}

const defaultFolder = (documents) => path.join(documents, FOLDER_NAME)

function checkStaffId(uid) {
  if (typeof uid !== 'string' || !STAFF_ID.test(uid)) throw new BackupError('Unknown staff member.')
  return uid
}

// Writes a whole file so that a power cut leaves either the old file or the new one, never half of each.
function writeWhole(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  const handle = fs.openSync(temp, 'w')
  try {
    fs.writeSync(handle, text)
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
  // Windows can briefly refuse to replace a file an antivirus is scanning: try a few times, then write in place.
  for (let attempt = 0; ; attempt += 1) {
    try { fs.renameSync(temp, file); return } catch (error) {
      if (attempt < 4 && ['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) { const until = Date.now() + 50; while (Date.now() < until) { /* wait */ } continue }
      fs.writeFileSync(file, text)
      try { fs.unlinkSync(temp) } catch { /* already gone */ }
      return
    }
  }
}

function appendDurable(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const fresh = !fs.existsSync(file)
  const handle = fs.openSync(file, 'a')
  try {
    // The byte-order mark makes Excel read the file as UTF-8 (names with accents, the cedi sign…).
    if (fresh) fs.writeSync(handle, `﻿${csvLine(CSV_HEAD)}`)
    fs.writeSync(handle, text)
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
}

// Does the work in every folder. Ok if at least one copy was written; says which folders failed.
function eachFolder(folders, work) {
  const failed = []
  let written = 0
  for (const folder of folders) {
    try { work(folder); written += 1 } catch (error) { failed.push({ folder, reason: error.code || error.message }) }
  }
  if (!written) throw new BackupError(`The backup could not be saved (${failed.map((item) => item.reason).join(', ')}). Check the computer's disk has free space.`)
  return { ok: true, savedAt: Date.now(), folders: folders.filter((folder) => !failed.some((item) => item.folder === folder)), failed }
}

// The list of unsent sales for one staff member. An empty list is written too, so sent sales are not put back.
function saveUnsent(folders, { uid, name, sales, pending }) {
  checkStaffId(uid)
  if (!Array.isArray(sales) || !Array.isArray(pending)) throw new BackupError('Nothing to back up.')
  const text = `${JSON.stringify({ kind: 'skinmatrix-unsent', version: 1, uid, name: String(name || '').slice(0, 80), savedAt: new Date().toISOString(), sales, pending }, null, 1)}\n`
  if (Buffer.byteLength(text) > MAX_BYTES) throw new BackupError('Too many offline sales to back up. Connect the till to the internet.')
  return eachFolder(folders, (folder) => writeWhole(path.join(folder, `unsent-${uid}.json`), text))
}

// The newest readable copy of a staff member's unsent sales, from any of the folders. null if there is none.
function readUnsent(folders, uid) {
  checkStaffId(uid)
  let best = null
  for (const folder of folders) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(folder, `unsent-${uid}.json`), 'utf8'))
      if (data?.kind !== 'skinmatrix-unsent' || data.uid !== uid || !Array.isArray(data.sales)) continue
      if (!best || String(data.savedAt) > String(best.savedAt)) best = { savedAt: data.savedAt, sales: data.sales, pending: Array.isArray(data.pending) ? data.pending : [] }
    } catch { /* missing or damaged: try the next folder */ }
  }
  return best
}

// A cell as text Excel will not run as a formula.
function cell(value) {
  let text = value === null || value === undefined ? '' : String(value)
  text = text.replace(/[\r\n]+/g, ' ').slice(0, 2000)
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`
  return /[",;]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text
}
const csvLine = (cells) => `${cells.map(cell).join(',')}\r\n`

function logRow(row) {
  if (!row || !EVENTS.has(row.event)) throw new BackupError('Unknown log entry.')
  const at = Number.isFinite(row.at) ? new Date(row.at) : new Date()
  const total = Number.isSafeInteger(row.total) ? (row.total / 100).toFixed(2) : ''
  return { at, line: csvLine([at.toISOString().replace('T', ' ').slice(0, 19), row.event, row.localNumber, row.saleNumber, row.cashier, row.items, total, row.payment, row.note]) }
}

// Adds lines to this month's log. rows: [{ event, at, localNumber, saleNumber, cashier, items, total (pesewas), payment, note }]
function appendLog(folders, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw new BackupError('Nothing to log.')
  const byMonth = new Map()
  for (const row of rows) {
    const { at, line } = logRow(row)
    const month = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`
    byMonth.set(month, (byMonth.get(month) || '') + line)
  }
  return eachFolder(folders, (folder) => {
    for (const [month, text] of byMonth) appendDurable(path.join(folder, `offline-sales-${month}.csv`), text)
  })
}

module.exports = { FOLDER_NAME, BackupError, defaultFolder, saveUnsent, readUnsent, appendLog, csvLine }
