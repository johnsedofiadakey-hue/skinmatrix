// SkinMatrix Till: the shop system (https://skinmatrixgh.web.app/admin/) in its own full-screen window, with:
//  - receipts sent straight to the receipt printer as ESC/POS (no print window), USB or network;
//  - the cash drawer opened through the printer;
//  - the customer screen opened full screen on the second monitor, without taking the keyboard from the till
//    (so the barcode scanner keeps typing into the POS).
// The page works offline through its service worker; this app adds only the hardware.
'use strict'
const { app, BrowserWindow, dialog, ipcMain, Menu, powerMonitor, screen, session, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { loadConfig, saveConfig } = require('./lib/config.js')
const { describeScreens, fingerprint, pickScreens } = require('./lib/screens.js')
const { PrintError, printNetwork, systemPrinter, toBuffer } = require('./lib/printing.js')
const { BackupError, appendLog, defaultFolder, readUnsent, saveUnsent } = require('./lib/backup.js')
const { installTask, removeTask } = require('./lib/autostart.js')
const { startUpdates } = require('./lib/updates.js')

const DISPLAY_PATH = '/admin/display.html'
const BACKGROUND = '#f3f3f7'

let config
let appOrigin
let mainWindow = null
let displayWindow = null
let printer = null
let autoStart = { ok: null } // the Windows task that opens the app on wake (lib/autostart.js)
let updates = null // automatic updates (lib/updates.js)
let pageBusy = false // a sale is on the till screen: never restart for an update then

if (!app.requestSingleInstanceLock()) app.quit()

const isAppUrl = (value) => {
  try { return new URL(value).origin === appOrigin } catch { return false }
}

const webPreferences = () => ({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  spellcheck: false,
  backgroundThrottling: false, // the customer screen must keep updating while the till window has focus
})

// Only the shop system's own pages (top frame) may use the hardware.
function guard(handler) {
  return async (event, ...args) => {
    const frame = event.senderFrame
    if (!frame || frame.parent || !isAppUrl(frame.url)) throw new Error('Not allowed.')
    try {
      return await handler(...args)
    } catch (error) {
      if (error instanceof PrintError || error instanceof BackupError) throw new Error(error.message)
      console.error(error)
      throw new Error('The till app could not do this. Try again.')
    }
  }
}

// ── Windows ──

function guardNavigation(contents) {
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    if (url.startsWith('https://')) shell.openExternal(url)
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url) && new URL(url).pathname === DISPLAY_PATH) { openDisplay(); return { action: 'deny' } }
    // WhatsApp receipts, Paystack and other links open in the normal browser.
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const ctrl = input.control || input.meta
    if (input.key === 'F11' && mainWindow && !config.kiosk) { mainWindow.setFullScreen(!mainWindow.isFullScreen()); event.preventDefault() }
    if (input.key === 'F5' || (ctrl && input.key.toLowerCase() === 'r' && !input.shift)) { contents.reload(); event.preventDefault() }
    if (ctrl && input.shift && input.key.toLowerCase() === 'd') { toggleDisplay(); event.preventDefault() }
    if (ctrl && input.shift && input.key.toLowerCase() === 's') { swapScreens(); event.preventDefault() }
    if (ctrl && input.shift && input.key.toLowerCase() === 'i' && !app.isPackaged) contents.openDevTools({ mode: 'detach' })
  })
}

// Which monitor is which (see lib/screens.js): a saved choice, else the (reversed) automatic choice.
function screens() {
  const displays = screen.getAllDisplays()
  return { displays, ...pickScreens(displays, { tillId: config.tillScreen, customerId: config.customerScreen, tillAt: config.tillScreenAt, customerAt: config.customerScreenAt, primaryId: screen.getPrimaryDisplay().id }) }
}

// Saves which monitor is which (by id and by where it sits, see lib/screens.js). null, null = back to automatic.
function saveChoice(till, customer) {
  config = { ...config, ...saveConfig(app.getPath('userData'), {
    tillScreen: till ? till.id : null, customerScreen: customer ? customer.id : null,
    tillScreenAt: fingerprint(till), customerScreenAt: fingerprint(customer),
  }) }
}

const sameDisplay = (win, display) => Boolean(win && display && screen.getDisplayMatching(win.getBounds()).id === display.id)

