// This till's hardware: receipt printer, cash drawer and customer display. Settings are per device (each till
// has its own printer), kept in this browser's storage.
//
// Two ways to print:
//  - Desktop till app (desktop/, Electron): it injects window.skinmatrixTill. Receipts go to the printer as
//    ESC/POS bytes with no print window, and the cash drawer (plugged into the printer) can be opened.
//  - Any browser: the receipt prints through the normal print window (or silently with --kiosk-printing).
//    The drawer can then only open if the printer driver is set to open it on every print.
import { useSyncExternalStore } from 'react'
import { drawerKickBytes, encode, PAPER_WIDTH, saleReceiptOps } from './escpos.js'

const KEY = 'skinmatrix-till'
const OLD_AUTO_PRINT = 'skinmatrix-auto-print'

export const DEFAULT_TILL = {
  printer: 'browser', // 'browser' | 'system' (a printer installed on this computer) | 'network' (IP printer, port 9100)
  printerName: '',
  host: '',
  port: 9100,
  paper: 80, // 80 or 58 mm
  autoPrint: false,
  drawer: false, // a cash drawer is plugged into the receipt printer
  kickPin: 2,
  openOnCash: true, // open the drawer after every cash sale and cash refund
  display: true, // show the basket on the customer display
  momoNumber: '', // shown on the customer display when the customer pays by MoMo
  momoName: '',
  displayMessage: 'Welcome. Thank you for choosing SkinMatrix.',
  checks: {}, // Till setup tests that passed: { printer: { at, key }, drawer, display }
}

let cache = null
const listeners = new Set()

function load() {
  let stored = {}
  try { stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch { stored = {} }
  let legacyAutoPrint = false
  try { legacyAutoPrint = localStorage.getItem(OLD_AUTO_PRINT) === 'on' } catch { legacyAutoPrint = false }
  return { ...DEFAULT_TILL, autoPrint: legacyAutoPrint, ...stored }
}

export function getTill() {
  if (!cache) cache = load()
  return cache
}

export function setTill(patch) {
  cache = { ...getTill(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(cache)) } catch { /* private window: kept for this visit only */ }
  for (const listener of listeners) listener()
}

const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
export const useTill = () => useSyncExternalStore(subscribe, getTill)

// ── Desktop till app ──
export const bridge = () => (typeof window !== 'undefined' ? window.skinmatrixTill || null : null)
export const hasDesktopApp = () => Boolean(bridge())

// True when receipts go straight to the printer (no print window) and the drawer can be opened by the app.
export function directPrinting(till = getTill()) {
  if (!hasDesktopApp()) return false
  if (till.printer === 'system') return Boolean(till.printerName)
  if (till.printer === 'network') return Boolean(till.host)
  return false
}

const target = (till) => (till.printer === 'network' ? { type: 'network', host: till.host, port: Number(till.port) || 9100 } : { type: 'system', name: till.printerName })

async function sendBytes(data, till = getTill()) {
  if (!directPrinting(till)) throw new Error('Direct printing is not set up on this till. Open Till setup.')
  await bridge().printRaw({ printer: target(till), data: Array.from(data) })
}

// Prints any slip described as ESC/POS ops (receipts, X and Z reports, No sale). Returns 'direct' or 'browser'.
// For the browser the caller shows the slip in a PrintArea and calls printNow().
export async function printOps(ops, { kick = false } = {}) {
  const till = getTill()
  if (!directPrinting(till)) return 'browser'
  await sendBytes(encode(ops, { width: PAPER_WIDTH[till.paper] || 48, kick: kick && till.drawer, kickPin: till.kickPin }), till)
  return 'direct'
}

export const printSale = (sale, shop, { reprint = false, kick = false } = {}) => printOps(saleReceiptOps(sale, shop, { reprint }), { kick })

// Should this sale or refund open the drawer? Only cash, and only when the till has a drawer set up to open by itself.
export const kickForCash = (method) => {
  const till = getTill()
  return method === 'cash' && till.drawer && till.openOnCash && directPrinting(till)
}

// Opens the cash drawer. Returns false when this till cannot open it (no desktop app or no drawer set up).
export async function openDrawer() {
  const till = getTill()
  if (!till.drawer || !directPrinting(till)) return false
  await sendBytes(drawerKickBytes(till.kickPin), till)
  return true
}

export const canOpenDrawer = (till = getTill()) => till.drawer && directPrinting(till)

// Error text from the desktop app that a cashier can act on.
export const printerProblem = (error) => String(error?.message || error || 'The printer did not answer.')
  .replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
