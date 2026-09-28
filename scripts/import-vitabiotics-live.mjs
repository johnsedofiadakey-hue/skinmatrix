#!/usr/bin/env node
// Owner-operated catalogue intake. Run with --apply only after confirming the
// supplier permission and the review-first publication policy. It writes only
// `site/catalog.products`, preserving every other field in the document.

import { execFileSync } from 'node:child_process'
import { addVitabioticsDrafts, importVitabioticsCatalogue } from '../src/cloud/vitabiotics.js'
import { mergeCatalog } from '../src/cloud/site.js'

const projectId = 'skinmatrixgh'
const documentUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/site/catalog`
const apply = process.argv.includes('--apply')
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim()
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

function decode(value) {
  if ('nullValue' in value) return null
  if ('stringValue' in value) return value.stringValue
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode)
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, child]) => [key, decode(child)]))
  return null
}

function encode(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)])) } }
  return { stringValue: String(value) }
}

const currentResponse = await fetch(documentUrl, { headers })
if (!currentResponse.ok && currentResponse.status !== 404) throw new Error(`Could not read the SkinMatrix catalogue (${currentResponse.status}).`)
// When no catalogue document exists, the public site is currently showing its
// built-in products. Treat those as the current catalogue so this import adds
// to the experience instead of silently replacing it.
const current = currentResponse.status === 404
  ? mergeCatalog(null)
  : mergeCatalog({ products: decode((await currentResponse.json()).fields.products) })
const supplierDrafts = await importVitabioticsCatalogue()
const next = addVitabioticsDrafts(current, supplierDrafts)
console.log(`${next.added} new Vitabiotics drafts; ${next.skipped} existing entries kept; ${next.products.length} total catalogue products.`)

if (!apply) {
  console.log('Dry run only. Re-run with --apply to save these hidden, unpriced and out-of-stock drafts.')
  process.exit(0)
}

const save = await fetch(`${documentUrl}?updateMask.fieldPaths=products`, {
  method: 'PATCH', headers,
  body: JSON.stringify({ fields: { products: encode(next.products) } }),
})
if (!save.ok) throw new Error(`Could not save supplier drafts (${save.status}): ${await save.text()}`)
console.log('Supplier drafts saved. They remain invisible until an owner adds local stock, price and publication status.')
