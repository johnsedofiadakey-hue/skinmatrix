// Sales put on hold at this till ("Hold" on the POS): a customer goes to fetch something and the next one is
// served. Kept on this computer only (they are not sales yet), so they survive a reload or no internet.
import { useSyncExternalStore } from 'react'

const KEY = 'skinmatrix-held-sales'
const MAX = 20
const listeners = new Set()
let cache = null

function read() {
  try { const list = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(list) ? list : [] } catch { return [] }
}

function write(list) {
  cache = list
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* storage blocked: kept until reload */ }
  for (const listener of listeners) listener()
}

export const getHeld = () => { if (!cache) cache = read(); return cache }

// entry: { id, at, by, cart: [{ productId, quantity }], discount, customer }
export function holdSale(entry) {
  const list = [entry, ...getHeld().filter((item) => item.id !== entry.id)].slice(0, MAX)
  write(list)
  return list.length
}

export function takeHeld(id) {
  const entry = getHeld().find((item) => item.id === id) || null
  write(getHeld().filter((item) => item.id !== id))
  return entry
}

export const dropHeld = (id) => write(getHeld().filter((item) => item.id !== id))

const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
export const useHeld = () => useSyncExternalStore(subscribe, getHeld)
