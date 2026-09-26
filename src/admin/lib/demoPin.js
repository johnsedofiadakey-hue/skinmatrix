// DEMO ONLY. A non-cryptographic hash so the prototype never keeps PINs in plain text in localStorage.
// Production: PINs are verified by the server (Firebase custom auth / callable function) against a salted,
// slow hash (e.g. scrypt), with attempt limits. Nothing here is secure and it must not be reused.

export function demoPinHash(staffId, pin) {
  let hash = 0x811c9dc5
  for (const char of `skinmatrix-demo:${staffId}:${pin}`) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export const isValidPin = (pin) => /^\d{4,6}$/.test(String(pin || ''))
