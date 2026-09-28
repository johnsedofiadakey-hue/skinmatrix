// Website content: the defaults shipped with the site, and how saved edits (Firestore `site/content` and
// `site/catalog`) are merged over them. Pure functions, shared by the website and the admin editor.

export const CATEGORIES = ['Supplements', 'Skincare']

// The shop has a few complementary ways in: product department, the outcome someone wants,
// and the ingredients they recognise. Products can appear in more than one discovery path.
export const SHOP_NEEDS = [
  { id: 'Weight gain', label: 'Weight gain', description: 'A dedicated nutritional-support shelf for healthy weight goals.' },
  { id: 'Weight loss', label: 'Weight loss', description: 'A dedicated wellbeing shelf for weight-management goals.' },
  { id: 'Beauty & glow', label: 'Beauty & glow', description: 'Radiance, texture and everyday skin confidence.' },
  { id: 'Clear skin', label: 'Clear skin', description: 'Tone, marks and breakout-prone skin.' },
  { id: 'Hydration & barrier', label: 'Hydration & barrier', description: 'Comfort and support for dry, sensitive-feeling skin.' },
  { id: 'Hair & nails', label: 'Hair & nails', description: 'Care for stronger-looking hair and nails.' },
  { id: 'Sleep & unwind', label: 'Sleep & unwind', description: 'Evening support for rest and recovery.' },
  { id: 'Energy & vitality', label: 'Energy & vitality', description: 'Daily nutritional support when life is full.' },
  { id: 'Women’s wellness', label: 'Women’s wellness', description: 'Wellbeing support through changing life stages.' },
  { id: 'Healthy ageing', label: 'Healthy ageing', description: 'Thoughtful support for life after 50.' },
  { id: 'Pregnancy & new mums', label: 'Pregnancy & new mums', description: 'A dedicated shelf for conception, pregnancy and postnatal care.' },
  { id: 'Kids’ wellness', label: 'Kids’ wellness', description: 'Everyday wellbeing for babies, children and teens.' },
  { id: 'Immune support', label: 'Immune support', description: 'Everyday support for seasonal wellbeing.' },
  { id: 'Digestion & gut', label: 'Digestion & gut', description: 'Support for your daily digestive routine.' },
  { id: 'Bones & joints', label: 'Bones & joints', description: 'Movement and strength at every stage.' },
  { id: 'Heart & brain', label: 'Heart & brain', description: 'Focused nutritional support for everyday health.' },
]
export const SHOP_GOALS = ['Weight gain', 'Weight loss']

export const SHOP_INGREDIENTS = ['Collagen', 'Magnesium', 'Biotin', 'Vitamin C', 'Hyaluronic acid', 'Niacinamide', 'Ceramides', 'Omega-3']
export const SHOP_AUDIENCES = [
  { id: 'Men', label: 'Men', description: 'Everyday health and vitality.' },
  { id: 'Women', label: 'Women', description: 'Beauty, energy and wellness.' },
  { id: 'Children', label: 'Children', description: 'Choose the right shelf by age.' },
  { id: '6 months–4 years', label: '6 mo–4 yrs', description: 'Early-years essentials.' },
  { id: '4–12 years', label: '4–12 yrs', description: 'Growing-years support.' },
  { id: '13–19 years', label: '13–19 yrs', description: 'Teen wellbeing essentials.' },
]

// The homepage uses these as its initial audience stories. They deliberately live
// in the site document (rather than in the component) so the owner can change a
// supplier image, wording, link or colour without a code release.
export const DEFAULT_AUDIENCE_PATHS = [
  {
    id: 'Women', number: '01', tab: 'Women', eyebrow: 'Women’s wellness',
    title: 'Care that moves', accent: 'with you.',
    description: 'Beauty, energy and everyday wellbeing—thoughtfully chosen for every chapter of womanhood.',
    tags: ['Beauty & glow', 'Energy', 'Healthy ageing'], action: 'Shop women', href: '/shop?for=Women',
    image: '/assets/products/wellwoman-50-plus.png', imageLabel: 'Vitabiotics', tone: 'women', visual: 'product',
  },
  {
    id: 'Men', number: '02', tab: 'Men', eyebrow: 'Men’s vitality',
    title: 'Support for life', accent: 'in motion.',
    description: 'Focused nutrition and skincare for energy, recovery and the routines that keep life moving.',
    tags: ['Energy', 'Everyday health', 'Strength'], action: 'Shop men', href: '/shop?for=Men',
    image: 'https://www.vitabiotics.com/cdn/shop/files/wellman_original_30_front_2D-CTWEL030T24WL1E_resized.png?v=1746718726', imageLabel: 'Wellman', tone: 'men', visual: 'product',
  },
  {
    id: 'Children', number: '03', tab: 'Children', eyebrow: 'Growing years',
    title: 'Small bodies.', accent: 'Big beginnings.',
    description: 'A clear place to find age-appropriate daily support as little ones grow into teenagers.',
    tags: ['6 months–4 years', '4–12 years', '13–19 years'], action: 'Explore the age guide', href: '/shop',
    image: 'https://www.vitabiotics.com/cdn/shop/products/preview-gallery-Wellkid_Multi-vit-Liquid_Bottle__Front__CTWKD150L5WL5E.png?v=1579194911', imageLabel: 'Wellkid', tone: 'children', visual: 'children',
  },
  {
    id: 'Goals', number: '04', tab: 'Goals', eyebrow: 'Wellness goals',
    title: 'Intentional care', accent: 'for your goals.',
    description: 'Find thoughtful support around weight goals and the everyday habits that make a difference.',
    tags: ['Weight gain', 'Weight loss', 'Everyday health'], action: 'Shop by goal', href: '/shop',
    image: '', imageLabel: '', tone: 'goals', visual: 'goals',
  },
]

