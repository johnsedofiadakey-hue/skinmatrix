// Looks a barcode up in the free public product databases (Open Beauty Facts for skincare, Open Food Facts for
// supplements) to suggest the name, brand and size of a new product. Only the barcode number is sent. Many
// products are not listed: then the person types the details. The suggestion is always shown for checking.
const SOURCES = [
  { base: 'https://world.openbeautyfacts.org', label: 'Open Beauty Facts' },
  { base: 'https://world.openfoodfacts.org', label: 'Open Food Facts' },
]
const WAIT_MS = 3500

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

// Product barcodes are 8 to 14 digits (EAN-8, UPC-A, EAN-13, GTIN-14). Shop codes and others are not looked up.
export const isRetailBarcode = (code) => /^\d{8,14}$/.test(String(code ?? '').trim())

// Resolves to { name, brand, size, source } or null (not listed, not a retail barcode, or no internet).
export async function lookupBarcode(code, { fetcher = fetch } = {}) {
  const digits = String(code ?? '').trim()
  if (!isRetailBarcode(digits)) return null
  for (const source of SOURCES) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WAIT_MS)
    try {
      const response = await fetcher(`${source.base}/api/v2/product/${digits}.json?fields=product_name,product_name_en,brands,quantity`, { signal: controller.signal })
      if (!response.ok) continue
      const data = await response.json()
      const product = data?.status === 1 ? data.product : null
      const name = clean(product?.product_name_en || product?.product_name, 80)
      if (name) return { name, brand: clean(String(product.brands || '').split(',')[0], 40), size: clean(product.quantity, 30), source: source.label }
    } catch { /* not reachable: try the next one */ } finally {
      clearTimeout(timer)
    }
  }
  return null
}
