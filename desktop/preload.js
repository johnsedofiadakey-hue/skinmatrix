// The only bridge between the shop system page and this computer. Sandboxed: the page gets these few functions,
// nothing else. main.js checks every call comes from the shop system itself.
'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('skinmatrixTill', Object.freeze({
  info: () => ipcRenderer.invoke('till:info'),
  listPrinters: () => ipcRenderer.invoke('till:listPrinters'),
  // job: { printer: { type: 'system', name } | { type: 'network', host, port }, data: number[] (ESC/POS bytes) }
  printRaw: (job) => ipcRenderer.invoke('till:printRaw', job),
  // options: { preview: true } opens it as a window on this screen when there is no second monitor.
  openCustomerDisplay: (options) => ipcRenderer.invoke('till:openDisplay', { preview: options?.preview === true }),
  closeCustomerDisplay: () => ipcRenderer.invoke('till:closeDisplay'),
  // The monitors, which one is the till and which the customer's; choosing one; showing their numbers.
  listScreens: () => ipcRenderer.invoke('till:screens'),
  chooseCustomerScreen: (id) => ipcRenderer.invoke('till:chooseCustomerScreen', id === null ? null : String(id)),
  identifyScreens: () => ipcRenderer.invoke('till:identifyScreens'),
  swapScreens: () => ipcRenderer.invoke('till:swapScreens'),
  // A copy of the offline sales on this computer's disk (desktop/lib/backup.js).
  backupUnsent: (data) => ipcRenderer.invoke('till:backupUnsent', data),
  readUnsent: (uid) => ipcRenderer.invoke('till:readUnsent', String(uid || '')),
  logOffline: (rows) => ipcRenderer.invoke('till:logOffline', rows),
  backupInfo: () => ipcRenderer.invoke('till:backupInfo'),
  openBackupFolder: () => ipcRenderer.invoke('till:openBackupFolder'),
  chooseBackupFolder: (clear) => ipcRenderer.invoke('till:chooseBackupFolder', clear === null ? null : undefined),
  // Updates of this app (desktop/lib/updates.js). setBusy(true) while a sale is on screen: no restart then.
  checkUpdate: () => ipcRenderer.invoke('till:checkUpdate'),
  updateStatus: () => ipcRenderer.invoke('till:updateStatus'),
  updateNow: () => ipcRenderer.invoke('till:updateNow'),
  installUpdate: () => ipcRenderer.invoke('till:installUpdate'),
  setBusy: (busy) => ipcRenderer.invoke('till:setBusy', busy === true),
}))
