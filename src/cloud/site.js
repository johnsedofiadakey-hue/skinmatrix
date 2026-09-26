// Website content: the defaults shipped with the site, and how saved edits (Firestore `site/content` and
// `site/catalog`) are merged over them. Pure functions, shared by the website and the admin editor.

export const CATEGORIES = ['Supplements', 'Skincare']

// Shop details. Empty values show as a [placeholder] on the website until the owner fills them in.
export const SHOP_FIELDS = [
  { key: 'legalName', label: 'Registered business name' },
  { key: 'phone', label: 'Shop phone number' },
  { key: 'whatsapp', label: 'WhatsApp number' },
  { key: 'email', label: 'Shop email' },
  { key: 'address', label: 'Shop address' },
  { key: 'hours', label: 'Opening hours' },
  { key: 'deliveryAreas', label: 'Areas we deliver to' },
  { key: 'deliveryTime', label: 'Delivery time' },
  { key: 'returnDays', label: 'Days to return an item' },
  { key: 'refundDays', label: 'Days to send a refund' },
  { key: 'instagram', label: 'Instagram link' },
]

export const DEFAULT_CONTENT = {
  shop: Object.fromEntries(SHOP_FIELDS.map((field) => [field.key, ''])),
  home: {
    heroTitle: 'Your body\nis a',
    heroAccent: 'system.',
    heroText: 'Skincare and supplements from brands you can trust. Choose what you need and we deliver it to you.',
  },
  checkout: {
    deliveryFee: null, // pesewas; null = "we tell you the delivery fee when we call"
    pickup: true,
    paystackPublicKey: '',
  },
  terms: {
    updated: '2026-09-26',
    sections: [
      { title: 'Who we are', body: 'This website is run by {legalName} ("SkinMatrix", "we", "us").\nOur shop is at {address}.\nYou can reach us on {phone} or {email}.' },
      { title: 'Using this website', body: 'By using this website or placing an order, you agree to these terms.\nPlease give us true and complete details when you order.' },
      { title: 'Our products and your health', body: 'Supplements are not medicine. They do not treat, cure or prevent any disease.\nTalk to a doctor or pharmacist before you use a supplement if you are pregnant, breastfeeding, taking medicine, or have a health problem.\nBefore you use a new skincare product, try a little on a small area of skin first. Stop using it if your skin reacts.\nAlways read the label and follow the directions.' },
      { title: 'Prices and payment', body: 'All prices are in Ghana cedis (GHS).\nPrices can change, but the price you pay is the price shown when you placed your order.\nWe take payment online through Paystack (card or mobile money). We never see or keep your card details.' },
      { title: 'Your order', body: 'After you order, we contact you to confirm it.\nIf an item is out of stock or a price was wrong, we tell you. You can then change or cancel your order, and we give back any money you paid.' },
      { title: 'Delivery and pickup', body: 'We deliver to: {deliveryAreas}.\nDelivery usually takes {deliveryTime}. The delivery fee is shown at checkout, or we tell you when we call.\nYou can also pick up your order at our shop ({hours}).\nPlease check your order when you receive it and tell us straight away if something is wrong.' },
      { title: 'Returns and refunds', body: 'You can return an item within {returnDays} days if it is unopened and still sealed.\nFor health and safety reasons, we cannot take back opened items, unless they arrived damaged or we sent the wrong item.\nIf we accept a return, we refund you within {refundDays} days, using the same way you paid.' },
      { title: 'Your personal information', body: 'We only use your name, phone number, email and address to handle your order and contact you about it.\nWe keep your information safe and we do not sell it. We follow the Data Protection Act, 2012 (Act 843).\nTo see, change or delete your information, contact us.' },
      { title: 'Changes to these terms', body: 'We may update these terms. The date at the top shows the last change. The terms that apply to your order are the ones shown when you placed it.' },
      { title: 'Law', body: 'These terms follow the laws of Ghana.' },
    ],
  },
}

