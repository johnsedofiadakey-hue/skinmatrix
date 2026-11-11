// "Update now" in Till setup: brings this till fully up to date in one press.
//  1. The shop system itself (this website): if a newer version has been published, the page reloads with it.
//  2. The SkinMatrix Till app (desktop/lib/updates.js): if a newer version is on the website, it downloads,
//     installs and reopens by itself.
import { bridge } from './device.js'

// The built code this page is running, e.g. "/assets/admin-1kaPipFN.js" (a new build has a new name).
const runningScript = () => document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src') || null

// true when the website has a newer shop system than the one on screen. null when it cannot tell (development).
export async function websiteHasUpdate() {
  const current = runningScript()
  if (!current) return null
  const response = await fetch(`/admin/index.html?fresh=${Date.now()}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('Could not reach the website. Check the internet and try again.')
  return !(await response.text()).includes(current)
}

// Loads the newest shop system: refresh the saved offline copy first, so it also works offline afterwards.
export async function reloadWebsite() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration('/admin/')
    await registration?.update()
  } catch { /* the reload below still gets the new pages */ }
  window.location.reload()
}

export const canUpdateApp = () => Boolean(bridge()?.updateNow)

// Progress of the till app's update: { status, version, percent }.
export const appUpdateStatus = () => bridge()?.updateStatus?.() ?? Promise.resolve(null)

// Resolves to { status: 'current' | 'installing' | 'off' }. While 'installing', the app is about to restart.
export const updateApp = () => bridge().updateNow()
