import { describe, expect, it } from 'vitest'
import { ean13Bars, eanCheckDigit, isEan13, isShopBarcode, makeShopBarcode, stickerOps } from './labels.js'
import { encode, toText } from '../till/escpos.js'
import { isValidBarcode } from '../../../functions/src/core/sale.js'

describe('shop barcodes', () => {
  it('computes EAN-13 check digits like the server', () => {
    expect(eanCheckDigit('400638133393')).toBe(1)
    expect(isEan13('4006381333931')).toBe(true)
    expect(isEan13('4006381333932')).toBe(false)
  })

  it('makes unused in-store numbers the server accepts', () => {
    const values = [0.1234567891, 0.1234567891, 0.5]
    const first = makeShopBarcode(new Set(), () => values[0])
    expect(first).toMatch(/^20\d{11}$/)
    expect(isShopBarcode(first)).toBe(true)
    expect(isValidBarcode(first)).toBe(true)
    let call = 0
    const second = makeShopBarcode(new Set([first]), () => values[call++])
    expect(second).not.toBe(first)
  })

  it('draws 95 modules with the guards in place', () => {
    const bars = ean13Bars('4006381333931')
    expect(bars).toHaveLength(95)
    expect(bars.slice(0, 3)).toBe('101')
    expect(bars.slice(45, 50)).toBe('01010')
    expect(bars.slice(-3)).toBe('101')
    // First digit 4 → parity LGLLGG; second digit 0 in set L.
    expect(bars.slice(3, 10)).toBe('0001101')
  })
})

describe('sticker printing', () => {
  const product = { name: 'Shea Body Butter', brand: 'Local', size: '200 g', price: 4500 }

  it('prints the barcode with the EAN-13 command and cuts between copies', () => {
    const ops = stickerOps({ product, barcode: '2012345678903', shop: { legalName: 'SkinMatrix' }, copies: 3 })
    expect(ops.filter((op) => op.cut)).toHaveLength(2)
    const bytes = [...encode(ops)]
    const at = bytes.findIndex((value, index) => value === 0x1d && bytes[index + 1] === 0x6b && bytes[index + 2] === 67)
    expect(at).toBeGreaterThan(-1)
    expect(bytes[at + 3]).toBe(12)
    expect(String.fromCharCode(...bytes.slice(at + 4, at + 16))).toBe('201234567890')
    expect(toText(ops)).toContain('2012345678903')
  })
})