// Moves a window onto a monitor and fills it (full screen, or kiosk when locked).
function fill(win, display, { kiosk = false, fullscreen = true } = {}) {
  if (!win || win.isDestroyed() || !display) return
  if (sameDisplay(win, display) && (kiosk ? win.isKiosk() : !fullscreen || win.isFullScreen())) return
  if (kiosk) win.setKiosk(false)
  win.setFullScreen(false)
  win.setBounds(display.bounds)
  if (kiosk) win.setKiosk(true)
  else if (fullscreen) win.setFullScreen(true)
}

function createMainWindow() {
  const { till } = screens()
  mainWindow = new BrowserWindow({
    ...(till ? { x: till.bounds.x, y: till.bounds.y, width: Math.min(1366, till.bounds.width), height: Math.min(768, till.bounds.height) } : { width: 1366, height: 768 }),
    minWidth: 360, minHeight: 480,
    show: false, backgroundColor: BACKGROUND, autoHideMenuBar: true, title: 'SkinMatrix Till',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: webPreferences(),
  })
  guardNavigation(mainWindow.webContents)
  mainWindow.once('ready-to-show', () => {
    whilePlacing(() => { if (config.kiosk || config.fullscreen) fill(mainWindow, screens().till, { kiosk: config.kiosk }) })
    mainWindow.show()
  })
  mainWindow.on('moved', () => { if (!placing) rememberPlacement('till') })
  // No internet on the very first start (before the page could be saved for offline use): show a waiting page.
  mainWindow.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !isAppUrl(url)) return
    mainWindow.loadFile(path.join(__dirname, 'offline.html'), { query: { url: config.url } })
  })
  mainWindow.webContents.once('did-finish-load', () => {
    if (config.customerDisplay === 'auto' && screens().customer) openDisplay()
  })
  // If the page crashes or runs out of memory, load it again (sales already finished are saved; see backup.js).
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || !mainWindow || mainWindow.isDestroyed()) return
    console.error('Till page stopped:', details.reason)
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(config.url) }, 1000)
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    displayWindow?.destroy()
    app.quit()
  })
  mainWindow.loadURL(config.url)
}

// The customer screen: a normal window with minimise, maximise and close, opened maximised on the customer's
// monitor. If the shop drags it (or the till) to the other monitor, that is remembered and used from then on.
// After it is clicked or moved, the keyboard goes back to the till so barcode scans keep landing in the POS.
// With one monitor it opens only when asked for (Till setup → Preview) and never covers the till by itself.
function placeOn(win, display) {
  if (!win || win.isDestroyed() || !display) return
  if (win.isMinimized()) win.restore()
  if (!sameDisplay(win, display)) {
    if (win.isFullScreen()) win.setFullScreen(false)
    if (win.isMaximized()) win.unmaximize()
    win.setBounds(display.workArea)
  }
  win.maximize()
}

// The shop moved a window (dragged it, or Windows key + Shift + arrow). Whatever monitor the customer window is
// on becomes the customer screen and the till takes the other one; if the till was moved, the other way round.
let rememberTimer = null
function rememberPlacement(moved) {
  clearTimeout(rememberTimer)
  rememberTimer = setTimeout(() => {
    if (placing || !mainWindow || mainWindow.isDestroyed() || !displayWindow || displayWindow.isDestroyed() || displayWindow.kind !== 'customer') return
    if (displayWindow.isMinimized() || mainWindow.isMinimized()) return
    const displays = screen.getAllDisplays()
    if (displays.length < 2) return
    let customer = screen.getDisplayMatching(displayWindow.getBounds())
    let till = screen.getDisplayMatching(mainWindow.getBounds())
    if (customer.id === till.id) {
      // Both on one monitor: the window that was just moved keeps its place, the other goes to the other monitor.
      const other = displays.find((display) => display.id !== customer.id)
      if (moved === 'till') customer = other
      else till = other
    }
    const picked = screens()
    if (picked.till?.id === till.id && picked.customer?.id === customer.id && config.customerScreen) return
    saveChoice(till, customer)
    relayout()
  }, 800)
}

