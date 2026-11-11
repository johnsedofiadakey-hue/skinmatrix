// Product photos taken or uploaded in the product form. The browser shrinks each photo (about 1000 px, WebP or
// JPEG, typically 50–150 KB) before sending it; the server checks it really is an image and keeps it in Firestore
// (collection `photos`, no client access). The website serves it at /photos/<name> through a hosting rewrite to
// productPhoto, cached by the CDN for a year (a new photo always gets a new name, so a cached one never goes stale).
import { randomBytes } from 'node:crypto'
import { RuleError } from './core/rules.js'
import { requireStaff } from './shared.js'

const MAX_BYTES = 700 * 1024 // well under Firestore's 1 MiB document limit
const NAME = /^[a-f0-9]{24}\.(webp|jpg|png)$/
const TYPES = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' }

// What the bytes actually are (never trust the label the browser put on them).
export function sniffImage(bytes) {
  if (bytes.length > 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes.length > 12 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (bytes.length > 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  return null
}

// data: { image: 'data:image/webp;base64,…' } → { url: '/photos/<name>' }
export async function uploadProductPhoto({ db, uid, now }, data) {
  const staff = await requireStaff(db, uid, 'products')
  const match = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(data?.image || ''))
  if (!match) throw new RuleError('bad_image', 'Choose a photo (JPEG, PNG or WebP).')
  const bytes = Buffer.from(match[1], 'base64')
  const kind = sniffImage(bytes)
  if (!kind) throw new RuleError('bad_image', 'That file is not a photo. Choose a JPEG, PNG or WebP picture.')
  if (bytes.length > MAX_BYTES) throw new RuleError('image_too_big', 'That photo is too big. Try again: it is made smaller automatically.')
  const name = `${randomBytes(12).toString('hex')}.${kind}`
  await db.doc(`photos/${name}`).set({ data: bytes, type: TYPES[kind], size: bytes.length, createdAt: now, createdBy: staff.uid })
  return { url: `/photos/${name}` }
}

// GET /photos/<name> → { status, type, body, cache }
export async function readPhoto({ db }, path) {
  const name = String(path || '').split('/').pop()
  if (!NAME.test(name)) return { status: 404 }
  const snap = await db.doc(`photos/${name}`).get()
  if (!snap.exists) return { status: 404 }
  const { data, type } = snap.data()
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data?.toUint8Array ? data.toUint8Array() : data)
  return { status: 200, type, body, cache: 'public, max-age=31536000, s-maxage=31536000, immutable' }
}
