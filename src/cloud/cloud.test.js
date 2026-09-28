import { describe, expect, it } from 'vitest'
import { canBuy, checkSiteEdits, cleanProduct, DEFAULT_CONTENT, DEFAULT_PRODUCTS, fillShopDetails, formatGhs, mergeCatalog, mergeContent, parseGhs } from './site.js'
import { buildOrder, cartLines, checkDetails, newOrderRef, normalizeGhanaPhone, orderTotals, PAYMENT } from './orders.js'
import { addVitabioticsDrafts, importVitabioticsCatalogue, vitabioticsDraft } from './vitabiotics.js'

const priced = [
  cleanProduct({ id: 'a', name: 'Serum', brand: 'Anua', price: 12000, visible: true, inStock: true }),
  cleanProduct({ id: 'b', name: 'Tabs', brand: 'NOW', price: 8550, visible: true, inStock: true }),
  cleanProduct({ id: 'c', name: 'Hidden', price: 5000, visible: false }),
  cleanProduct({ id: 'd', name: 'No price', price: null }),
]

describe('site content', () => {
  it('uses the defaults when nothing is saved, and merges saved edits over them', () => {
    expect(mergeContent(null)).toEqual(DEFAULT_CONTENT)
    const merged = mergeContent({ shop: { phone: '0241234567' }, home: { heroAccent: 'glow.' }, terms: { sections: [{ title: 'A', body: 'B' }, { title: 1 }] } })
    expect(merged.shop.phone).toBe('0241234567')
    expect(merged.shop.email).toBe('')
    expect(merged.home.heroAccent).toBe('glow.')
    expect(merged.home.heroText).toBe(DEFAULT_CONTENT.home.heroText)
    expect(merged.terms.sections).toEqual([{ title: 'A', body: 'B' }])
  })

  it('keeps every homepage audience stage while allowing an owner to replace its image', () => {
    const image = 'https://images.example.test/wellkid.png'
    const merged = mergeContent({ home: { audiencePaths: [{ id: 'Children', image, imageLabel: 'Wellkid' }] } })
    expect(merged.home.audiencePaths).toHaveLength(DEFAULT_CONTENT.home.audiencePaths.length)
    expect(merged.home.audiencePaths.find((path) => path.id === 'Children')).toMatchObject({ image, imageLabel: 'Wellkid', visual: 'children' })
    expect(merged.home.audiencePaths.find((path) => path.id === 'Women').image).toBe(DEFAULT_CONTENT.home.audiencePaths[0].image)
  })

  it('fills shop details into text, with a visible placeholder when missing', () => {
    expect(fillShopDetails('Call {phone} or {email}.', { phone: '024 123 4567' })).toBe('Call 024 123 4567 or [Shop email].')
    expect(fillShopDetails('Keep {unknown}', {})).toBe('Keep {unknown}')
  })

  it('falls back to the default products and cleans saved ones', () => {
    expect(mergeCatalog(null)).toHaveLength(DEFAULT_PRODUCTS.length)
    const [product] = mergeCatalog({ products: [{ name: 'X', price: -5, category: 'Toys' }] })
    expect(product).toMatchObject({ id: 'product-1', price: null, category: 'Supplements', visible: true, inStock: true })
  })

  it('only sells products that are shown, in stock and priced', () => {
    expect(priced.map(canBuy)).toEqual([true, true, false, false])
    expect(DEFAULT_PRODUCTS.some(canBuy)).toBe(false)
  })

  it('keeps a supplier source link on a cleaned product', () => {
    expect(cleanProduct({ id: 'supplier-item', sourceUrl: 'https://supplier.example/item', supplier: 'Vitabiotics' })).toMatchObject({ supplier: 'Vitabiotics', sourceUrl: 'https://supplier.example/item' })
  })

  it('reads and formats cedis as whole pesewas', () => {
    expect(parseGhs('120')).toBe(12000)
    expect(parseGhs('1,250.5')).toBe(125050)
    expect(parseGhs('GHS 85.50')).toBe(8550)
    expect(parseGhs('12.345')).toBeNull()
    expect(parseGhs('abc')).toBeNull()
    expect(formatGhs(125050)).toBe('GHS 1,250.50')
  })
})

describe('Vitabiotics catalogue intake', () => {
  const sourceProduct = {
    title: 'Wellkid Multi-vitamin Liquid', handle: 'wellkid-liquid', product_type: 'Liquid',
    body_html: '<p>Daily support &amp; a great taste.</p>', tags: ['Children', 'Immune'],
    images: [{ src: 'https://cdn.example/wellkid.png' }], variants: [{ title: '150 ml' }],
  }

  it('turns an approved supplier item into a private local draft', () => {
    expect(vitabioticsDraft(sourceProduct)).toMatchObject({
      id: 'vitabiotics-wellkid-liquid', brand: 'Vitabiotics', size: '150 ml',
      description: 'Daily support & a great taste.', image: 'https://cdn.example/wellkid.png',
      sourceUrl: 'https://www.vitabiotics.com/products/wellkid-liquid',
      visible: false, inStock: false, price: null,
    })
    expect(vitabioticsDraft(sourceProduct).audiences).toContain('4–12 years')
    expect(vitabioticsDraft(sourceProduct).needs).toContain('Kids’ wellness')
  })

  it('loads the official catalogue and never overwrites existing work', async () => {
    const fetcher = async () => ({ ok: true, json: async () => ({ products: [sourceProduct] }) })
    const imported = await importVitabioticsCatalogue(fetcher)
    const combined = addVitabioticsDrafts([{ id: 'vitabiotics-wellkid-liquid', name: 'Owner edit' }], imported)
    expect(imported).toHaveLength(1)
    expect(combined).toMatchObject({ added: 0, skipped: 1 })
    expect(combined.products[0].name).toBe('Owner edit')
  })
})