export const DEFAULT_PRODUCTS = [
  { id: 'neocell-collagen', name: 'Collagen Beauty Builder', brand: 'NeoCell', category: 'Supplements', type: 'For skin, hair and nails', description: 'Collagen with vitamin C, biotin and A.L.A.', size: '150 tablets', price: null, image: '/assets/products/neocell-collagen-beauty-builder.png', visible: true, inStock: true },
  { id: 'now-magnesium', name: 'Magnesium Glycinate', brand: 'NOW', category: 'Supplements', type: 'For sleep and energy', description: 'Magnesium that is gentle on the stomach.', size: '180 tablets', price: null, image: '/assets/products/now-magnesium-glycinate.png', visible: true, inStock: true },
  { id: 'vitabiotics-wellwoman-50', name: 'Wellwoman 50+', brand: 'Vitabiotics', category: 'Supplements', type: 'For women over 50', description: '26 vitamins and minerals for women over 50.', size: '30 tablets', price: null, image: '/assets/products/wellwoman-50-plus.png', visible: true, inStock: true },
  { id: 'anua-niacinamide', name: 'Niacinamide 10 + TXA 4 Serum', brand: 'Anua', category: 'Skincare', type: 'For dark spots and even skin', description: 'A serum for dark spots and uneven skin tone.', size: '30 ml', price: null, image: '/assets/products/anua-niacinamide-10-txa-4.png', visible: true, inStock: true },
]

// Pictures already on the website, offered in the product editor.
export const PRODUCT_IMAGES = DEFAULT_PRODUCTS.map((product) => ({ label: `${product.brand} ${product.name}`, src: product.image }))

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function mergeContent(saved) {
  const next = structuredClone(DEFAULT_CONTENT)
  if (!isPlainObject(saved)) return next
  for (const part of ['shop', 'home', 'checkout']) {
    if (isPlainObject(saved[part])) Object.assign(next[part], saved[part])
  }
  if (isPlainObject(saved.terms)) {
    if (typeof saved.terms.updated === 'string') next.terms.updated = saved.terms.updated
    if (Array.isArray(saved.terms.sections)) next.terms.sections = saved.terms.sections.filter((section) => section && typeof section.title === 'string' && typeof section.body === 'string')
  }
  return next
}

export function cleanProduct(product, index = 0) {
  const price = Number.isInteger(product?.price) && product.price > 0 ? product.price : null
  return {
    id: String(product?.id || `product-${index + 1}`),
    name: String(product?.name || 'Untitled product'),
    brand: String(product?.brand || ''),
    category: CATEGORIES.includes(product?.category) ? product.category : CATEGORIES[0],
    type: String(product?.type || ''),
    description: String(product?.description || ''),
    size: String(product?.size || ''),
    price,
    image: String(product?.image || ''),
    visible: product?.visible !== false,
    inStock: product?.inStock !== false,
  }
}

export function mergeCatalog(saved) {
  const list = Array.isArray(saved?.products) ? saved.products : DEFAULT_PRODUCTS
  return list.map(cleanProduct)
}

// A product can go in the cart only when it is shown, in stock and has a price.
export const canBuy = (product) => Boolean(product?.visible && product.inStock && product.price)

// "{phone}" -> the shop's phone, or "[Shop phone number]" until it is filled in.
export function fillShopDetails(text, shop) {
  return String(text).replace(/\{(\w+)\}/g, (match, key) => {
    const field = SHOP_FIELDS.find((item) => item.key === key)
    if (!field) return match
    const value = String(shop?.[key] || '').trim()
    return value || `[${field.label}]`
  })
}

export function formatGhs(pesewas) {
  if (!Number.isInteger(pesewas)) return ''
  return `GHS ${(pesewas / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// "120" or "120.50" -> 12050 pesewas; anything else -> null.
export function parseGhs(text) {
  const clean = String(text ?? '').replace(/[,\s]/g, '').replace(/^GHS/i, '')
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null
  const [whole, fraction = ''] = clean.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

// Problems that stop the admin editor from saving, in plain words.
export function checkSiteEdits(content, products) {
  const problems = []
  const key = String(content.checkout.paystackPublicKey || '').trim()
  if (key.startsWith('sk_')) problems.push('That is the Paystack SECRET key. Never paste it here. Use the public key (starts with pk_).')
  else if (key && !/^pk_(live|test)_[A-Za-z0-9]+$/.test(key)) problems.push('The Paystack public key should start with pk_live_ or pk_test_.')
  const ids = new Set()
  for (const product of products) {
    if (!String(product.name).trim()) problems.push('Every product needs a name.')
    if (ids.has(product.id)) problems.push(`Two products share the ID "${product.id}".`)
    ids.add(product.id)
  }
  if (content.terms.sections.some((section) => !section.title.trim())) problems.push('Every terms section needs a title.')
  return problems
}
