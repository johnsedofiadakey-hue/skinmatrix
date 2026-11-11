// Barcode stickers for products that came without a barcode (local products, gift sets, decanted items).
// The shop makes its own EAN-13 numbers starting with 20–29, which GS1 keeps for in-store use, so they can never
// clash with a manufacturer's barcode. They scan like any other barcode.
import { formatMoney } from '../lib/money.js'

export const eanCheckDigit = (twelve) => (10 - ([...twelve].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10)) % 10
export const isEan13 = (code) => /^\d{13}$/.test(String(code || '')) && eanCheckDigit(String(code).slice(0, 12)) === Number(String(code)[12])
export const isShopBarcode = (code) => isEan13(code) && String(code).startsWith('2')

// A new in-store barcode "20…" that no product has yet. random(): a number in [0, 1).
export function makeShopBarcode(taken = new Set(), random = Math.random) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const body = `20${String(Math.floor(random() * 1e10)).padStart(10, '0')}`
    const code = `${body}${eanCheckDigit(body)}`
    if (!taken.has(code)) return code
  }
  throw new Error('Could not make a new barcode. Try again.')
}

// EAN-13 as 95 bars (1 = black): start guard, 6 left digits (L/G sets chosen by the first digit), centre guard,
// 6 right digits (R set), end guard.
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

export function ean13Bars(code) {
  if (!isEan13(code)) throw new Error('Not an EAN-13 barcode.')
  const digits = [...String(code)].map(Number)
  const parity = PARITY[digits[0]]
  const left = digits.slice(1, 7).map((digit, index) => (parity[index] === 'L' ? L : G)[digit]).join('')
  const right = digits.slice(7).map((digit) => R[digit]).join('')
  return `101${left}01010${right}101`
}

// ESC/POS ops for `copies` stickers, cut apart: shop, product, size, price, barcode.
export function stickerOps({ product, barcode, shop, copies = 1 }) {
  const count = Math.max(1, Math.min(100, Number.parseInt(copies, 10) || 1))
  const one = [
    { text: (shop?.legalName || 'SkinMatrix').slice(0, 32), align: 'center', bold: true },
    { text: product.name.slice(0, 64), align: 'center' },
    ...([product.brand, product.size].filter(Boolean).length ? [{ text: [product.brand, product.size].filter(Boolean).join(' · '), align: 'center' }] : []),
    ...(product.price ? [{ text: formatMoney(product.price).replace('−', '-'), align: 'center', big: true, bold: true }] : []),
    { barcode },
  ]
  return Array.from({ length: count }, (_, index) => (index < count - 1 ? [...one, { cut: true }] : one)).flat()
}
