import { useCallback, useMemo, useRef, useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { formatMoney, parseCedis } from '../lib/money.js'
import { DISCOUNT_LIMIT, MOMO_NETWORKS } from '../../../functions/src/core/rules.js'
import { expiryStatus, sellableFromSummary } from '../../../functions/src/core/stock.js'
import { discountNeedsApproval } from '../../../functions/src/core/sale.js'
import { taxBreakdown } from '../../../functions/src/core/tax.js'
import { isConnectionProblem } from '../live/offlineSales.js'
import { OfflineSales } from '../components/offline.jsx'
import { Dialog, Icon, Money, Segmented } from '../components/ui.jsx'
import { Guide } from '../components/guide.jsx'
import { beep, CameraScanner, useHardwareScanner } from '../components/scanner.jsx'
import { autoPrintEnabled, PrintArea, printNow, Receipt, setAutoPrint, whatsappReceiptLink } from '../components/receipt.jsx'
import { fmtExpiryMonth } from '../components/format.js'

const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
const EMPTY_PAY = { method: 'cash', received: '', reference: '', network: 'MTN' }

export default function Sell() {
  const { products, catalogLoaded, call, toast, role, shop, online, me, settings, offlineSales, queueSale } = useOps()
  const now = useNow(60000)
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState([])
  const [pay, setPay] = useState(EMPTY_PAY)
  const [discount, setDiscount] = useState({ open: false, type: 'percent', value: '', reason: '' })
  const [customer, setCustomer] = useState({ open: false, name: '', phone: '' })
  const [camera, setCamera] = useState(false)
  const [checkout, setCheckout] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [autoPrint, setAutoPrintState] = useState(autoPrintEnabled)
  const requestId = useRef(newId())
  const searchRef = useRef(null)

  // Units already sold offline on this till are not in the server's stock count yet.
  const queued = useMemo(() => {
    const map = new Map()
    for (const entry of offlineSales) for (const line of entry.lines) map.set(line.productId, (map.get(line.productId) || 0) + line.quantity)
    return map
  }, [offlineSales])
  const onShelf = useCallback((product, at) => sellableFromSummary(product.stock, at) - (queued.get(product.id) || 0), [queued])
  const available = useCallback((product) => onShelf(product, now), [now, onShelf])
  const byCode = useMemo(() => {
    const map = new Map()
    for (const product of products) {
      if (product.setup.barcode) map.set(String(product.setup.barcode).toUpperCase(), product)
      if (product.setup.sku) map.set(String(product.setup.sku).toUpperCase(), product)
    }
    return map
  }, [products])
  const inCart = (id) => cart.find((line) => line.productId === id)?.quantity || 0

  const add = useCallback((product, silent = false) => {
    if (!product.price) { beep(false); toast(`${product.name} has no price yet. The owner can add it in Website → Products.`, 'error'); return }
    const left = onShelf(product, Date.now()) - (cart.find((line) => line.productId === product.id)?.quantity || 0)
    if (left <= 0) { beep(false); toast(`No more ${product.name} in stock.`, 'error'); return }
    if (!silent) beep()
    requestId.current = newId()
    setCart((list) => (list.some((line) => line.productId === product.id)
      ? list.map((line) => (line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line))
      : [...list, { productId: product.id, quantity: 1 }]))
  }, [cart, toast, onShelf])

  const scan = useCallback((raw) => {
    const code = String(raw).trim().toUpperCase()
    const product = byCode.get(code)
    if (!product) { beep(false); toast(`No product has the code ${raw}. The owner can link it in Products.`, 'error'); return }
    add(product, true)
    beep()
  }, [add, byCode, toast])
  useHardwareScanner(scan, !done && !camera)

  const change = (productId, delta) => {
    requestId.current = newId()
    setCart((list) => list.map((line) => {
      if (line.productId !== productId) return line
      const product = products.find((candidate) => candidate.id === productId)
      return { ...line, quantity: Math.max(0, Math.min(line.quantity + delta, product ? onShelf(product, Date.now()) : 0)) }
    }).filter((line) => line.quantity > 0))
  }

  const lines = cart.map((line) => {
    const product = products.find((candidate) => candidate.id === line.productId)
    return { ...line, product, lineTotal: (product?.price || 0) * line.quantity }
  }).filter((line) => line.product)
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0)
  const discountValue = discount.type === 'percent' ? Number.parseInt(discount.value, 10) : parseCedis(discount.value)
  const discountAmount = discount.open && discountValue > 0
    ? (discount.type === 'percent' ? Math.round((subtotal * Math.min(discountValue, 100)) / 100) : Math.min(discountValue, subtotal))
    : 0
  const total = subtotal - discountAmount
  const received = pay.method === 'card' ? total : parseCedis(pay.received)
  const needsApproval = discountNeedsApproval(role, subtotal, discountAmount)
  const units = lines.reduce((sum, line) => sum + line.quantity, 0)

  const drawerMissing = pay.method === 'cash' && !me.openShiftId
  const ready = lines.length > 0 && !busy && !drawerMissing
    && (online || !needsApproval)
    && (!discountAmount || discount.reason.trim().length >= 3)
    && received !== null && received >= total
    && (pay.method !== 'momo' || /^[A-Za-z0-9.-]{6,30}$/.test(pay.reference.trim()))

  const salePayload = () => ({
    requestId: requestId.current,
    lines: lines.map(({ productId, quantity }) => ({ productId, quantity })),
    discount: discountAmount ? { type: discount.type, value: discountValue, reason: discount.reason } : null,
    payment: { method: pay.method, received, reference: pay.reference, network: pay.network },
    customer: customer.name || customer.phone ? { name: customer.name, phone: customer.phone } : null,
  })

  const finished = (sale) => {
    setDone(sale)
    setCheckout(false)
    if (autoPrint) printNow()
  }

  // No internet: the sale is kept on this till and sent later with the same request id (see LiveProvider).
  const saveOffline = (payload) => {
    const at = Date.now()
    const localNumber = `${me.name.slice(0, 1).toUpperCase()}-${String(at).slice(-5)}`
    if (!queueSale({ ...payload, at, shiftId: me.openShiftId || null, clientTotal: total, localNumber })) {
      toast('This device cannot keep offline sales (storage is blocked or full). Wait for the internet to come back.', 'error')
      return
    }
    const byId = new Map(lines.map((line) => [line.productId, line.product]))
    finished({
      provisional: true, number: localNumber, at, status: 'completed', cashier: { uid: me.uid, name: me.name },
      customer: payload.customer, subtotal, total, returns: [],
      items: payload.lines.map((line) => { const product = byId.get(line.productId); return { productId: line.productId, name: product.name, size: product.size || '', unitPrice: product.price, quantity: line.quantity, lineTotal: product.price * line.quantity } }),
      discount: discountAmount ? { amount: discountAmount, reason: discount.reason } : null,
      payment: { method: pay.method, received, change: received - total, network: pay.method === 'momo' ? pay.network : null, reference: pay.reference.trim().toUpperCase() || null },
      tax: taxBreakdown(total, settings.tax),
    })
  }

  const complete = async (event) => {
    event?.preventDefault()
    if (!ready) return
    const payload = salePayload()
    if (!online) { saveOffline(payload); return }
    setBusy(true)
    try {
      const result = await call('completeSale', payload, { quiet: true })
      if (result) finished(result.sale)
    } catch (error) {
      if (isConnectionProblem(error.code) && !needsApproval) saveOffline(payload)
      else toast(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const newSale = () => {
    setCart([]); setPay(EMPTY_PAY); setDiscount({ open: false, type: 'percent', value: '', reason: '' }); setCustomer({ open: false, name: '', phone: '' })
    setDone(null); setQuery(''); requestId.current = newId()
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  const needle = query.trim().toLowerCase()
  const shown = products
    .filter((product) => !needle || `${product.name} ${product.brand} ${product.size} ${product.setup.sku || ''} ${product.setup.barcode || ''}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(available(b) > 0) - Number(available(a) > 0) || a.name.localeCompare(b.name))

  if (done) return <div className="sale-done">
    <div className="sale-done-head">
      <Icon name="check" size={28} />
      <div><h2>{done.provisional ? 'Offline sale saved' : `Sale ${done.number} complete`}</h2><p className="muted">{done.payment.change ? <>Give <b>{formatMoney(done.payment.change)}</b> change.</> : 'No change to give.'}</p></div>
    </div>
    <Receipt sale={done} shop={shop} />
    <PrintArea><Receipt sale={done} shop={shop} /></PrintArea>
    <div className="sale-done-actions">
      <button type="button" className="btn primary large" autoFocus onClick={newSale}>New sale</button>
      <button type="button" className="btn secondary" onClick={printNow}><Icon name="printer" size={16} /> Print receipt</button>
      {done.provisional ? null : <a className="btn secondary" href={whatsappReceiptLink(done, shop)} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={16} /> Send on WhatsApp</a>}
      <label className="check"><input type="checkbox" checked={autoPrint} onChange={(event) => { setAutoPrint(event.target.checked); setAutoPrintState(event.target.checked) }} /> Print automatically after each sale</label>
    </div>
  </div>

  const cartPanel = <form className="checkout" onSubmit={complete}>
    <div className="checkout-lines">
      {lines.length ? lines.map((line) => <div className="checkout-line" key={line.productId}>
        <div className="checkout-line-name"><b>{line.product.name}</b><span className="muted small">{[line.product.brand, line.product.size].filter(Boolean).join(' · ')} · {formatMoney(line.product.price)}</span></div>
        <div className="qty" role="group" aria-label={`How many ${line.product.name}`}>
          <button type="button" onClick={() => change(line.productId, -1)} aria-label="One less"><Icon name="minus" size={16} /></button>
          <span>{line.quantity}</span>
          <button type="button" onClick={() => change(line.productId, 1)} aria-label="One more"><Icon name="plus" size={16} /></button>
        </div>
        <Money value={line.lineTotal} className="checkout-line-total" />
      </div>) : <p className="muted checkout-empty">Scan a barcode or tap a product to start.</p>}
    </div>

    {lines.length ? <>
      <details className="checkout-extra" open={discount.open} onToggle={(event) => setDiscount({ ...discount, open: event.currentTarget.open })}>
        <summary>Discount {discountAmount ? <b>−{formatMoney(discountAmount)}</b> : <span className="muted">(optional)</span>}</summary>
        <div className="stack">
          <div className="row">
            <Segmented label="Discount type" value={discount.type} onChange={(type) => setDiscount({ ...discount, type, value: '' })} options={[{ value: 'percent', label: '%' }, { value: 'amount', label: 'GHS' }]} />
            <input className="grow" inputMode="decimal" aria-label="Discount" placeholder={discount.type === 'percent' ? 'e.g. 10' : 'e.g. 20.00'} value={discount.value} onChange={(event) => setDiscount({ ...discount, value: event.target.value })} />
          </div>
          <input aria-label="Reason for discount" placeholder="Reason (required), e.g. loyal customer" value={discount.reason} onChange={(event) => setDiscount({ ...discount, reason: event.target.value })} />
          <p className={`small ${needsApproval ? 'warn-text' : 'muted'}`}>{needsApproval ? `More than ${DISCOUNT_LIMIT[role]}%: a manager approves with their PIN when you finish the sale.` : `You can give up to ${DISCOUNT_LIMIT[role]}% yourself.`}</p>
        </div>
      </details>
      <details className="checkout-extra" open={customer.open} onToggle={(event) => setCustomer({ ...customer, open: event.currentTarget.open })}>
        <summary>Customer <span className="muted">(optional)</span></summary>
        <div className="stack">
          <input aria-label="Customer name" placeholder="Name" value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })} />
          <input aria-label="Customer phone" inputMode="tel" placeholder="Phone, e.g. 024 123 4567" value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} />
        </div>
      </details>

      <div className="checkout-total"><span>{units} item{units === 1 ? '' : 's'}{discountAmount ? ` · was ${formatMoney(subtotal)}` : ''}</span><Money value={total} className="grand" /></div>

      <Segmented label="How did they pay?" value={pay.method} onChange={(method) => { requestId.current = newId(); setPay({ ...pay, method }) }} options={[{ value: 'cash', label: 'Cash' }, { value: 'momo', label: 'MoMo' }, { value: 'card', label: 'Card' }]} />
      {pay.method === 'cash' ? <>
        <label className="field"><span>Cash received (GHS)</span><input className="big-input" inputMode="decimal" placeholder="0.00" value={pay.received} onChange={(event) => setPay({ ...pay, received: event.target.value })} /></label>
        <div className="chip-row">
          {[...new Set([total, ...[1000, 2000, 5000, 10000, 20000].map((step) => Math.ceil(total / step) * step)])].filter((amount) => amount >= total && amount > 0).slice(0, 4).map((amount) => <button type="button" key={amount} className="chip" onClick={() => setPay({ ...pay, received: (amount / 100).toFixed(2) })}>{amount === total ? 'Exact' : formatMoney(amount)}</button>)}
        </div>
        {received !== null && received >= total ? <p className="change-due">Change: <b>{formatMoney(received - total)}</b></p> : null}
      </> : null}
      {pay.method === 'momo' ? <>
        <p className="muted small">The customer sends the money to the shop's MoMo number. Copy the transaction ID from the payment message.</p>
        <div className="field-row">
          <label className="field"><span>Network</span><select value={pay.network} onChange={(event) => setPay({ ...pay, network: event.target.value })}>{MOMO_NETWORKS.map((network) => <option key={network}>{network}</option>)}</select></label>
          <label className="field"><span>Amount received (GHS)</span><input inputMode="decimal" placeholder={(total / 100).toFixed(2)} value={pay.received} onChange={(event) => setPay({ ...pay, received: event.target.value })} /></label>
        </div>
        <label className="field"><span>Transaction ID</span><input autoComplete="off" value={pay.reference} onChange={(event) => setPay({ ...pay, reference: event.target.value })} /></label>
      </> : null}
      {pay.method === 'card' ? <label className="field"><span>Card slip number <em>optional</em></span><input autoComplete="off" value={pay.reference} onChange={(event) => setPay({ ...pay, reference: event.target.value })} /></label> : null}

      {drawerMissing ? <p className="callout warn small">Open your cash drawer before taking cash. <a href="#/drawer">Open drawer</a> · or choose MoMo or Card.</p> : null}
      {!online ? <p className="warn-text small">{needsApproval ? 'No internet: a discount that needs approval has to wait until the connection is back.' : 'No internet: this sale is kept on this till and sent when the connection is back.'}</p> : null}
      <button type="submit" className="btn primary block large" disabled={!ready}>{busy ? 'Saving…' : `Finish sale · ${formatMoney(total)}`}</button>
    </> : null}
  </form>

  return <div className="sell">
    <Guide id="sell" title="POS · how to make a sale" steps={[
      'Scan the barcode (with the scanner or the camera button), or tap the product.',
      'Change the number with − and +. Add a discount or the customer’s name if needed.',
      'Choose Cash, MoMo or Card, type what you received, then press Finish sale. Cash needs your drawer open (Cash drawer).',
      'Print the receipt or send it on WhatsApp. Press New sale for the next customer.',
    ]} />
    <OfflineSales />
    <div className="sell-grid">
      <section className="sell-products" aria-label="Products">
        <div className="sell-search">
          <label className="search grow">
            <Icon name="search" />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search or type a code" aria-label="Search products"
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                const exact = byCode.get(query.trim().toUpperCase())
                if (exact) { add(exact, true); beep(); setQuery(''); return }
                if (shown.length === 1) { add(shown[0]); setQuery('') }
              }} />
          </label>
          <button type="button" className="btn secondary scan-button" onClick={() => setCamera(true)}><Icon name="camera" size={18} /> Scan</button>
        </div>
        {!catalogLoaded ? <p className="muted">Loading products…</p> : null}
        {catalogLoaded && !products.length ? <p className="callout warn">There are no products yet. The owner adds them in <b>Website → Products</b>.</p> : null}
        <div className="product-list-sell">
          {shown.map((product) => {
            const left = available(product) - inCart(product.id)
            const status = expiryStatus(product.stock?.nextExpiry, now)
            return <button type="button" key={product.id} className="sell-item" disabled={left <= 0 || !product.price} onClick={() => add(product)}>
              <span className="pos-product-art">{product.image ? <img src={product.image} alt="" referrerPolicy="no-referrer" /> : <Icon name="products" size={28} />}</span>
              <span className="sell-item-name"><b>{product.name}</b><span className="muted small">{[product.brand, product.size].filter(Boolean).join(' · ')}</span></span>
              <span className="sell-item-side">
                <b>{product.price ? formatMoney(product.price) : 'Set price'}</b>
                <span className={`small ${left <= 0 ? 'bad-text' : left <= (product.setup.reorderPoint ?? 3) ? 'warn-text' : 'muted'}`}>{left <= 0 ? 'Out of stock' : `${left} in stock`}</span>
                {['soon', 'urgent'].includes(status) ? <span className="tag-expiry">Sell first · {fmtExpiryMonth(product.stock.nextExpiry)}</span> : null}
              </span>
              {inCart(product.id) ? <span className="sell-item-count">{inCart(product.id)}</span> : null}
            </button>
          })}
        </div>
      </section>
      <aside className="sell-cart" aria-label="This sale">
        <h2>This sale</h2>
        {cartPanel}
      </aside>
    </div>

    {lines.length && !checkout ? <div className="pay-bar">
      <span><b>{units}</b> item{units === 1 ? '' : 's'} · <b>{formatMoney(total)}</b></span>
      <button type="button" className="btn primary" onClick={() => setCheckout(true)}>Pay</button>
    </div> : null}
    {checkout ? <Dialog title="This sale" onClose={() => setCheckout(false)} sheet>{cartPanel}</Dialog> : null}
    {camera ? <CameraScanner onClose={() => setCamera(false)} onScan={(code) => { setCamera(false); scan(code) }} /> : null}
  </div>
}
