// Which monitor is the till (the cashier's touch screen) and which is the customer screen.
// Pure logic, so it can be tested without Electron. `displays` are Electron Display objects:
// { id, label, bounds, touchSupport: 'available' | 'unavailable' | 'unknown', internal }.
//
// In order:
//  1. The screens the shop chose in Till setup ("This one is the customer screen"), if both are still plugged in.
//  2. Otherwise the automatic choice, which is REVERSED for the shop's terminal (2026-11-10): on it Windows
//     reports touch on the customer's panel and the cashier's screen is not the "main display", so the plain
//     rule (touch = till, main display = till) put the customer view on the cashier's screen. Now:
//       - one touch screen and one without: the customer view goes on the touch-reporting screen;
//       - no usable touch information: the customer view goes on the main display, the till on the other.
//     If a till ever comes out the wrong way round, "Swap screens" (POS menu, Till setup, Ctrl+Shift+S) saves
//     the opposite choice, and step 1 then wins for good.
// With one monitor (or Windows set to "Duplicate these displays", which looks like one) there is no customer screen.
'use strict'

const isTouch = (display) => display?.touchSupport === 'available'

// Windows can give a monitor a new id after a restart or a reconnect, so a saved choice also keeps where the
// monitor sits and what it is. It is found again by id, else by the same place on the desktop, else by the same
// name and size (only if exactly one monitor matches).
const fingerprint = (display) => (display?.bounds
  ? { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height, label: String(display.label || '') }
  : null)
const samePlace = (display, at) => Boolean(at && display.bounds && display.bounds.x === at.x && display.bounds.y === at.y && display.bounds.width === at.width && display.bounds.height === at.height)
const sameKind = (display, at) => Boolean(at && at.label && String(display.label || '') === at.label && display.bounds?.width === at.width && display.bounds?.height === at.height)
function findSaved(list, id, at) {
  const byId = id === null || id === undefined ? null : list.find((display) => String(display.id) === String(id))
  if (byId) return byId
  const placed = list.find((display) => samePlace(display, at))
  if (placed) return placed
  const kind = list.filter((display) => sameKind(display, at))
  return kind.length === 1 ? kind[0] : null
}
const area = (display) => (display?.bounds ? display.bounds.width * display.bounds.height : 0)

function pickScreens(displays, { tillId = null, customerId = null, tillAt = null, customerAt = null, primaryId = null } = {}) {
  const list = Array.isArray(displays) ? displays.filter(Boolean) : []
  const byId = (id) => list.find((display) => String(display.id) === String(id)) || null
  if (!list.length) return { till: null, customer: null, reason: 'none' }
  if (list.length === 1) return { till: list[0], customer: null, reason: 'one-screen' }

  const chosenTill = findSaved(list, tillId, tillAt)
  const chosenCustomer = findSaved(list, customerId, customerAt)
  if (chosenTill && chosenCustomer && chosenTill.id !== chosenCustomer.id) return { till: chosenTill, customer: chosenCustomer, reason: 'chosen' }

  // Only one of the two was chosen (the other monitor was replaced): keep the chosen one in its role.
  if (chosenCustomer || chosenTill) {
    const till = chosenTill || list.find((display) => display.id !== chosenCustomer.id)
    const customer = (chosenCustomer && chosenCustomer.id !== till.id ? chosenCustomer : null) || list.find((display) => display.id !== till.id)
    return { till, customer, reason: 'chosen' }
  }

  // Automatic (reversed, see above). Never depends on where the till window is now, so moving the windows
  // cannot flip the choice again.
  const touch = list.filter(isTouch)
  const plain = list.filter((display) => !isTouch(display))
  if (touch.length === 1 && plain.length) {
    const customer = touch[0]
    const till = [...plain].sort((a, b) => area(b) - area(a))[0]
    return { till, customer, reason: 'touch' }
  }
  const customer = byId(primaryId) || list[0]
  const till = list.find((display) => display.id !== customer.id)
  return { till, customer, reason: 'guess' }
}

// What Till setup shows for each monitor.
function describeScreens(displays, picked) {
  return (displays || []).map((display, index) => ({
    id: String(display.id),
    number: index + 1,
    name: String(display.label || '').trim() || (display.internal ? 'Built-in screen' : `Screen ${index + 1}`),
    width: display.size?.width || display.bounds?.width || 0,
    height: display.size?.height || display.bounds?.height || 0,
    touch: display.touchSupport === 'available' ? 'yes' : display.touchSupport === 'unavailable' ? 'no' : 'unknown',
    role: picked.till && display.id === picked.till.id ? 'till' : picked.customer && display.id === picked.customer.id ? 'customer' : null,
  }))
}

module.exports = { pickScreens, describeScreens, isTouch, fingerprint }
