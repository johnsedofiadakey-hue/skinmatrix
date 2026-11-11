// The customer display: a second screen facing the customer that shows the basket, the total and the change.
// The till and the display page talk over a BroadcastChannel. Both are pages of the same site on the same
// computer, so this works with no internet and the display needs no sign-in.
//
// Messages:  display → till  { type: 'hello' }                 (display just opened: send me the current state)
//            till → display  { type: 'state', state }          state: see DisplayState in src/display/Display.jsx
import { useEffect, useRef } from 'react'
import { bridge } from './device.js'

export const DISPLAY_CHANNEL = 'skinmatrix-customer-display'
export const DISPLAY_PATH = '/admin/display.html'

let channel = null
let last = { mode: 'idle' }

function getChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return channel
  channel = new BroadcastChannel(DISPLAY_CHANNEL)
  channel.addEventListener('message', (event) => {
    if (event.data?.type === 'hello') channel.postMessage({ type: 'state', state: last })
  })
  return channel
}

export function publishDisplay(state) {
  last = state
  getChannel()?.postMessage({ type: 'state', state })
}

// Sends the state whenever it changes (compared as JSON, so re-renders with the same basket send nothing).
export function useCustomerDisplay(state, enabled = true) {
  const sent = useRef('')
  const json = JSON.stringify(enabled ? state : { mode: 'idle', idle: state.idle })
  useEffect(() => {
    if (json === sent.current) return
    sent.current = json
    publishDisplay(JSON.parse(json))
  }, [json])
}

// Opens the display. Returns 'second-screen', 'window' (a window the cashier can drag across), 'none' (the till
// app found only one monitor, so nothing opened) or 'blocked' (the browser blocked the pop-up).
// The desktop app puts it full screen on the customer's monitor by itself and never over the till, unless
// { preview: true } asks to see it on this screen.
export async function openCustomerDisplay({ preview = false } = {}) {
  const url = new URL(DISPLAY_PATH, window.location.origin).href
  const app = bridge()
  if (app?.openCustomerDisplay) {
    const result = await app.openCustomerDisplay({ preview })
    return result?.screen === 'second' ? 'second-screen' : result?.screen === 'preview' ? 'window' : 'none'
  }
  let features = 'popup,width=1024,height=768'
  let second = false
  if ('getScreenDetails' in window) {
    try {
      const details = await window.getScreenDetails()
      const other = details.screens.find((screen) => screen !== details.currentScreen)
      if (other) {
        features = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`
        second = true
      }
    } catch { /* permission refused: open a normal window the cashier can drag across */ }
  }
  const opened = window.open(url, 'skinmatrix-customer-display', features)
  if (!opened) return 'blocked'
  return second ? 'second-screen' : 'window'
}

// What to tell the cashier when the customer screen could not go on its own monitor.
export const ONE_SCREEN_HELP = 'Only one screen was found. Check the customer screen is plugged in and switched on, then on Windows press the Windows key + P and choose “Extend”.'

// "Swap screens": the till moves to where the customer view is, and the customer view to the till's monitor.
// The till app remembers it. Works with app 1.1.0 (through chooseCustomerScreen) and 1.2.0+ (swapScreens).
export const canSwapScreens = () => Boolean(bridge()?.listScreens && bridge()?.chooseCustomerScreen)
export async function swapScreens() {
  const app = bridge()
  if (app?.swapScreens) return app.swapScreens()
  const list = await app.listScreens()
  const till = (list.screens || []).find((item) => item.role === 'till')
  if (!till || list.screens.length < 2) return list
  return app.chooseCustomerScreen(till.id)
}

export async function closeCustomerDisplay() {
  const app = bridge()
  if (app?.closeCustomerDisplay) await app.closeCustomerDisplay()
}