let placing = false // the app is moving windows itself: not a choice to remember
const whilePlacing = (work) => { placing = true; try { work() } finally { setTimeout(() => { placing = false }, 1200) } }

function createDisplayWindow(target) {
  const preview = !target
  const win = new BrowserWindow({
    ...(target ? target.workArea : { width: 1024, height: 640 }),
    show: false, backgroundColor: BACKGROUND, autoHideMenuBar: true,
    title: preview ? 'Customer screen (preview) · SkinMatrix' : 'SkinMatrix · Customer screen',
    frame: true, minimizable: true, maximizable: true, closable: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: webPreferences(),
  })
  win.kind = preview ? 'preview' : 'customer'
  guardNavigation(win.webContents)
  const url = new URL(DISPLAY_PATH, appOrigin).href
  win.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) setTimeout(() => { if (!win.isDestroyed()) win.loadURL(url) }, 15000)
  })
  win.once('ready-to-show', () => {
    if (target) whilePlacing(() => { placeOn(win, target); win.showInactive() })
    else { win.center(); win.show() }
  })
  // Give the keyboard back to the till a moment after the customer window is used, so scans are never lost.
  let refocus = null
  const backToTill = (delay) => { clearTimeout(refocus); refocus = setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed() && !win.isDestroyed() && win.isFocused()) mainWindow.focus() }, delay) }
  win.on('focus', () => backToTill(5000))
  for (const event of ['moved', 'maximize', 'restore']) win.on(event, () => { if (!placing) { rememberPlacement('customer'); backToTill(700) } })
  win.on('closed', () => { if (displayWindow === win) displayWindow = null })
  win.loadURL(url)
  return win
}

// Returns 'second' (on the customer monitor), 'preview' (a window on this screen) or 'none' (no second monitor).
function openDisplay({ preview = false } = {}) {
  const { customer } = screens()
  const alive = displayWindow && !displayWindow.isDestroyed()
  if (customer) {
    if (alive && displayWindow.kind !== 'customer') displayWindow.destroy()
    if (!displayWindow || displayWindow.isDestroyed()) displayWindow = createDisplayWindow(customer)
    else whilePlacing(() => { placeOn(displayWindow, customer); displayWindow.showInactive() })
    return 'second'
  }
  if (!preview) {
    if (alive && displayWindow.kind === 'customer') displayWindow.destroy()
    return 'none'
  }
  if (!alive) displayWindow = createDisplayWindow(null)
  else displayWindow.show()
  return 'preview'
}

function closeDisplay() {
  if (displayWindow && !displayWindow.isDestroyed()) displayWindow.close()
}

function toggleDisplay() {
  if (displayWindow && !displayWindow.isDestroyed()) closeDisplay()
  else openDisplay({ preview: true })
}

// A monitor was plugged in, unplugged or changed: put each window back on its own screen.
let relayoutTimer = null
function relayout() {
  clearTimeout(relayoutTimer)
  relayoutTimer = setTimeout(() => {
    const { till, customer } = screens()
    if (mainWindow && (config.kiosk || mainWindow.isFullScreen() || config.fullscreen)) whilePlacing(() => fill(mainWindow, till, { kiosk: config.kiosk }))
    const alive = displayWindow && !displayWindow.isDestroyed()
    if (customer && (config.customerDisplay === 'auto' || alive)) openDisplay()
    else if (!customer && alive && displayWindow.kind === 'customer') displayWindow.destroy()
  }, 400)
}

// Shows a big number on every monitor for a few seconds, so the shop can tell which is which in Till setup.
function identifyScreens() {
  const { displays, till, customer } = screens()
  displays.forEach((display, index) => {
    const role = till && display.id === till.id ? 'Till (cashier)' : customer && display.id === customer.id ? 'Customer screen' : ''
    const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-content:center;text-align:center;background:#1d1d50;color:#fff;font:600 28px system-ui,sans-serif"><div style="font-size:180px;line-height:1">${index + 1}</div><div>${role}</div></body>`
    const w = 360
    const h = 300
    const win = new BrowserWindow({
      x: Math.round(display.bounds.x + (display.bounds.width - w) / 2), y: Math.round(display.bounds.y + (display.bounds.height - h) / 2), width: w, height: h,
      frame: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, resizable: false, show: false, backgroundColor: '#1d1d50',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    })
    win.once('ready-to-show', () => win.showInactive())
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    setTimeout(() => { if (!win.isDestroyed()) win.destroy() }, 3500)
  })
}

