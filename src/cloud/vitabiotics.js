// Supplier catalogue intake for the Website editor. This reads only the public
// catalogue that Vitabiotics has approved SkinMatrix to use. It deliberately
// creates drafts: local Ghana prices, stock and publication remain an owner
// decision, never an inference from a supplier website.

export const VITABIOTICS_CATALOGUE_URL = 'https://www.vitabiotics.com/products.json?limit=250&page=1'
const SOURCE = 'Vitabiotics'

const plainText = (value) => String(value || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim()

const words = (item) => [item.title, item.product_type, ...(Array.isArray(item.tags) ? item.tags : String(item.tags || '').split(','))]
  .join(' ').toLowerCase()

const matches = (haystack, expression) => expression.test(haystack)
const add = (list, condition, value) => (condition && !list.includes(value) ? [...list, value] : list)

function discovery(item) {
  const text = words(item)
  let audiences = []
  audiences = add(audiences, matches(text, /wellman|men['’]?s|men 50\+/), 'Men')
  audiences = add(audiences, matches(text, /wellwoman|women['’]?s|women 50\+|menopace|pregnacare|perfectil/), 'Women')
  audiences = add(audiences, matches(text, /wellbaby|baby|infant/), '6 months–4 years')
  audiences = add(audiences, matches(text, /wellkid|kids?|children/), '4–12 years')
  audiences = add(audiences, matches(text, /wellteen|teen/), '13–19 years')

  let needs = []
  needs = add(needs, matches(text, /pregnacare|pregnan|conception|postnatal|breastfeed/), 'Pregnancy & new mums')
  needs = add(needs, matches(text, /wellbaby|wellkid|wellteen|kids?|children|baby|infant/), 'Kids’ wellness')
  needs = add(needs, matches(text, /wellman|wellwoman|energy|feroglobin|sport|fitness|perform/), 'Energy & vitality')
  needs = add(needs, matches(text, /perfectil|hairfollic|hair|nail/), 'Hair & nails')
  needs = add(needs, matches(text, /perfectil|beauty|skin|radiance|collagen/), 'Beauty & glow')
  needs = add(needs, matches(text, /menopace|wellwoman|women['’]?s/), 'Women’s wellness')
  needs = add(needs, matches(text, /50\+|menopace|wellwoman 50|wellman 50/), 'Healthy ageing')
  needs = add(needs, matches(text, /sleep|night/), 'Sleep & unwind')
  needs = add(needs, matches(text, /immun|defence|defense/), 'Immune support')
  needs = add(needs, matches(text, /probi|digest|wellzyme|gut/), 'Digestion & gut')
  needs = add(needs, matches(text, /osteocare|jointace|bone|joint|cartilage/), 'Bones & joints')
  needs = add(needs, matches(text, /cardio|omega|neuro|brain|heart/), 'Heart & brain')

  const ingredients = [
    ['Collagen', /collagen/], ['Magnesium', /magnesium/], ['Biotin', /biotin/],
    ['Vitamin C', /vitamin c/], ['Hyaluronic acid', /hyaluronic/], ['Omega-3', /omega[ -]?3/],
  ].reduce((all, [name, expression]) => add(all, matches(text, expression), name), [])

  return { audiences, needs, ingredients }
}

export function vitabioticsDraft(item) {
  const title = String(item?.title || '').trim()
  const handle = String(item?.handle || '').trim()
  if (!title || !handle) return null
  const firstVariant = Array.isArray(item.variants) ? item.variants[0] : null
  const variantTitle = String(firstVariant?.title || '').trim()
  const image = Array.isArray(item.images) ? item.images[0]?.src : item.image?.src
  const tags = discovery(item)
  return {
    id: `vitabiotics-${handle}`,
    name: title,
    brand: SOURCE,
    category: /skincare|cream|serum|moisturi[sz]er|shampoo|body wash|face wash/.test(words(item)) ? 'Skincare' : 'Supplements',
    type: String(item.product_type || '').trim(),
    description: plainText(item.body_html).slice(0, 240),
    size: variantTitle && variantTitle !== 'Default Title' ? variantTitle.slice(0, 30) : '',
    ...tags,
    image: String(image || ''),
    sourceUrl: `https://www.vitabiotics.com/products/${handle}`,
    supplier: SOURCE,
    // A supplier retail listing is not SkinMatrix availability. Keep it private
    // until the owner confirms local price, stock and customer-facing claims.
    price: null,
    visible: false,
    inStock: false,
  }
}

export async function importVitabioticsCatalogue(fetcher = fetch) {
  const response = await fetcher(VITABIOTICS_CATALOGUE_URL)
  if (!response.ok) throw new Error(`Vitabiotics catalogue could not be loaded (${response.status}).`)
  const payload = await response.json()
  if (!Array.isArray(payload?.products)) throw new Error('Vitabiotics catalogue returned an unexpected format.')
  return payload.products.map(vitabioticsDraft).filter(Boolean)
}

// Existing items always win. This lets an owner run the importer again later
// to pick up new supplier products without erasing stock, price or copy edits.
export function addVitabioticsDrafts(current = [], imported = []) {
  const existing = new Set(current.map((product) => product.id))
  const fresh = imported.filter((product) => !existing.has(product.id))
  return { products: [...current, ...fresh], added: fresh.length, skipped: imported.length - fresh.length }
}
