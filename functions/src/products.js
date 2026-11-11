// One form for a product (Products page): name, price, photo, barcode, cost, whether the website shows it, and
// for a new product the stock already on the shelf — all saved together in one transaction, so a product is
// never half set up (for example on the till with no barcode, or with stock but no price).
import { randomBytes } from 'node:crypto'
import { isValidBarcode } from './core/sale.js'
import { checkExpiry, checkLot } from './core/stock.js'
import { RuleError } from './core/rules.js'
import { audit, movement, readAvailability, readBatches, readCatalog, requireStaff, writeBatch, writeStock } from './shared.js'

const CATEGORIES = ['Supplements', 'Skincare']
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'product'
const text = (value, max) => String(value ?? '').trim().slice(0, max)

function cleanFields(data) {
  const name = text(data?.name, 80)
  if (name.length < 2) throw new RuleError('bad_name', 'Type the product name.')
  const price = data?.price
  if (price !== null && price !== undefined && (!Number.isSafeInteger(price) || price <= 0 || price > 10000000)) throw new RuleError('bad_price', 'Type the selling price in GHS, e.g. 250.00.')
  const image = text(data?.image, 500)
  if (image && !/^(https:\/\/|\/)/.test(image)) throw new RuleError('bad_image', 'The picture must be a link starting with https:// or a shop picture.')
  const category = CATEGORIES.includes(data?.category) ? data.category : CATEGORIES[0]
  return { name, brand: text(data?.brand, 40), size: text(data?.size, 30), category, price: price || null, image, description: text(data?.description, 240), visible: data?.visible !== false }
}

export async function saveProduct({ db, uid, now }, data) {
  const staff = await requireStaff(db, uid, 'products')
  const fields = cleanFields(data)
  const barcode = text(data?.barcode, 32)
  if (barcode && !isValidBarcode(barcode)) throw new RuleError('bad_barcode', 'That barcode is not valid. Scan it again.')
  const sku = text(data?.sku, 24).toUpperCase()
  if (sku && !/^[A-Z0-9-]{2,24}$/.test(sku)) throw new RuleError('bad_sku', 'The shop code can use letters, numbers and dashes only.')
  const reorderPoint = data?.reorderPoint ?? 3
  if (!Number.isInteger(reorderPoint) || reorderPoint < 0 || reorderPoint > 9999) throw new RuleError('bad_reorder', 'Type the stock level that should warn you (a whole number).')
  const cost = data?.cost
  if (cost !== null && cost !== undefined && (!Number.isSafeInteger(cost) || cost < 0)) throw new RuleError('bad_cost', 'The cost must be an amount in GHS.')
  const tracksExpiry = data?.tracksExpiry !== false
  const opening = data?.opening && Number(data.opening.quantity) > 0 ? data.opening : null
  if (opening && (!Number.isInteger(opening.quantity) || opening.quantity > 9999)) throw new RuleError('bad_quantity', 'Type how many you have, as a whole number.')

  return db.runTransaction(async (tx) => {
    // Reads first (Firestore transactions need every read before the first write).
    const products = await readCatalog(tx, db)
    const existing = data?.id ? products.find((product) => product.id === data.id) : null
    if (data?.id && !existing) throw new RuleError('unknown_product', 'This product was removed. Reload the page.')
    const id = existing?.id || `${slug(fields.name)}-${randomBytes(3).toString('hex')}`
    if (barcode) {
      const clash = await tx.get(db.collection('catalogOps').where('barcode', '==', barcode).limit(2))
      // A barcode left on a product that was since deleted from the catalogue does not count.
      const other = clash.docs.find((doc) => doc.id !== id && products.some((product) => product.id === doc.id))
      if (other) throw new RuleError('duplicate_barcode', `This barcode is already on ${products.find((product) => product.id === other.id)?.name || 'another product'}.`)
    }
    if (sku) {
      const clash = await tx.get(db.collection('catalogOps').where('sku', '==', sku).limit(2))
      if (clash.docs.some((doc) => doc.id !== id && products.some((product) => product.id === doc.id))) throw new RuleError('duplicate_sku', `Shop code ${sku} is already used by another product.`)
    }
    const batchesByProduct = opening ? await readBatches(tx, db, [id]) : null
    const availability = opening ? await readAvailability(tx, db) : null
    let lot = null
    let expiresOn = null
    if (opening) {
      lot = checkLot(opening.lot || 'NONE')
      expiresOn = checkExpiry(opening.expiresOn || null, { required: tracksExpiry, now })
    }

    // Writes.
    const product = { ...(existing || { audiences: [], needs: [], ingredients: [], supplier: '', sourceUrl: '', type: '', inStock: true }), ...fields, id }
    const next = existing ? products.map((item) => (item.id === id ? product : item)) : [...products, product]
    tx.set(db.doc('site/catalog'), { products: next, updatedAt: now, updatedBy: uid })
    tx.set(db.doc(`catalogOps/${id}`), { sku: sku || null, barcode: barcode || null, reorderPoint, tracksExpiry, updatedAt: now, updatedBy: uid })
    if (cost !== null && cost !== undefined) tx.set(db.doc(`catalogCosts/${id}`), { cost, updatedAt: now }, { merge: true })
    if (opening) {
      const batch = { id: db.collection('batches').doc().id, productId: id, lot, expiresOn, quantity: opening.quantity, unitCost: cost ?? 0, receivedAt: now, supplierId: null, deliveryId: null }
      batchesByProduct.get(id).push(batch)
      writeBatch(tx, db, batch)
      movement(tx, db, now, staff, { productId: id, batch, delta: opening.quantity, kind: 'adjustment', ref: id, reason: 'Opening stock' })
      writeStock(tx, db, batchesByProduct, availability, now)
    }
    audit(tx, db, now, staff, 'product_setup', id, `${existing ? 'Updated' : 'Added'} ${fields.name}${opening ? ` with ${opening.quantity} in stock` : ''}`)
    return { productId: id }
  })
}