function screenList() {
  const picked = screens()
  return { screens: describeScreens(picked.displays, picked), how: picked.reason, chosen: Boolean(config.customerScreen) }
}

// Till setup: "This one is the customer screen" (or null to go back to automatic).
function chooseCustomerScreen(id) {
  const displays = screen.getAllDisplays()
  const customer = displays.find((display) => String(display.id) === String(id))
  if (!id || !customer || displays.length < 2) {
    saveChoice(null, null)
  } else {
    const { till } = screens()
    const tillScreen = till && till.id !== customer.id ? till : displays.find((display) => display.id !== customer.id)
    saveChoice(tillScreen, customer)
  }
  relayout()
  return screenList()
}

// "Swap screens": the till goes where the customer view is and the other way round. Saved, so it stays.
function swapScreens() {
  const { till } = screens()
  return till ? chooseCustomerScreen(till.id) : screenList()
}

// ── Hardware, for the shop system page (see preload.js and src/admin/till/device.js) ──

async function installedPrinters() {
  const contents = mainWindow?.webContents
  if (!contents) return []
  return (await contents.getPrintersAsync()).map((item) => ({ name: item.name, displayName: item.displayName || item.name, isDefault: Boolean(item.isDefault) }))
}

ipcMain.handle('till:info', guard(async () => ({ version: app.getVersion(), platform: process.platform, url: config.url, autoStart, update: updates?.state() || { status: 'off' } })))
ipcMain.handle('till:checkUpdate', guard(async () => (updates ? updates.check() : { status: 'off' })))
ipcMain.handle('till:installUpdate', guard(async () => {
  if (pageBusy) throw new BackupError('Finish or hold the sale on screen first.')
  return { ok: Boolean(updates?.install()) }
}))
ipcMain.handle('till:setBusy', guard(async (busy) => { pageBusy = busy === true; return { ok: true } }))
ipcMain.handle('till:listPrinters', guard(installedPrinters))
ipcMain.handle('till:printRaw', guard(async (job) => {
  const data = toBuffer(job?.data)
  const target = job?.printer || {}
  if (target.type === 'network') return printNetwork({ host: String(target.host || ''), port: Number(target.port) || 9100, data }).then(() => ({ ok: true }))
  if (target.type === 'system') {
    const name = String(target.name || '')
    if (!(await installedPrinters()).some((item) => item.name === name)) throw new PrintError(`The printer “${name}” is not installed on this computer. Choose it again in Till setup.`)
    await printer.print(name, data)
    return { ok: true }
  }
  throw new PrintError('Choose the receipt printer in Till setup.')
}))
ipcMain.handle('till:openDisplay', guard(async (options) => ({ screen: openDisplay({ preview: options?.preview === true }) })))
ipcMain.handle('till:closeDisplay', guard(async () => { closeDisplay(); return { ok: true } }))
ipcMain.handle('till:screens', guard(async () => screenList()))
ipcMain.handle('till:chooseCustomerScreen', guard(async (id) => chooseCustomerScreen(id === null ? null : String(id || ''))))
ipcMain.handle('till:swapScreens', guard(async () => swapScreens()))
ipcMain.handle('till:identifyScreens', guard(async () => { identifyScreens(); return { ok: true } }))

// ── Backup of offline sales on this computer's disk (see lib/backup.js) ──

function backupFolders() {
  let main
  try { main = defaultFolder(app.getPath('documents')) } catch { main = path.join(app.getPath('userData'), 'Backups') }
  if (!app.isPackaged && process.env.SKINMATRIX_TILL_BACKUP_DIR) main = path.resolve(process.env.SKINMATRIX_TILL_BACKUP_DIR) // development only
  const second = typeof config.backupFolder === 'string' && config.backupFolder ? path.resolve(config.backupFolder) : null
  return second && second.toLowerCase() !== main.toLowerCase() ? [main, second] : [main]
}
const backupInfo = () => ({ folders: backupFolders(), second: backupFolders()[1] || null })

