import { parseCedis } from './money.js'

// Pure logic behind "Import walk-in items": read a pasted (Excel / Google Sheets) or uploaded CSV sheet, validate every
// row, and describe what each good row becomes. No store and no React here, so it is tested on its own.
//
// Walk-in-only items are sold at branch counters through the POS and counted like any other stock, but never appear on
// the website. There is deliberately NO "cost" alias for the price column: a cost column must never silently become the
// shelf price.

const ALIASES = {
  name: ['name', 'product', 'product name', 'item', 'item name'],
  variant: ['size', 'variant', 'variant name', 'pack', 'pack size'],
  sku: ['sku', 'code', 'product code'],
  price: ['price', 'selling price', 'retail price', 'shelf price', 'price (ghs)', 'selling price (ghs)'],
  category: ['category', 'type'],
  reorder: ['reorder', 'reorder at', 'reorder point', 'min stock'],
  lot: ['lot', 'batch', 'lot number', 'batch number', 'batch no', 'lot no'],
  expiry: ['expiry', 'expires', 'expiry date', 'exp', 'exp date', 'best before'],
  // Cost is read into its own field only (for margin). It is never a fallback for the selling price.
  cost: ['cost', 'cost price', 'unit cost', 'buying price', 'purchase price'],
  barcode: ['barcode', 'ean', 'upc'],
}
const COST_HEADERS = ALIASES.cost

// Splits CSV or tab-separated text into rows of cells, honouring double-quoted cells.
export function parseSheet(text) {
  const source = String(text || '').replace(/\r\n?/g, '\n').trim()
  if (!source) return []
  const delimiter = source.split('\n')[0].includes('\t') ? '\t' : ','
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i += 1 }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"' && cell === '') quoted = true
    else if (char === delimiter) { row.push(cell.trim()); cell = '' }
    else if (char === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = '' }
    else cell += char
  }
  row.push(cell.trim())
  rows.push(row)
  return rows.filter((cells) => cells.some((value) => value !== ''))
}

// 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/YYYY' (end of month) -> 'YYYY-MM-DD' or null
export function parseExpiry(value) {
  const text = String(value || '').trim()
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (match) return validDate(match[1], match[2], match[3])
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text)
  if (match) return validDate(match[3], match[2].padStart(2, '0'), match[1].padStart(2, '0'))
  match = /^(\d{1,2})[/.-](\d{4})$/.exec(text)
  if (match) {
    const month = match[1].padStart(2, '0')
    const last = new Date(Date.UTC(Number(match[2]), Number(month), 0)).getUTCDate()
    return validDate(match[2], month, String(last))
  }
  return null
}

function validDate(year, month, day) {
  const iso = `${year}-${month}-${day}`
  const date = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso
}

const NO_EXPIRY = ['none', 'n/a', 'na', 'no expiry', 'does not expire', '-']

