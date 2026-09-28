// Cloud Functions for the public website (checkout). Firebase loads only when a customer places an order,
// so the pages stay light.
let functions = null

async function getSiteFunctions() {
  if (functions) return functions
  const [{ connectFunctionsEmulator, getFunctions }, { app }] = await Promise.all([import('firebase/functions'), import('./firebase.js')])
  functions = getFunctions(app, 'europe-west2')
  if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS) connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  return functions
}

// Resolves to the function's result. Rejects with an Error whose message the customer can read and whose
// `code` is the server's short code ('out_of_stock', 'bad_details', …) or 'network'.
export async function callSite(name, data) {
  const { httpsCallable } = await import('firebase/functions')
  try {
    const result = await httpsCallable(await getSiteFunctions(), name, { timeout: 30000 })(data)
    return result.data
  } catch (cause) {
    const serverCode = cause?.details?.code
    const internal = !serverCode && cause?.code === 'functions/internal'
    const message = serverCode ? String(cause.message || '').replace(/\s*\[\d{3}\]$/, '')
      : internal ? 'Something went wrong on our side. Please try again in a moment.'
        : 'We could not reach our server. Check your internet and try again.'
    const error = new Error(message)
    error.code = serverCode || (internal ? 'internal' : 'network')
    error.fields = cause?.details?.fields || null
    throw error
  }
}