// Deletes a product (owner only): off the till, the website and the Products page. Refused while any stock is
// recorded for it, so stock never disappears without a record: correct the count to 0 first (Stock → the product).
// Past sales, receipts and reports keep the name and price they were sold at; the barcode becomes free to reuse.
export async function deleteProduct({ db, uid, now }, data) {
  const staff = await requireStaff(db, uid, 'products')
  const id = text(data?.id, 80)
  if (!id) throw new RuleError('unknown_product', 'Choose the product to delete.')
  return db.runTransaction(async (tx) => {
    const products = await readCatalog(tx, db)
    const product = products.find((item) => item.id === id)
    if (!product) throw new RuleError('unknown_product', 'This product was already deleted. Reload the page.')
    const batches = (await readBatches(tx, db, [id])).get(id) || []
    const units = batches.reduce((sum, batch) => sum + (Number(batch.quantity) || 0), 0)
    if (units > 0) throw new RuleError('has_stock', `${product.name} still has ${units} in stock (expired ones included). Correct the count to 0 in Stock first, then delete it.`)
    const availability = await readAvailability(tx, db)

    tx.set(db.doc('site/catalog'), { products: products.filter((item) => item.id !== id), updatedAt: now, updatedBy: uid })
    tx.delete(db.doc(`catalogOps/${id}`))
    tx.delete(db.doc(`catalogCosts/${id}`))
    tx.delete(db.doc(`stock/${id}`))
    if (Object.prototype.hasOwnProperty.call(availability, id)) {
      const { [id]: _removed, ...rest } = availability
      tx.set(db.doc('site/availability'), { products: rest, updatedAt: now })
    }
    audit(tx, db, now, staff, 'product_setup', id, `Deleted ${product.name}`)
    return { deleted: id }
  })
}