// branches: [{ id, name, short }]. existingSkus: Set of SKUs already in the catalog.
// Returns { columns, problems (sheet-level), rows: [{ line, ok, errors, warnings, value }] }
export function readWalkInSheet(text, { branches, existingSkus = new Set() }) {
  const table = parseSheet(text)
  if (table.length < 2) return { columns: {}, problems: ['Paste a header row and at least one item row.'], rows: [] }
  const headers = table[0].map((header) => header.toLowerCase().replace(/\s+/g, ' ').trim())
  const columns = {}
  for (const [field, names] of Object.entries(ALIASES)) {
    const index = headers.findIndex((header) => names.includes(header))
    if (index >= 0) columns[field] = index
  }
  const branchColumns = []
  headers.forEach((header, index) => {
    const branch = branches.find((candidate) => [candidate.id, candidate.name, candidate.short].some((label) => label.toLowerCase() === header))
    if (branch) branchColumns.push({ branchId: branch.id, index })
  })

  const problems = []
  if (columns.name === undefined) problems.push('No product name column (use “Name”).')
  if (columns.sku === undefined) problems.push('No SKU column (use “SKU”).')
  if (columns.price === undefined) {
    problems.push(headers.some((header) => COST_HEADERS.includes(header))
      ? 'No selling price column. A cost column is never used as the selling price — add a “Price” column.'
      : 'No price column (use “Price”, in GHS).')
  }
  if (!branchColumns.length) problems.push(`No branch quantity columns (use ${branches.map((branch) => `“${branch.short}”`).join(', ')}).`)
  if (problems.length) return { columns, branchColumns, problems, rows: [] }

  const seen = new Set()
  const rows = table.slice(1).map((cells, offset) => {
    const line = offset + 2
    const get = (field) => (columns[field] === undefined ? '' : String(cells[columns[field]] ?? '').trim())
    const errors = []
    const warnings = []
    const name = get('name')
    const sku = get('sku').toUpperCase()
    const price = parseCedis(get('price'))
    const reorderText = get('reorder')
    const reorderPoint = reorderText === '' ? 5 : Number(reorderText)
    const quantities = {}
    for (const { branchId, index } of branchColumns) {
      const raw = String(cells[index] ?? '').trim()
      if (raw === '') continue
      if (!/^\d{1,4}$/.test(raw)) errors.push(`Quantity “${raw}” is not a whole number.`)
      else quantities[branchId] = Number(raw)
    }
    const units = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0)
    const expiryText = get('expiry')
    const noExpiry = NO_EXPIRY.includes(expiryText.toLowerCase())
    const expiresOn = noExpiry ? null : parseExpiry(expiryText)
    const lot = get('lot')
    const costText = get('cost')
    const cost = costText === '' ? null : parseCedis(costText)
    const barcode = get('barcode')

    if (!name) errors.push('Name is empty.')
    if (!sku) errors.push('SKU is empty.')
    else if (existingSkus.has(sku)) errors.push(`SKU ${sku} already exists — skipped, nothing is edited.`)
    else if (seen.has(sku)) errors.push(`SKU ${sku} appears twice in this sheet.`)
    if (price === null || price === 0) errors.push(`Price “${get('price')}” is not a valid amount in GHS.`)
    if (!Number.isInteger(reorderPoint) || reorderPoint < 0) errors.push('Reorder point must be a whole number.')
    if (!Object.keys(quantities).length) errors.push('No quantity for any branch.')
    if (units > 0 && !lot) errors.push('Lot / batch number is required for opening stock.')
    if (units > 0 && !noExpiry && !expiresOn) errors.push(expiryText ? `Expiry “${expiryText}” is not a date (use YYYY-MM-DD or DD/MM/YYYY, or “none”).` : 'Expiry date is required (or write “none” for items that do not expire).')
    if (costText !== '' && cost === null) errors.push(`Cost “${costText}” is not a valid amount in GHS.`)
    if (cost !== null && price !== null && cost > price) warnings.push('Cost is higher than the selling price.')
    if (cost === null) warnings.push('No cost price — margin will show as unknown.')
    if (barcode && !/^[A-Za-z0-9-]{6,20}$/.test(barcode)) errors.push(`Barcode “${barcode}” is not valid.`)
    if (noExpiry) warnings.push('Marked as not expiring.')
    if (sku) seen.add(sku)

    return {
      line,
      ok: errors.length === 0,
      errors,
      warnings,
      value: {
        name,
        variantName: get('variant') || 'Standard',
        sku,
        price,
        category: get('category') || 'Walk-in',
        reorderPoint,
        lot: lot.toUpperCase(),
        expiresOn,
        tracksExpiry: !noExpiry,
        quantities,
        cost,
        barcode,
      },
    }
  })
  return { columns, branchColumns, problems, rows }
}

export const WALK_IN_TEMPLATE = (branches) => [
  ['Name', 'Size', 'SKU', 'Price', 'Cost', 'Category', 'Lot', 'Expiry', ...branches.map((branch) => branch.short)].join(','),
  ['Travel Barrier Serum', '10 ml', 'SM-BAR-10', '95.00', '42.00', 'Skincare', 'L2609T', '2027-08-31', ...branches.map((_, index) => ['12', '8', '0'][index] ?? '0')].join(','),
  ['SkinMatrix Travel Pouch', 'Standard', 'SM-GFT-02', '30.00', '9.00', 'Accessories', 'P02', 'none', ...branches.map((_, index) => ['30', '20', '15'][index] ?? '0')].join(','),
].join('\n')
