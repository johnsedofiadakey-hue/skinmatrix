// The till app's own settings, in till-config.json in the app's data folder
// (Windows: %APPDATA%\SkinMatrix Till). No secrets live here; printer choices are saved by the shop system itself.
'use strict'
const fs = require('node:fs')
const path = require('node:path')

// skinmatrixgh.web.app rather than skinmatrixgh.com: some Ghana mobile networks' DNS has blocked the .com, and the
// till must always reach the shop system. Both are the same Firebase project and data.
const DEFAULT_URL = 'https://skinmatrixgh.web.app/admin/'

const DEFAULTS = {
  url: DEFAULT_URL,
  fullscreen: true, // the till fills the screen (F11 switches)
  kiosk: false, // true locks the till app full screen (staff cannot leave it)
  customerDisplay: 'auto', // 'auto': open on the second screen when one is plugged in; 'off'
  startOnLogin: true, // start with Windows
  tillScreen: null, // monitor ids chosen in Till setup (null: the touch screen is the till, the other is the customer's)
  customerScreen: null,
  backupFolder: null, // a second folder for the offline-sales backup (Documents\SkinMatrix Till Backups is always used)
}

// Saves a few keys back to till-config.json (only the screen choice; the rest is edited by hand if ever).
function saveConfig(dir, patch) {
  const file = path.join(dir, 'till-config.json')
  let stored = {}
  try { stored = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { stored = { ...DEFAULTS } }
  const next = { ...stored, ...patch }
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`) } catch { /* read-only: kept until the app closes */ }
  return next
}

function cleanUrl(value) {
  try {
    const url = new URL(String(value))
    const local = ['localhost', '127.0.0.1'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null
    if (!url.pathname.startsWith('/admin')) url.pathname = '/admin/'
    return url.href
  } catch { return null }
}

function loadConfig(dir, { env = process.env, argv = process.argv } = {}) {
  const file = path.join(dir, 'till-config.json')
  let stored = {}
  try { stored = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { stored = {} }
  const config = { ...DEFAULTS, ...stored }
  if (!fs.existsSync(file)) {
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(DEFAULTS, null, 2)}\n`) } catch { /* read-only: defaults */ }
  }
  // For development: SKINMATRIX_TILL_URL=http://localhost:5182/admin/ or --url=…
  const override = env.SKINMATRIX_TILL_URL || argv.find((arg) => arg.startsWith('--url='))?.slice(6)
  config.url = cleanUrl(override || config.url) || DEFAULT_URL
  return config
}

module.exports = { loadConfig, saveConfig, cleanUrl, DEFAULT_URL, DEFAULTS }
