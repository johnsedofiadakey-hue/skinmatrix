// Automatic updates of the till app itself, from the shop's own website:
//   https://skinmatrixgh.web.app/till-updates/latest.yml  (+ the installer it names)
// Published by `npm run release` in desktop/ (see package.json), then a hosting deploy.
//
// The new version downloads quietly in the background. It is installed only when nobody can be in the middle of a
// sale: when the computer wakes from sleep or hibernate, when the app is closed, or when someone presses
// "Restart and update" in Till setup. Downloads are checked against the SHA-512 in latest.yml (HTTPS only).
'use strict'

const CHECK_EVERY = 4 * 60 * 60 * 1000
const FIRST_CHECK = 60 * 1000

function startUpdates({ app, log = console }) {
  let state = { status: 'off', version: null, error: null, checkedAt: null }
  if (!app.isPackaged || process.platform !== 'win32') return { state: () => state, check: async () => state, installIfReady: () => false, install: () => false }

  const { autoUpdater } = require('electron-updater')
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = { info: () => {}, warn: (text) => log.warn(text), error: (text) => log.error(text), debug: () => {} }

  state = { ...state, status: 'idle' }
  autoUpdater.on('checking-for-update', () => { state = { ...state, status: state.status === 'ready' ? 'ready' : 'checking', error: null } })
  autoUpdater.on('update-not-available', () => { state = { ...state, status: state.status === 'ready' ? 'ready' : 'current', checkedAt: Date.now() } })
  autoUpdater.on('update-available', (info) => { state = { ...state, status: 'downloading', version: info?.version || null, checkedAt: Date.now() } })
  autoUpdater.on('download-progress', (progress) => { state = { ...state, status: 'downloading', percent: Math.round(progress?.percent || 0) } })
  autoUpdater.on('update-downloaded', (info) => { state = { ...state, status: 'ready', version: info?.version || state.version } })
  // No internet, website down…: try again at the next check. Never stops the till.
  autoUpdater.on('error', (error) => { state = { ...state, status: state.status === 'ready' ? 'ready' : 'error', error: String(error?.message || error).split('\n')[0].slice(0, 200), checkedAt: Date.now() } })

  const check = async () => {
    try { await autoUpdater.checkForUpdates() } catch { /* reported through 'error' */ }
    return state
  }
  setTimeout(check, FIRST_CHECK)
  setInterval(check, CHECK_EVERY)

  const install = () => {
    if (state.status !== 'ready') return false
    // Silent install as this user (no administrator prompt), then the app opens again by itself.
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
    return true
  }
  return { state: () => state, check, install, installIfReady: install }
}

module.exports = { startUpdates }
