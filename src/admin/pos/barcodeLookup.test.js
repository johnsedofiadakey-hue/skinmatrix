import { describe, expect, it } from 'vitest'
import { isRetailBarcode, lookupBarcode } from './barcodeLookup.js'

const reply = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) })

describe('lookupBarcode', () => {
  it('only looks up retail barcodes', async () => {
    expect(isRetailBarcode('3337875597197')).toBe(true)
    expect(isRetailBarcode('SM-1')).toBe(false)
    expect(isRetailBarcode('123')).toBe(false)
    let called = false
    expect(await lookupBarcode('SM-1', { fetcher: () => { called = true; return reply({}) } })).toBeNull()
    expect(called).toBe(false)
  })

  it('prefers the English name and the first brand', async () => {
    const found = await lookupBarcode('3337875597197', { fetcher: () => reply({ status: 1, product: { product_name: 'Schuimende Reinigingsgel', product_name_en: 'Foaming Cleanser', brands: 'CeraVe, L’Oréal', quantity: '236ml' } }) })
    expect(found).toEqual({ name: 'Foaming Cleanser', brand: 'CeraVe', size: '236ml', source: 'Open Beauty Facts' })
  })

  it('tries the second database when the first does not know it, and gives up quietly', async () => {
    const urls = []
    const found = await lookupBarcode('5000158062528', { fetcher: (url) => { urls.push(url); return urls.length === 1 ? reply({ status: 0 }) : reply({ status: 1, product: { product_name: 'Vitamin D3', brands: 'NOW' } }) } })
    expect(urls[1]).toContain('openfoodfacts')
    expect(found).toMatchObject({ name: 'Vitamin D3', brand: 'NOW', source: 'Open Food Facts' })
    expect(await lookupBarcode('5000158062528', { fetcher: () => Promise.reject(new Error('offline')) })).toBeNull()
  })
})
