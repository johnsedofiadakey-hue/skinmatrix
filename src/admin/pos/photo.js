// Makes a product photo small enough to upload quickly and load fast on the website: at most 1000 px on the
// longest side, WebP (JPEG where the browser cannot make WebP), on a white background (transparent PNGs too).
const MAX_SIDE = 1000
const LIMIT = 650 * 1024 // the server accepts up to 700 KB

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { /* fall back below */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

const bytesOf = (dataUrl) => Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)

// file (from <input type="file">) → 'data:image/webp;base64,…'
export async function shrinkPhoto(file) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('Choose a photo.')
  const picture = await decode(file).catch(() => { throw new Error('This photo could not be opened. Try another one.') })
  const width = picture.width || picture.naturalWidth
  const height = picture.height || picture.naturalHeight
  let side = MAX_SIDE
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const scale = Math.min(1, side / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(picture, 0, 0, canvas.width, canvas.height)
    let data = canvas.toDataURL('image/webp', 0.82)
    if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', 0.85)
    if (bytesOf(data) <= LIMIT) return data
    side = Math.round(side * 0.75)
  }
  throw new Error('This photo is too large. Try another one.')
}
