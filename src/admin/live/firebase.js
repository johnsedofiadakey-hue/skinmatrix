// Firebase for the admin: live Firestore listeners and the Cloud Functions that make every change.
// In development, set VITE_USE_EMULATORS=1 to use the local emulators instead of the live project.
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions'
import { app } from '../../cloud/firebase.js'

export const auth = getAuth(app)
export const liveDb = getFirestore(app)
export const functions = getFunctions(app, 'europe-west2')

if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(liveDb, '127.0.0.1', 8080)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}

const callables = new Map()
export function callFunction(name, data) {
  if (!callables.has(name)) callables.set(name, httpsCallable(functions, name, { timeout: 30000 }))
  return callables.get(name)(data).then((result) => result.data)
}

// The server's short error code ('approval_required', 'insufficient_stock', …) and a message staff can read.
export function readError(error) {
  const code = error?.details?.code || String(error?.code || '').replace('functions/', '')
  // The client library adds the HTTP status (" [400]") to server messages; staff don't need it.
  let message = String(error?.message || 'Something went wrong. Please try again.').replace(/\s*\[\d{3}\]$/, '')
  if (code === 'unavailable' || code === 'deadline-exceeded' || !navigator.onLine) message = 'No internet connection. Nothing was saved. Check the connection and try again.'
  if (code === 'internal' && !error?.details) message = 'Something went wrong on the server. Nothing was saved. Please try again.'
  return { code, message, details: error?.details || {} }
}