export const DEFAULT_BRAND_LOGOS = [
  { name: 'CeraVe', image: '/assets/brands/cerave.png' },
  { name: 'Medicube', image: '/assets/brands/medicube.png' },
  { name: 'Anua', image: '/assets/brands/anua.jpg' },
  { name: 'NOW', image: '/assets/brands/now-foods.png' },
  { name: 'Vitabiotics', image: '/assets/brands/vitabiotics.png' },
]

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
    audienceKicker: 'Who we care for',
    audienceTitle: 'More than a shelf.',
    audienceAccent: 'Care for every chapter.',
    audienceText: 'Supplements and skincare for women, men, growing families and the goals you are working towards.',
    audiencePaths: DEFAULT_AUDIENCE_PATHS,
    productArt: '/assets/matrix-products.png',
    editorialImage: '/assets/editorial-portrait.png',
    brandLogos: DEFAULT_BRAND_LOGOS,
    careKicker: 'One ritual, two directions',
    careTitle: 'Care works',
    careAccent: 'in two directions.',
    careText: 'What you take supports the foundations. What you apply supports the surface.',
    supplementsTitle: 'Supplements',
    supplementsText: 'Daily support for skin, hair, rest and the parts of wellbeing you do not always see.',
    supplementsAction: 'Shop supplements',
    skincareTitle: 'Skincare',
    skincareText: 'Thoughtful formulas for marks, tone and the everyday condition of your skin.',
    skincareAction: 'Shop skincare',
    concernKicker: 'Find by need',
    concernTitle: 'What do you',
    concernAccent: 'need help with?',
    concernText: 'Pick a need. We show you what can help.',
    productsKicker: 'Our products',
    productsTitle: 'Shop our',
    productsAccent: 'favourites.',
    productsText: 'Trusted brands, chosen by us.',
    ageKicker: 'For every age',
    ageTitle: 'Different ages.',
    ageAccent: 'Different needs.',
    ageText: 'Your skin changes as you get older. Pick your age to see where to start.',
    brandsKicker: 'The SkinMatrix Edit',
    brandsTitle: 'Brands you can',
    brandsAccent: 'trust.',
    brandsText: 'Real brands, thoughtfully selected for your skin and wellbeing.',
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
      { title: 'Prices and payment', body: 'All prices are in Ghana cedis (GHS).\nPrices can change, but the price you pay is the price shown when you placed your order.\nWe accept secure Paystack payments, including MTN MoMo, Telecel Cash, AirtelTigo Money, cards and bank transfer where available. We never see or keep your card details.' },
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
  { id: 'neocell-collagen', name: 'Collagen Beauty Builder', brand: 'NeoCell', category: 'Supplements', type: 'For skin, hair and nails', description: 'Collagen with vitamin C, biotin and A.L.A.', size: '150 tablets', audiences: ['Women', 'Men'], needs: ['Beauty & glow', 'Hair & nails'], ingredients: ['Collagen', 'Biotin', 'Vitamin C'], price: null, image: '/assets/products/neocell-collagen-beauty-builder.png', visible: true, inStock: true },
  { id: 'now-magnesium', name: 'Magnesium Glycinate', brand: 'NOW', category: 'Supplements', type: 'For sleep and energy', description: 'Magnesium that is gentle on the stomach.', size: '180 tablets', audiences: ['Women', 'Men'], needs: ['Sleep & unwind', 'Energy & vitality'], ingredients: ['Magnesium'], price: null, image: '/assets/products/now-magnesium-glycinate.png', visible: true, inStock: true },
  { id: 'vitabiotics-wellwoman-50', name: 'Wellwoman 50+', brand: 'Vitabiotics', category: 'Supplements', type: 'For women over 50', description: '26 vitamins and minerals for women over 50.', size: '30 tablets', audiences: ['Women'], needs: ['Women’s wellness', 'Healthy ageing', 'Energy & vitality'], ingredients: ['Vitamin C'], price: null, image: '/assets/products/wellwoman-50-plus.png', visible: true, inStock: true },
  { id: 'anua-niacinamide', name: 'Niacinamide 10 + TXA 4 Serum', brand: 'Anua', category: 'Skincare', type: 'For dark spots and even skin', description: 'A serum for dark spots and uneven skin tone.', size: '30 ml', audiences: ['Women', 'Men'], needs: ['Beauty & glow', 'Clear skin'], ingredients: ['Niacinamide'], price: null, image: '/assets/products/anua-niacinamide-10-txa-4.png', visible: true, inStock: true },
  { id: 'cerave-moisturizing-cream', name: 'Moisturizing Cream', brand: 'CeraVe', category: 'Skincare', type: 'For dry skin and barrier support', description: 'Moisturizing cream with ceramides and hyaluronic acid.', size: '236 ml', audiences: ['Women', 'Men'], needs: ['Hydration & barrier'], ingredients: ['Ceramides', 'Hyaluronic acid'], price: null, image: '/assets/products/cerave-moisturizing-cream.png', visible: true, inStock: true },
  { id: 'medicube-collagen-jelly-cream', name: 'Collagen Jelly Cream', brand: 'Medicube', category: 'Skincare', type: 'For plump, hydrated skin', description: 'A collagen jelly cream for hydration and a bouncy-looking finish.', size: '110 ml', audiences: ['Women', 'Men'], needs: ['Beauty & glow', 'Hydration & barrier'], ingredients: ['Collagen', 'Hyaluronic acid'], price: null, image: '/assets/products/medicube-collagen-jelly-cream.png', visible: true, inStock: true },
]