describe('website orders', () => {
  it('accepts Ghana phone numbers in common forms', () => {
    expect(normalizeGhanaPhone('0241234567')).toBe('024 123 4567')
    expect(normalizeGhanaPhone('+233 24 123 4567')).toBe('024 123 4567')
    expect(normalizeGhanaPhone('12345')).toBeNull()
  })

  it('explains what is missing in plain words', () => {
    const errors = checkDetails({ name: 'A', phone: '1', method: 'delivery', address: '' }, { needEmail: true })
    expect(Object.keys(errors).sort()).toEqual(['address', 'email', 'name', 'phone'])
    expect(checkDetails({ name: 'Ama K', phone: '0241234567', method: 'pickup', email: 'ama@example.com' }, { needEmail: true })).toEqual({})
    expect(checkDetails({ name: 'Ama K', phone: '0241234567', method: 'delivery', address: 'East Legon, near the mall' }, { delivery: false }).method).toMatch(/pickup/)
  })

  it('keeps only buyable products, caps quantities and totals in pesewas', () => {
    const lines = cartLines({ a: 2, b: 99, c: 1, d: 1, gone: 3 }, priced)
    expect(lines.map((line) => [line.id, line.qty, line.lineTotal])).toEqual([['a', 2, 24000], ['b', 20, 171000]])
    expect(orderTotals(lines, 'pickup', 2000)).toEqual({ subtotal: 195000, deliveryFee: 0, total: 195000 })
    expect(orderTotals(lines, 'delivery', 2000)).toEqual({ subtotal: 195000, deliveryFee: 2000, total: 197000 })
    expect(orderTotals(lines, 'delivery', null)).toEqual({ subtotal: 195000, deliveryFee: null, total: 195000 })
  })

  it('builds an order record the rules accept', () => {
    const order = buildOrder({
      ref: 'SM-ABC234',
      cart: { a: 1 },
      products: priced,
      details: { name: ' Ama K ', phone: '0241234567', email: '', method: 'pickup', address: 'ignored', notes: 'Call first' },
      checkout: { deliveryFee: 2000 },
      payment: { method: PAYMENT.later, status: 'unpaid', reference: null },
    })
    expect(order).toMatchObject({ ref: 'SM-ABC234', status: 'new', channel: 'website', subtotal: 12000, deliveryFee: 0, total: 12000 })
    expect(order.customer).toEqual({ name: 'Ama K', phone: '024 123 4567', email: '' })
    expect(order.fulfilment).toEqual({ method: 'pickup', address: '', notes: 'Call first' })
  })

  it('keeps the product image with each new website order line', () => {
    const lines = cartLines({ a: 1 }, [{ ...priced[0], image: 'https://images.example/serum.png' }])
    expect(lines[0].image).toBe('https://images.example/serum.png')
  })

  it('makes short, unambiguous order numbers', () => {
    let n = 0
    expect(newOrderRef(() => n++)).toBe('SM-ABCDEF')
    expect(newOrderRef()).toMatch(/^SM-[A-HJ-NP-Z2-9]{6}$/)
  })
})

describe('admin website editor', () => {
  const content = () => mergeContent(null)
  it('refuses a Paystack secret key and odd public keys', () => {
    const c = content()
    c.checkout.paystackPublicKey = 'sk_live_abc123'
    expect(checkSiteEdits(c, DEFAULT_PRODUCTS)[0]).toMatch(/SECRET/)
    c.checkout.paystackPublicKey = 'hello'
    expect(checkSiteEdits(c, DEFAULT_PRODUCTS)[0]).toMatch(/pk_live_/)
    c.checkout.paystackPublicKey = 'pk_test_abc123'
    expect(checkSiteEdits(c, DEFAULT_PRODUCTS)).toEqual([])
  })
  it('needs product names, unique ids and section titles', () => {
    const c = content()
    c.terms.sections = [{ title: ' ', body: 'x' }]
    const problems = checkSiteEdits(c, [cleanProduct({ id: 'a', name: 'A' }), { ...cleanProduct({ id: 'a' }), name: '' }])
    expect(problems).toEqual(expect.arrayContaining(['Every product needs a name.', 'Two products share the ID "a".', 'Every terms section needs a title.']))
  })
})