ipcMain.handle('till:backupUnsent', guard(async (data) => saveUnsent(backupFolders(), data || {})))
ipcMain.handle('till:readUnsent', guard(async (uid) => readUnsent(backupFolders(), uid)))
ipcMain.handle('till:logOffline', guard(async (rows) => appendLog(backupFolders(), rows)))
ipcMain.handle('till:backupInfo', guard(async () => backupInfo()))
ipcMain.handle('till:openBackupFolder', guard(async () => {
  const folder = backupFolders()[0]
  fs.mkdirSync(folder, { recursive: true })
  const problem = await shell.openPath(folder)
  if (problem) throw new BackupError(problem)
  return { ok: true }
}))
// A second folder for the backup (a USB stick, OneDrive…), or clear: null.
ipcMain.handle('till:chooseBackupFolder', guard(async (clear) => {
  if (clear === null) {
    config = { ...config, ...saveConfig(app.getPath('userData'), { backupFolder: null }) }
    return backupInfo()
  }
  const picked = await dialog.showOpenDialog(mainWindow, { title: 'Choose a second folder for the backup', properties: ['openDirectory', 'createDirectory'] })
  if (picked.canceled || !picked.filePaths[0]) return backupInfo()
  const folder = path.join(picked.filePaths[0], 'SkinMatrix Till Backups')
  try {
    fs.mkdirSync(folder, { recursive: true })
    fs.accessSync(folder, fs.constants.W_OK)
  } catch { throw new BackupError('This folder cannot be written to. Choose another one.') }
  config = { ...config, ...saveConfig(app.getPath('userData'), { backupFolder: folder }) }
  return backupInfo()
}))

// ── Start ──

// Brings the till back after the computer wakes (sleep, hibernate), is unlocked, or the app is opened again:
// the till in front, the page reloaded if it died, and both screens put back where they belong.
let wakeTimer
function wakeUp(delay = 0, { mayUpdate = false } = {}) {
  clearTimeout(wakeTimer)
  wakeTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    // Just woke up and no sale on screen: a good moment to finish a downloaded update (the app reopens itself).
    if (mayUpdate && !pageBusy && updates?.installIfReady()) return
    if (mainWindow.webContents.isCrashed()) mainWindow.loadURL(config.url)
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    relayout()
    mainWindow.focus()
  }, delay)
}

app.on('second-instance', () => wakeUp())

// Opens the app by itself at sign-in, on waking from sleep or hibernate, and on unlock (Windows, installed app).
async function setUpAutoStart() {
  if (!app.isPackaged || process.platform !== 'win32') return
  if (config.startOnLogin === false) { await removeTask(); autoStart = { ok: false, off: true }; return }
  const stamp = `${process.execPath}|${app.getVersion()}`
  if (config.autoStartTask === stamp) { autoStart = { ok: true, wake: config.autoStartWake !== false }; return }
  autoStart = await installTask({ exe: process.execPath })
  if (autoStart.ok) config = { ...config, ...saveConfig(app.getPath('userData'), { autoStartTask: stamp, autoStartWake: autoStart.wake }) }
  else console.error('Could not set up opening on wake:', autoStart.error)
}

app.whenReady().then(() => {
  config = loadConfig(app.getPath('userData'))
  appOrigin = new URL(config.url).origin
  printer = systemPrinter({ workDir: path.join(app.getPath('temp'), 'skinmatrix-till') })
  Menu.setApplicationMenu(null)
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: Boolean(config.startOnLogin) })

  // Camera (scanning with a webcam), full screen and window placement for the shop system only.
  const allowed = new Set(['media', 'fullscreen', 'clipboard-sanitized-write', 'window-management'])
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(allowed.has(permission) && isAppUrl(contents.getURL())))

  screen.on('display-added', relayout)
  screen.on('display-removed', relayout)
  screen.on('display-metrics-changed', relayout)
  createMainWindow()

  // Woken from sleep or hibernate, or unlocked: give Windows a moment to bring the monitors and network back.
  powerMonitor.on('resume', () => wakeUp(3000, { mayUpdate: true }))
  powerMonitor.on('unlock-screen', () => wakeUp(1500))
  setUpAutoStart().catch((error) => { autoStart = { ok: false, error: error.message } })
  updates = startUpdates({ app })
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => printer?.stop())