const DEFAULT_PRODUCT_DISCOVERY = Object.fromEntries(DEFAULT_PRODUCTS.map((product) => [product.id, { audiences: product.audiences, needs: product.needs, ingredients: product.ingredients }]))

// Pictures already on the website, offered in the product editor.
export const PRODUCT_IMAGES = DEFAULT_PRODUCTS.map((product) => ({ label: `${product.brand} ${product.name}`, src: product.image }))

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function mergeContent(saved) {
  const next = structuredClone(DEFAULT_CONTENT)
  if (!isPlainObject(saved)) return next
  for (const part of ['shop', 'home', 'checkout']) {
    if (isPlainObject(saved[part])) Object.assign(next[part], saved[part])
  }
  // An older saved site document will not have these new fields. Keep every
  // original audience path, but accept owner edits for the matching path.
  if (Array.isArray(saved?.home?.audiencePaths)) {
    next.home.audiencePaths = DEFAULT_AUDIENCE_PATHS.map((path) => ({ ...path, ...(saved.home.audiencePaths.find((item) => item?.id === path.id) || {}) }))
  }
  if (Array.isArray(saved?.home?.brandLogos)) {
    next.home.brandLogos = DEFAULT_BRAND_LOGOS.map((logo) => ({ ...logo, ...(saved.home.brandLogos.find((item) => item?.name === logo.name) || {}) }))
  }
  if (isPlainObject(saved.terms)) {
    if (typeof saved.terms.updated === 'string') next.terms.updated = saved.terms.updated
    if (Array.isArray(saved.terms.sections)) next.terms.sections = saved.terms.sections.filter((section) => section && typeof section.title === 'string' && typeof section.body === 'string')
  }
  return next
}

export function cleanProduct(product, index = 0) {
  const price = Number.isInteger(product?.price) && product.price > 0 ? product.price : null
  const id = String(product?.id || `product-${index + 1}`)
  const defaultDiscovery = DEFAULT_PRODUCT_DISCOVERY[id] || {}
  const list = (value, fallback = []) => Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).slice(0, 12) : fallback
  return {
    id,
    name: String(product?.name || 'Untitled product'),
    brand: String(product?.brand || ''),
    category: CATEGORIES.includes(product?.category) ? product.category : CATEGORIES[0],
    type: String(product?.type || ''),
    description: String(product?.description || ''),
    size: String(product?.size || ''),
    audiences: list(product?.audiences, defaultDiscovery.audiences || []),
    needs: list(product?.needs, defaultDiscovery.needs || []),
    ingredients: list(product?.ingredients, defaultDiscovery.ingredients || []),
    price,
    image: String(product?.image || ''),
    supplier: String(product?.supplier || ''),
    sourceUrl: String(product?.sourceUrl || ''),
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
