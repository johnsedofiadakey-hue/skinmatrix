import { useEffect, useState } from 'react'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore/lite'
import { db } from '../../cloud/firebase.js'
import { CATEGORIES, checkSiteEdits, cleanProduct, formatGhs, mergeCatalog, mergeContent, parseGhs, PRODUCT_IMAGES, SHOP_FIELDS } from '../../cloud/site.js'
import { EditorGate } from '../cloud.jsx'
import { Card, Icon, Pill, Segmented } from '../components/ui.jsx'
import { useOps } from '../hooks.js'

const TABS = [
  { value: 'shop', label: 'Shop details' },
  { value: 'home', label: 'Home page' },
  { value: 'products', label: 'Products' },
  { value: 'checkout', label: 'Checkout and payment' },
  { value: 'terms', label: 'Terms' },
]

const toCedis = (pesewas) => (Number.isInteger(pesewas) ? (pesewas / 100).toFixed(2) : '')
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'product'

export default function Website() {
  return <div className="stack website-editor">
    <p className="muted">Change the words, products, prices and terms on the public website. Nothing here touches the till or the demo data.</p>
    <EditorGate purpose="Only the owner can change the public website.">{(user) => <Editor user={user} />}</EditorGate>
  </div>
}

function Editor({ user }) {
  const { toast } = useOps()
  const [tab, setTab] = useState('shop')
  const [content, setContent] = useState(null)
  const [products, setProducts] = useState(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    Promise.all([getDoc(doc(db, 'site', 'content')), getDoc(doc(db, 'site', 'catalog'))])
      .then(([c, k]) => { setContent(mergeContent(c.exists() ? c.data() : null)); setProducts(mergeCatalog(k.exists() ? k.data() : null)) })
      .catch(() => toast('Could not load the website content. Check your internet and reload.', 'error'))
  }, [toast])

  useEffect(() => {
    if (!dirty) return undefined
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (!content || !products) return <p className="muted">Loading the website content…</p>

  const edit = (part, key, value) => { setContent({ ...content, [part]: { ...content[part], [key]: value } }); setDirty(true) }
  const editProducts = (next) => { setProducts(next); setDirty(true) }

  const save = async () => {
    const problems = checkSiteEdits(content, products)
    if (problems.length) { toast(problems[0], 'error'); return }
    setSaving(true)
    const stamp = { updatedAt: serverTimestamp(), updatedBy: user.uid }
    try {
      await Promise.all([
        setDoc(doc(db, 'site', 'content'), { shop: content.shop, home: content.home, checkout: content.checkout, terms: content.terms, ...stamp }),
        setDoc(doc(db, 'site', 'catalog'), { products: products.map(cleanProduct), ...stamp }),
      ])
      setDirty(false)
      toast('Saved. The website shows the change now (visitors may need to reload).')
    } catch {
      toast('Could not save. Check your internet and try again.', 'error')
    }
    setSaving(false)
  }

  return <>
    <div className="website-toolbar">
      <Segmented label="Part of the website" value={tab} onChange={setTab} options={TABS} />
      <div className="row">
        <a className="btn ghost" href="/" target="_blank" rel="noreferrer">Open website</a>
        <button type="button" className="btn primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</button>
      </div>
    </div>
    {tab === 'shop' ? <ShopTab shop={content.shop} onChange={(key, value) => edit('shop', key, value)} /> : null}
    {tab === 'home' ? <HomeTab home={content.home} onChange={(key, value) => edit('home', key, value)} /> : null}
    {tab === 'products' ? <ProductsTab products={products} onChange={editProducts} /> : null}
    {tab === 'checkout' ? <CheckoutTab checkout={content.checkout} onChange={(key, value) => edit('checkout', key, value)} /> : null}
    {tab === 'terms' ? <TermsTab terms={content.terms} onChange={(terms) => { setContent({ ...content, terms }); setDirty(true) }} /> : null}
  </>
}

function TextField({ label, hint, value, onChange, multiline = false, ...rest }) {
  return <label className="field">
    <span>{label}{hint ? <em className="muted small"> · {hint}</em> : null}</span>
    {multiline ? <textarea rows={multiline === true ? 3 : multiline} value={value} onChange={(event) => onChange(event.target.value)} {...rest} /> : <input value={value} onChange={(event) => onChange(event.target.value)} {...rest} />}
  </label>
}

const SHOP_HINTS = {
  legalName: 'as registered, e.g. SkinMatrix Ventures Ltd',
  whatsapp: 'e.g. 024 123 4567',
  deliveryAreas: 'e.g. Accra and Tema',
  deliveryTime: 'e.g. 1 to 2 days',
  returnDays: 'a number, e.g. 7',
  refundDays: 'a number, e.g. 5',
  instagram: 'full link, starting with https://',
}

function ShopTab({ shop, onChange }) {
  const missing = SHOP_FIELDS.filter((field) => field.key !== 'instagram' && !String(shop[field.key] || '').trim())
  return <Card title="Shop details">
    <div className="stack">
      {missing.length ? <div className="callout warn"><Icon name="alert" /><p>These are still empty, so the website shows a [placeholder] instead: {missing.map((field) => field.label).join(', ')}.</p></div> : <p className="good-text">All shop details are filled in.</p>}
      <p className="muted small">These appear in the footer, at checkout and inside the terms.</p>
      <div className="grid-2">{SHOP_FIELDS.map((field) => <TextField key={field.key} label={field.label} hint={SHOP_HINTS[field.key]} value={shop[field.key] || ''} onChange={(value) => onChange(field.key, value)} />)}</div>
    </div>
  </Card>
}

function HomeTab({ home, onChange }) {
  return <Card title="Top of the home page">
    <div className="stack">
      <TextField label="Headline" hint="press Enter for a new line" multiline={2} value={home.heroTitle} onChange={(value) => onChange('heroTitle', value)} maxLength={60} />
      <TextField label="Last word of the headline" hint="shown lighter" value={home.heroAccent} onChange={(value) => onChange('heroAccent', value)} maxLength={30} />
      <TextField label="Text under the headline" multiline value={home.heroText} onChange={(value) => onChange('heroText', value)} maxLength={200} />
      <div className="website-preview" aria-label="Preview">
        <span className="muted small">Preview</span>
        <h3>{home.heroTitle.split('\n').map((line, index) => <span key={index}>{index ? <br /> : null}{line}</span>)} <em>{home.heroAccent}</em></h3>
        <p>{home.heroText}</p>
      </div>
    </div>
  </Card>
}

function ProductsTab({ products, onChange }) {
  const update = (index, key, value) => onChange(products.map((product, i) => (i === index ? { ...product, [key]: value } : product)))
  const move = (index, step) => {
    const next = [...products]
    const [item] = next.splice(index, 1)
    next.splice(index + step, 0, item)
    onChange(next)
  }
  const remove = (index) => {
    if (!window.confirm(`Remove "${products[index].name}" from the website? To hide it for a while, untick "Show on website" instead.`)) return
    onChange(products.filter((_, i) => i !== index))
  }
  const add = () => onChange([...products, cleanProduct({ id: `${slug('new product')}-${Date.now().toString(36)}`, name: 'New product', visible: false, image: '' })])

  return <div className="stack">
    <p className="muted">A product can be bought only when it has a price, is in stock and is shown on the website. Prices are in Ghana cedis.</p>
    {products.map((product, index) => <ProductEditor key={product.id} product={product} index={index} count={products.length} onChange={(key, value) => update(index, key, value)} onMove={(step) => move(index, step)} onRemove={() => remove(index)} />)}
    <div><button type="button" className="btn" onClick={add}><Icon name="plus" size={16} /> Add a product</button></div>
  </div>
}

function ProductEditor({ product, index, count, onChange, onMove, onRemove }) {
  const [priceText, setPriceText] = useState(toCedis(product.price))
  const priceBad = priceText.trim() !== '' && parseGhs(priceText) === null
  const known = PRODUCT_IMAGES.some((image) => image.src === product.image)
  const status = !product.visible ? <Pill tone="grey">Hidden</Pill> : !product.inStock ? <Pill tone="amber">Out of stock</Pill> : !product.price ? <Pill tone="amber">No price yet</Pill> : <Pill tone="green">On sale · {formatGhs(product.price)}</Pill>
  return <Card title={<span className="product-editor-title">{product.image ? <img src={product.image} alt="" /> : null}{product.name || 'Untitled'} {status}</span>} actions={<>
    <button type="button" className="icon-button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up"><Icon name="back" size={16} className="rot-90" /></button>
    <button type="button" className="icon-button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move down"><Icon name="back" size={16} className="rot-270" /></button>
    <button type="button" className="icon-button" onClick={onRemove} aria-label={`Remove ${product.name}`}><Icon name="trash" size={16} /></button>
  </>}>
    <div className="grid-2">
      <TextField label="Product name" value={product.name} onChange={(value) => onChange('name', value)} maxLength={80} />
      <TextField label="Brand" value={product.brand} onChange={(value) => onChange('brand', value)} maxLength={40} />
      <label className="field"><span>Type</span><select value={product.category} onChange={(event) => onChange('category', event.target.value)}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
      <TextField label="Size" hint="e.g. 30 ml or 60 tablets" value={product.size} onChange={(value) => onChange('size', value)} maxLength={30} />
      <TextField label="Good for" hint="short, e.g. For dark spots" value={product.type} onChange={(value) => onChange('type', value)} maxLength={50} />
      <label className={`field ${priceBad ? 'invalid' : ''}`}><span>Price (GHS)<em className="muted small"> · leave empty if not ready</em></span>
        <input inputMode="decimal" value={priceText} placeholder="e.g. 250.00" aria-invalid={priceBad} onChange={(event) => { setPriceText(event.target.value); const value = parseGhs(event.target.value); onChange('price', value && value > 0 ? value : null) }} />
        {priceBad ? <small className="bad-text">Type the price like 250 or 250.50.</small> : null}
      </label>
    </div>
    <TextField label="Short description" hint="one or two simple sentences" multiline value={product.description} onChange={(value) => onChange('description', value)} maxLength={240} />
    <div className="grid-2">
      <label className="field"><span>Picture</span>
        <select value={known ? product.image : 'custom'} onChange={(event) => onChange('image', event.target.value === 'custom' ? '' : event.target.value)}>
          {PRODUCT_IMAGES.map((image) => <option key={image.src} value={image.src}>{image.label}</option>)}
          <option value="custom">Another picture (paste a link)</option>
        </select>
      </label>
      {!known ? <TextField label="Picture link" hint="https://… or /assets/…" value={product.image} onChange={(value) => onChange('image', value)} /> : <span />}
    </div>
    <div className="row website-toggles">
      <label className="check"><input type="checkbox" checked={product.visible} onChange={(event) => onChange('visible', event.target.checked)} /> Show on website</label>
      <label className="check"><input type="checkbox" checked={product.inStock} onChange={(event) => onChange('inStock', event.target.checked)} /> In stock</label>
    </div>
  </Card>
}

function CheckoutTab({ checkout, onChange }) {
  const [feeText, setFeeText] = useState(toCedis(checkout.deliveryFee))
  const feeBad = feeText.trim() !== '' && parseGhs(feeText) === null
  const key = String(checkout.paystackPublicKey || '')
  return <div className="stack">
    <Card title="Delivery and pickup">
      <div className="stack">
        <label className={`field ${feeBad ? 'invalid' : ''}`}><span>Delivery fee (GHS)<em className="muted small"> · leave empty to agree the fee on the phone</em></span>
          <input inputMode="decimal" value={feeText} placeholder="e.g. 30.00" onChange={(event) => { setFeeText(event.target.value); onChange('deliveryFee', event.target.value.trim() === '' ? null : parseGhs(event.target.value)) }} />
          {feeBad ? <small className="bad-text">Type the fee like 30 or 30.50.</small> : null}
        </label>
        <label className="check"><input type="checkbox" checked={checkout.pickup} onChange={(event) => onChange('pickup', event.target.checked)} /> Customers can pick up at the shop</label>
      </div>
    </Card>
    <Card title="Online payment (Paystack)">
      <div className="stack">
        <p>{key ? <Pill tone={key.startsWith('pk_live_') ? 'green' : 'amber'}>{key.startsWith('pk_live_') ? 'Live payments on' : 'Test mode'}</Pill> : <Pill tone="grey">Off</Pill>} {key ? 'Customers pay online at checkout.' : 'Customers place orders and you call them to arrange payment.'}</p>
        <TextField label="Paystack public key" hint="starts with pk_live_ (or pk_test_ to try it)" value={key} onChange={(value) => onChange('paystackPublicKey', value.trim())} autoComplete="off" spellCheck={false} />
        <div className="callout warn"><Icon name="alert" /><p>Only paste the <b>public</b> key. Never paste the secret key (it starts with sk_). You find both in Paystack: Settings → API Keys and Webhooks.</p></div>
        <p className="muted small">After a customer pays, check the payment in your Paystack dashboard before you send the order. The order number is the Paystack reference.</p>
      </div>
    </Card>
  </div>
}

function TermsTab({ terms, onChange }) {
  const setSection = (index, key, value) => onChange({ ...terms, sections: terms.sections.map((section, i) => (i === index ? { ...section, [key]: value } : section)) })
  const move = (index, step) => {
    const sections = [...terms.sections]
    const [item] = sections.splice(index, 1)
    sections.splice(index + step, 0, item)
    onChange({ ...terms, sections })
  }
  return <div className="stack">
    <Card title="Terms and conditions">
      <div className="stack">
        <label className="field"><span>Last updated</span><input type="date" value={terms.updated} onChange={(event) => onChange({ ...terms, updated: event.target.value })} /></label>
        <p className="muted small">Write in simple words. Put each point on its own line. To insert a shop detail, type its code: {SHOP_FIELDS.map((field) => <code key={field.key} className="mono">{`{${field.key}}`}</code>).reduce((all, item) => [...all, ' ', item], [])}. It fills in from "Shop details".</p>
        <div className="callout warn"><Icon name="alert" /><p>This is a starting draft. Ask a lawyer in Ghana to check it before you rely on it.</p></div>
      </div>
    </Card>
    {terms.sections.map((section, index) => <Card key={index} title={`${index + 1}. ${section.title || 'Untitled section'}`} actions={<>
      <button type="button" className="icon-button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up"><Icon name="back" size={16} className="rot-90" /></button>
      <button type="button" className="icon-button" onClick={() => move(index, 1)} disabled={index === terms.sections.length - 1} aria-label="Move down"><Icon name="back" size={16} className="rot-270" /></button>
      <button type="button" className="icon-button" onClick={() => { if (window.confirm(`Delete the section "${section.title}"?`)) onChange({ ...terms, sections: terms.sections.filter((_, i) => i !== index) }) }} aria-label="Delete section"><Icon name="trash" size={16} /></button>
    </>}>
      <div className="stack">
        <TextField label="Title" value={section.title} onChange={(value) => setSection(index, 'title', value)} maxLength={80} />
        <TextField label="Text" multiline={6} value={section.body} onChange={(value) => setSection(index, 'body', value)} />
      </div>
    </Card>)}
    <div><button type="button" className="btn" onClick={() => onChange({ ...terms, sections: [...terms.sections, { title: 'New section', body: '' }] })}><Icon name="plus" size={16} /> Add a section</button></div>
  </div>
}
