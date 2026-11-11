// The POS: a full-screen, touch-first till. Products on the left (photo tiles, categories, search, scanner),
// the current sale on the right, and a payment screen with a big number pad. Works with no internet: the sale
// is kept on this till and sent later (see LiveProvider). What the customer sees on their own screen is sent
// from here (useCustomerDisplay): only the items being sold and the payment being keyed in.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { formatMoney, parseCedis } from '../lib/money.js'
import { DISCOUNT_LIMIT, MOMO_NETWORKS, ROLE_LABEL } from '../../../functions/src/core/rules.js'
import { expiryStatus, sellableFromSummary } from '../../../functions/src/core/stock.js'
import { discountNeedsApproval } from '../../../functions/src/core/sale.js'
import { taxBreakdown } from '../../../functions/src/core/tax.js'
import { isConnectionProblem } from '../live/offlineSales.js'
import { tillWarnings } from '../live/risks.js'
import { OfflineSales } from '../components/offline.jsx'
import { Dialog, Icon } from '../components/ui.jsx'
import { beep, CameraScanner, useHardwareScanner } from '../components/scanner.jsx'
import { PrintArea, Receipt, whatsappReceiptLink } from '../components/receipt.jsx'
import { bridge, setTill, useTill } from '../till/device.js'
import { canSwapScreens, ONE_SCREEN_HELP, openCustomerDisplay, swapScreens, useCustomerDisplay } from '../till/display.js'
import { kickDrawerForCash, useReceiptPrinter } from '../till/printing.jsx'
import { NoSaleDialog } from '../till/TillBar.jsx'
import { fmtExpiryMonth } from '../components/format.js'
import { Keypad, keyedMoney } from '../pos/Keypad.jsx'
import { dropHeld, holdSale, takeHeld, useHeld } from '../pos/held.js'
import { toggleTheme, useTheme } from '../theme.js'
import { promptAction, promptNetwork, PromptPanel, useMomoPrompt } from '../pos/momoPrompt.jsx'

const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
// momoMode: 'prompt' (the customer approves a prompt on their phone) or 'manual' (they send to the shop number).
const EMPTY_PAY = { method: 'cash', received: '', reference: '', network: 'MTN', otherAmount: false, momoMode: 'prompt', phone: '', promptNetwork: '' }
const EMPTY_DISCOUNT = { type: 'percent', value: '', reason: '' }
const EMPTY_CUSTOMER = { name: '', phone: '' }
const METHODS = [
  { value: 'cash', label: 'Cash', icon: 'cash' },
  { value: 'momo', label: 'MoMo', icon: 'phone' },
  { value: 'card', label: 'Card', icon: 'card' },
]
const PAID_BY = { cash: 'cash', momo: 'mobile money', card: 'card' }
const NOTES = [500, 1000, 2000, 5000, 10000, 20000] // GHS 5 … 200 in pesewas

// Amounts a customer is likely to hand over for this total: exact, then the next round notes.
function quickCash(total) {
  if (total <= 0) return []
  const options = new Set([total])
  for (const note of NOTES) {
    const up = Math.ceil(total / note) * note
    if (up > total) options.add(up)
  }
  return [...options].sort((a, b) => a - b).slice(0, 5)
}

const productDetail = (product) => [product.brand, product.size].filter(Boolean).join(' · ')

export default function Sell({ onMenu }) {
  const { products, catalogLoaded, call, toast, role, shop, online, me, settings, offlineSales, queueSale, signOut, backup, clockSkew } = useOps()
  const now = useNow(60000)
  const till = useTill()
  const held = useHeld()
  const { theme } = useTheme()
  const printReceipt = useReceiptPrinter()

  const [cart, setCart] = useState([])
  const [discount, setDiscount] = useState(EMPTY_DISCOUNT)
  const [customer, setCustomer] = useState(EMPTY_CUSTOMER)
  const [pay, setPay] = useState(EMPTY_PAY)
  const [step, setStep] = useState('sale') // 'sale' | 'pay'
  const [done, setDone] = useState(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [lastAdded, setLastAdded] = useState(null)
  const [panel, setPanel] = useState(null) // 'discount' | 'customer' | 'held' | 'noSale' | 'user' | 'camera' | 'offline'
  const [ticketOpen, setTicketOpen] = useState(false) // phones: the sale opens as a sheet
  const [clearArmed, setClearArmed] = useState(false)
  const requestId = useRef(newId())
  const momoPrompt = useMomoPrompt({ call, online, onPaid: (sale) => finished(sale) })
  // Tells the till app a sale is on screen, so it never restarts for an update in the middle of one.
  const saleOnScreen = cart.length > 0 || momoPrompt.open
  useEffect(() => {
    bridge()?.setBusy?.(saleOnScreen).catch?.(() => {})
  }, [saleOnScreen])
  useEffect(() => () => { bridge()?.setBusy?.(false)?.catch?.(() => {}) }, [])

  // ── Stock: units already sold offline on this till are not in the server's count yet ──
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

  // ── The sale ──
  const touch = () => { requestId.current = newId() } // any change to the sale is a new request
  const add = useCallback((product, { sound = true } = {}) => {
    if (!product.price) { beep(false); toast(`${product.name} has no price yet. Add it in Products.`, 'error'); return false }
    const left = onShelf(product, Date.now()) - (cart.find((line) => line.productId === product.id)?.quantity || 0)
    if (left <= 0) { beep(false); toast(`No more ${product.name} in stock.`, 'error'); return false }
    if (sound) beep()
    requestId.current = newId()
    setLastAdded(product.id)
    setCart((list) => (list.some((line) => line.productId === product.id)
      ? list.map((line) => (line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line))
      : [...list, { productId: product.id, quantity: 1 }]))
    return true
  }, [cart, toast, onShelf])

  const change = (productId, delta) => {
    touch()
    setCart((list) => list.map((line) => {
      if (line.productId !== productId) return line
      const product = products.find((candidate) => candidate.id === productId)
      return { ...line, quantity: Math.max(0, Math.min(line.quantity + delta, product ? onShelf(product, Date.now()) : 0)) }
    }).filter((line) => line.quantity > 0))
  }
  const remove = (productId) => { touch(); setCart((list) => list.filter((line) => line.productId !== productId)) }

  const lines = cart.map((line) => {
    const product = products.find((candidate) => candidate.id === line.productId)
    return { ...line, product, lineTotal: (product?.price || 0) * line.quantity }
  }).filter((line) => line.product)
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0)
  const discountValue = discount.type === 'percent' ? Number.parseInt(discount.value, 10) : parseCedis(discount.value)
  const discountAmount = discountValue > 0 && discount.reason.trim().length >= 3
    ? (discount.type === 'percent' ? Math.round((subtotal * Math.min(discountValue, 100)) / 100) : Math.min(discountValue, subtotal))
    : 0
  const total = subtotal - discountAmount
  const units = lines.reduce((sum, line) => sum + line.quantity, 0)
  const needsApproval = discountNeedsApproval(role, subtotal, discountAmount)

  const typedAmount = parseCedis(pay.received)
  const received = pay.method === 'cash' || (pay.method === 'momo' && pay.otherAmount) ? typedAmount : total
  const drawerMissing = pay.method === 'cash' && !me.openShiftId
  const promptMode = pay.method === 'momo' && pay.momoMode === 'prompt' && momoPrompt.ready
  const referenceOk = pay.method !== 'momo' || promptMode || /^[A-Za-z0-9.-]{6,30}$/.test(pay.reference.trim())
  const ready = lines.length > 0 && !busy && !drawerMissing && (online || !needsApproval)
    && received !== null && received >= total && referenceOk && !promptMode
  const blocker = !lines.length || promptMode ? '' : drawerMissing ? 'Open your cash drawer first, or take MoMo or card.'
    : !online && needsApproval ? 'No internet: a discount that needs a manager must wait for the connection.'
      : received === null || received < total ? (pay.method === 'cash' ? 'Key in the cash the customer gave.' : 'The amount is less than the total.')
        : !referenceOk ? 'Type the MoMo transaction ID from the payment message.' : ''

  const salePayload = () => ({
    requestId: requestId.current,
    lines: lines.map(({ productId, quantity }) => ({ productId, quantity })),
    discount: discountAmount ? { type: discount.type, value: discountValue, reason: discount.reason } : null,
    payment: { method: pay.method, received, reference: pay.reference, network: pay.network },
    customer: customer.name || customer.phone ? { name: customer.name, phone: customer.phone } : null,
  })

  const finished = (sale) => {
    setDone(sale)
    setStep('sale')
    setTicketOpen(false)
    // With auto-print the drawer opens with the receipt; otherwise it opens on its own for cash.
    if (till.autoPrint) printReceipt(sale, shop, { kick: true })
    else kickDrawerForCash(sale.payment.method, toast)
  }

  // No internet: the sale is kept on this till and sent later with the same request id (see LiveProvider).
  const saveOffline = (payload) => {
    const at = Date.now()
    const localNumber = `${me.name.slice(0, 1).toUpperCase()}-${String(at).slice(-5)}`
    const byId = new Map(lines.map((line) => [line.productId, line.product]))
    // Names kept with the sale so the backup log and the waiting list read clearly even without the catalogue.
    const named = payload.lines.map((line) => ({ name: byId.get(line.productId)?.name || line.productId, quantity: line.quantity }))
    if (!queueSale({ ...payload, at, shiftId: me.openShiftId || null, clientTotal: total, localNumber, items: named })) {
      toast('This device cannot keep offline sales (storage is blocked or full). Wait for the internet to come back.', 'error')
      return
    }
    finished({
      provisional: true, number: localNumber, at, status: 'completed', cashier: { uid: me.uid, name: me.name },
      customer: payload.customer, subtotal, total, returns: [],
      items: payload.lines.map((line) => { const product = byId.get(line.productId); return { productId: line.productId, name: product.name, size: product.size || '', unitPrice: product.price, quantity: line.quantity, lineTotal: product.price * line.quantity } }),
      discount: discountAmount ? { amount: discountAmount, reason: discount.reason } : null,
      payment: { method: pay.method, received, change: received - total, network: pay.method === 'momo' ? pay.network : null, reference: pay.reference.trim().toUpperCase() || null },
      tax: taxBreakdown(total, settings.tax),
    })
  }

  const complete = async () => {
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

  // MoMo prompt: the server prices the sale and charges the customer's phone; it saves the sale once they approve.
  const sendPrompt = () => momoPrompt.send({
    requestId: requestId.current,
    lines: lines.map(({ productId, quantity }) => ({ productId, quantity })),
    discount: discountAmount ? { type: discount.type, value: discountValue, reason: discount.reason } : null,
    customer: customer.name || customer.phone ? { name: customer.name, phone: customer.phone } : null,
    phone: pay.phone,
    network: promptNetwork(pay),
  })

  const reset = () => {
    momoPrompt.clear()
    setCart([]); setPay(EMPTY_PAY); setDiscount(EMPTY_DISCOUNT); setCustomer(EMPTY_CUSTOMER)
    setStep('sale'); setDone(null); setQuery(''); setLastAdded(null); setTicketOpen(false); setClearArmed(false)
    requestId.current = newId()
  }

  // ── Scanning: the USB scanner works anywhere on the page; scanning on the "done" screen starts the next sale ──
  const scan = useCallback((raw) => {
    const code = String(raw).trim().toUpperCase()
    const product = byCode.get(code)
    if (!product) { beep(false); toast(`No product has the code ${raw}. Link it in Products.`, 'error'); return }
    if (done) { reset(); setTimeout(() => add(product), 0); return }
    add(product)
  }, [add, byCode, toast, done]) // eslint-disable-line react-hooks/exhaustive-deps
  useHardwareScanner(scan, step === 'sale' && !panel)

  useEffect(() => {
    if (!clearArmed) return undefined
    const timer = setTimeout(() => setClearArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [clearArmed])

  // ── Hold and resume ──
  const hold = () => {
    if (!lines.length) return
    holdSale({ id: newId(), at: Date.now(), by: me.name, cart, discount, customer })
    toast('Sale put on hold. Resume it from Held.')
    reset()
  }
  const resume = (id) => {
    if (lines.length) holdSale({ id: newId(), at: Date.now(), by: me.name, cart, discount, customer })
    const entry = takeHeld(id)
    if (!entry) return
    reset()
    setCart(entry.cart.filter((line) => products.some((product) => product.id === line.productId)))
    setDiscount(entry.discount || EMPTY_DISCOUNT)
    setCustomer(entry.customer || EMPTY_CUSTOMER)
    setPanel(null)
  }

  // ── Products shown: priced products, in stock first. Unpriced drafts stay out of the till. ──
  const sellable = useMemo(() => products.filter((product) => product.price), [products])
  const hiddenDrafts = products.length - sellable.length
  const categories = useMemo(() => {
    const kinds = [...new Set(sellable.map((product) => product.category).filter(Boolean))].sort()
    const brands = [...new Set(sellable.map((product) => product.brand).filter(Boolean))].sort()
    return [{ value: 'all', label: 'All' }, ...kinds.map((kind) => ({ value: `c:${kind}`, label: kind })), ...brands.map((brand) => ({ value: `b:${brand}`, label: brand, brand: true }))]
  }, [sellable])
  const needle = query.trim().toLowerCase()
  const shown = sellable
    .filter((product) => category === 'all' || (category.startsWith('c:') ? product.category === category.slice(2) : product.brand === category.slice(2)))
    .filter((product) => !needle || `${product.name} ${product.brand} ${product.size} ${product.setup.sku || ''} ${product.setup.barcode || ''}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(available(b) > 0) - Number(available(a) > 0) || a.name.localeCompare(b.name))

  // ── What the customer screen shows (src/display/Display.jsx): only this sale, or in-stock products when idle ──
  const idle = useMemo(() => ({
    message: till.displayMessage,
    products: products
      .filter((product) => product.image && product.price && product.visible !== false && onShelf(product, Date.now()) > 0)
      .slice(0, 24)
      .map((product) => ({ id: product.id, name: product.name, detail: productDetail(product), image: product.image, price: product.price })),
  }), [products, till.displayMessage, onShelf])
  const displayShop = { name: shop?.legalName || 'SkinMatrix', phone: shop?.phone || '', website: 'skinmatrixgh.com' }
  const displayState = done
    ? { mode: 'done', shop: displayShop, idle, done: { number: done.number, total: done.total, change: done.payment.change || 0, method: done.payment.method, provisional: Boolean(done.provisional) } }
    : lines.length
      ? {
        mode: step === 'pay' ? 'paying' : 'cart',
        shop: displayShop, idle, lastAdded, units, subtotal, discount: discountAmount, total,
        lines: lines.map((line) => ({ id: line.productId, name: line.product.name, detail: productDetail(line.product), quantity: line.quantity, unitPrice: line.product.price, lineTotal: line.lineTotal, image: line.product.image || '' })),
        pay: {
          method: pay.method, received: received ?? 0, keyed: pay.method === 'cash' ? Boolean(pay.received) : true, change: received !== null && received >= total ? received - total : 0, momo: { number: till.momoNumber, name: till.momoName },
          prompt: promptMode ? { status: momoPrompt.prompt?.status || 'ask', phone: momoPrompt.prompt?.phone || '' } : null,
        },
      }
      : { mode: 'idle', shop: displayShop, idle }
  useCustomerDisplay(displayState, till.display)

  const swapTheScreens = async () => {
    try {
      const list = await swapScreens()
      if ((list?.screens || []).length < 2) toast(ONE_SCREEN_HELP, 'error')
      else toast('Swapped. The customer view is on the other screen now, and it stays that way.')
    } catch { toast('Could not swap the screens. Open Till setup → Customer screen.', 'error') }
  }

  const showCustomerScreen = async () => {
    const result = await openCustomerDisplay()
    if (result === 'none') toast(ONE_SCREEN_HELP, 'error')
    else if (result === 'blocked') toast('The browser blocked the customer screen. Allow pop-ups for this site, then press again.', 'error')
    else if (result === 'window') toast('Customer screen opened. Drag it onto the customer’s monitor, then tap it for full screen.')
  }

  // ── Screen ──
  const pending = offlineSales.length
  const problems = offlineSales.filter((entry) => entry.status === 'problem').length
  const warnings = tillWarnings({ online, offlineSales, backup, clockSkew })

  const ticket = <aside className={`pos-ticket ${ticketOpen ? 'is-open' : ''}`} aria-label="Current sale">
    <header className="pos-ticket-head">
      <button type="button" className="pos-icon-btn pos-only-phone" onClick={() => setTicketOpen(false)} aria-label="Back to products"><Icon name="back" size={22} /></button>
      <div className="grow">
        <h2>Current sale</h2>
        <p className="muted small">{units ? `${units} item${units === 1 ? '' : 's'}` : 'No items yet'}{customer.name ? ` · ${customer.name}` : ''}</p>
      </div>
      <button type="button" className="pos-chip-btn" onClick={() => setPanel('held')} disabled={!held.length}><Icon name="resume" size={16} /> Held{held.length ? ` (${held.length})` : ''}</button>
      <button type="button" className="pos-chip-btn" onClick={hold} disabled={!lines.length}><Icon name="pause" size={16} /> Hold</button>
    </header>

    <ol className="pos-lines">
      {lines.length ? lines.map((line) => <li key={line.productId} className={`pos-line ${line.productId === lastAdded ? 'is-new' : ''}`}>
        <span className="pos-line-name"><b>{line.product.name}</b><span className="muted small">{formatMoney(line.product.price)}{productDetail(line.product) ? ` · ${productDetail(line.product)}` : ''}</span></span>
        <span className="pos-stepper" role="group" aria-label={`How many ${line.product.name}`}>
          <button type="button" onClick={() => change(line.productId, -1)} aria-label={line.quantity === 1 ? `Remove ${line.product.name}` : 'One less'}><Icon name={line.quantity === 1 ? 'trash' : 'minus'} size={18} /></button>
          <output>{line.quantity}</output>
          <button type="button" onClick={() => change(line.productId, 1)} aria-label="One more"><Icon name="plus" size={18} /></button>
        </span>
        <b className="pos-line-total money">{formatMoney(line.lineTotal)}</b>
        {line.quantity > 1 ? <button type="button" className="pos-line-remove" onClick={() => remove(line.productId)} aria-label={`Remove all ${line.product.name}`}><Icon name="close" size={14} /></button> : null}
      </li>) : <li className="pos-empty">
        <Icon name="grid" size={34} />
        <b>Scan a barcode or tap a product</b>
        <span className="muted small">Items appear here and on the customer screen.</span>
      </li>}
    </ol>

    <footer className="pos-ticket-foot">
      <div className="pos-extras">
        <button type="button" className={`pos-extra ${discountAmount ? 'is-set' : ''}`} onClick={() => setPanel('discount')} disabled={!lines.length}><Icon name="percent" size={18} /> {discountAmount ? <>Discount <b>−{formatMoney(discountAmount)}</b></> : 'Discount'}</button>
        <button type="button" className={`pos-extra ${customer.name || customer.phone ? 'is-set' : ''}`} onClick={() => setPanel('customer')} disabled={!lines.length}><Icon name="user" size={18} /> {customer.name || customer.phone || 'Customer'}</button>
        <button type="button" className={`pos-extra danger ${clearArmed ? 'is-armed' : ''}`} onClick={() => (clearArmed ? reset() : setClearArmed(true))} disabled={!lines.length}><Icon name="trash" size={18} /> {clearArmed ? 'Tap to clear' : 'Clear'}</button>
      </div>
      <dl className="pos-sums">
        {discountAmount ? <><div><dt>Subtotal</dt><dd className="money">{formatMoney(subtotal)}</dd></div><div className="good-text"><dt>Discount</dt><dd className="money">−{formatMoney(discountAmount)}</dd></div></> : null}
        <div className="pos-total"><dt>Total</dt><dd className="money">{formatMoney(total)}</dd></div>
      </dl>
      <button type="button" className="pos-pay-btn" disabled={!lines.length} onClick={() => { touch(); setStep('pay') }}>
        <span>Pay</span><b className="money">{formatMoney(total)}</b>
      </button>
    </footer>
  </aside>

  return <div className="pos" data-step={step}>
    {!online ? <div className="pos-offline" role="status"><Icon name="wifiOff" size={16} /> No internet. Keep selling: sales are saved on this till{backup.available ? ', backed up on this computer,' : ''} and sent when it is back{pending ? ` (${pending} waiting)` : ''}.</div> : null}
    {warnings.map((item) => <div key={item.key} className={`pos-warning ${item.tone}`} role="alert"><Icon name="alertCircle" size={16} /> {item.text}</div>)}
    <header className="pos-head">
      <button type="button" className="pos-icon-btn" onClick={onMenu} aria-label="Menu"><Icon name="menu" size={22} /></button>
      <a href="#/home" className="pos-brand" aria-label="SkinMatrix home"><img src="/icons/icon-192.png" alt="" /><span>SkinMatrix</span></a>
      <label className="pos-search">
        <Icon name="search" size={20} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products or type a code" aria-label="Search products" enterKeyHint="search"
          onKeyDown={(event) => {
            if (event.key === 'Escape') { setQuery(''); event.currentTarget.blur(); return }
            if (event.key !== 'Enter') return
            event.preventDefault()
            const exact = byCode.get(query.trim().toUpperCase())
            if (exact) { add(exact); setQuery(''); return }
            if (shown.length === 1) { add(shown[0]); setQuery('') }
          }} />
        {query ? <button type="button" className="pos-search-clear" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="close" size={16} /></button> : null}
      </label>
      <button type="button" className="pos-icon-btn" onClick={() => setPanel('camera')} aria-label="Scan with the camera" title="Scan with the camera"><Icon name="camera" size={22} /></button>
      <div className="pos-status">
        <span className={`pos-pill ${online ? 'good' : 'bad'}`} title={online ? 'Online' : 'No internet'}><Icon name={online ? 'wifi' : 'wifiOff'} size={15} /><span className="pos-pill-text">{online ? 'Online' : 'Offline'}</span></span>
        {pending ? <button type="button" className={`pos-pill ${problems ? 'bad' : 'warn'}`} onClick={() => setPanel('offline')}>{pending} to send</button> : null}
        <a href="#/drawer" className={`pos-pill ${me.openShiftId ? 'good' : 'warn'}`}><Icon name="drawer" size={15} /><span className="pos-pill-text">{me.openShiftId ? 'Drawer open' : 'Drawer closed'}</span></a>
      </div>
      {till.display ? <button type="button" className="pos-icon-btn" onClick={showCustomerScreen} aria-label="Customer screen" title="Customer screen"><Icon name="screen" size={22} /></button> : null}
      {till.display && canSwapScreens() ? <button type="button" className="pos-icon-btn" onClick={swapTheScreens} aria-label="Swap screens" title="Swap screens: customer view on the other monitor"><Icon name="swap" size={22} /></button> : null}
      <button type="button" className="pos-icon-btn" onClick={() => setPanel('noSale')} aria-label="Open the cash drawer (no sale)" title="Open drawer (no sale)"><Icon name="drawer" size={22} /></button>
      <button type="button" className="pos-icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={22} /></button>
      <button type="button" className="pos-user" onClick={() => setPanel('user')} aria-label={`Signed in as ${me.name}`}><span className="avatar small" aria-hidden="true">{me.name.slice(0, 1)}</span><span className="pos-user-name">{me.name}</span></button>
    </header>

    <div className="pos-body">
      <section className="pos-catalog" aria-label="Products">
        <nav className="pos-cats" aria-label="Categories">
          {categories.map((item) => <button type="button" key={item.value} className={`pos-cat ${category === item.value ? 'on' : ''} ${item.brand ? 'brand' : ''}`} aria-pressed={category === item.value} onClick={() => setCategory(item.value)}>{item.label}</button>)}
        </nav>
        <div className="pos-grid">
          {!catalogLoaded ? <p className="muted pos-grid-note">Loading products…</p> : null}
          {catalogLoaded && !sellable.length ? <div className="pos-grid-note"><b>No products to sell yet.</b><p className="muted">Add products with a price in <a href="#/setup">Products</a>.</p></div> : null}
          {catalogLoaded && sellable.length && !shown.length ? <div className="pos-grid-note"><b>Nothing matches “{query}”.</b><button type="button" className="btn ghost" onClick={() => { setQuery(''); setCategory('all') }}>Show all products</button></div> : null}
          {shown.map((product) => {
            const left = available(product) - inCart(product.id)
            const count = inCart(product.id)
            const status = expiryStatus(product.stock?.nextExpiry, now)
            const low = left > 0 && left <= (product.setup.reorderPoint ?? 3)
            return <button type="button" key={product.id} className={`pos-tile ${count ? 'in-cart' : ''}`} disabled={left <= 0} onClick={() => add(product)}>
              <span className="pos-tile-art">{product.image ? <img src={product.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Icon name="products" size={34} />}</span>
              {count ? <span className="pos-tile-count" aria-label={`${count} in this sale`}>{count}</span> : null}
              <span className={`pos-tile-stock ${left <= 0 ? 'out' : low ? 'low' : ''}`}>{left <= 0 ? (count ? 'All in sale' : 'Out of stock') : `${left} left`}</span>
              <span className="pos-tile-name">{product.name}</span>
              <span className="pos-tile-detail">{productDetail(product) || ' '}</span>
              <span className="pos-tile-foot">
                <b className="money">{formatMoney(product.price)}</b>
                {['soon', 'urgent'].includes(status) ? <span className="pos-tile-expiry" title="Sell this one first">Exp {fmtExpiryMonth(product.stock.nextExpiry)}</span> : null}
              </span>
            </button>
          })}
          {hiddenDrafts && catalogLoaded && !needle && category === 'all' ? <p className="muted small pos-grid-note">{hiddenDrafts} product{hiddenDrafts === 1 ? ' has' : 's have'} no price yet, so {hiddenDrafts === 1 ? 'it is' : 'they are'} not shown here.</p> : null}
        </div>
      </section>
      {ticket}
    </div>

    {lines.length && !ticketOpen ? <button type="button" className="pos-phone-bar" onClick={() => setTicketOpen(true)}>
      <span><b>{units}</b> item{units === 1 ? '' : 's'}</span><span>View sale · <b className="money">{formatMoney(total)}</b></span>
    </button> : null}

    {step === 'pay' ? <PayScreen
      total={total} subtotal={subtotal} discountAmount={discountAmount} units={units} pay={pay} setPay={(next) => { touch(); setPay(next) }}
      received={received} ready={ready} busy={busy} blocker={blocker} drawerMissing={drawerMissing} online={online}
      onBack={() => setStep('sale')} onComplete={complete} momo={till}
      promptMode={promptMode} momoPrompt={momoPrompt} onSendPrompt={sendPrompt} /> : null}

    {done ? <DoneScreen sale={done} shop={shop} autoPrint={till.autoPrint} onPrint={() => printReceipt(done, shop)} onNext={reset} /> : null}

    {panel === 'discount' ? <DiscountDialog subtotal={subtotal} value={discount} role={role} onClose={() => setPanel(null)} onSave={(next) => { touch(); setDiscount(next); setPanel(null) }} /> : null}
    {panel === 'customer' ? <CustomerDialog value={customer} onClose={() => setPanel(null)} onSave={(next) => { touch(); setCustomer(next); setPanel(null) }} /> : null}
    {panel === 'held' ? <HeldDialog held={held} products={products} onResume={resume} onDrop={dropHeld} onClose={() => setPanel(null)} hasSale={lines.length > 0} /> : null}
    {panel === 'noSale' ? <NoSaleDialog onClose={() => setPanel(null)} /> : null}
    {panel === 'offline' ? <Dialog title="Sales waiting to send" onClose={() => setPanel(null)} sheet><OfflineSales /></Dialog> : null}
    {panel === 'camera' ? <CameraScanner onClose={() => setPanel(null)} onScan={(code) => { setPanel(null); scan(code) }} /> : null}
    {panel === 'user' ? <UserDialog me={me} online={online} pending={pending} onSignOut={signOut} onClose={() => setPanel(null)} /> : null}
  </div>
}

// ── Payment: method, then the amount on a big number pad ──
function PayScreen({ total, subtotal, discountAmount, units, pay, setPay, received, ready, busy, blocker, drawerMissing, online, onBack, onComplete, momo, promptMode, momoPrompt, onSendPrompt }) {
  const quick = quickCash(total)
  const changeDue = received !== null && received >= total ? received - total : null
  const [otp, setOtp] = useState('')
  const locked = momoPrompt.open // a prompt is on the customer's phone: finish or cancel it first
  const action = promptMode ? promptAction({ pay, momo: momoPrompt, otp, total, ready: !locked || momoPrompt.prompt?.status === 'otp', onSend: onSendPrompt }) : null
  const keyTarget = promptMode ? action.keypad : pay.method === 'cash' || (pay.method === 'momo' && pay.otherAmount) ? 'amount' : 'reference'
  const keyed = keyTarget === 'amount' ? pay.received : keyTarget === 'phone' ? pay.phone : keyTarget === 'otp' ? otp : pay.reference
  const setKeyed = (value) => {
    if (keyTarget === 'otp') setOtp(value)
    else if (keyTarget === 'phone') setPay({ ...pay, phone: value })
    else setPay(keyTarget === 'amount' ? { ...pay, received: value } : { ...pay, reference: value.toUpperCase() })
  }

  return <div className="pos-pay" role="dialog" aria-modal="true" aria-label="Take payment">
    <header className="pos-pay-head">
      <button type="button" className="pos-back" onClick={onBack} disabled={locked} title={locked ? 'Cancel the MoMo prompt first' : undefined}><Icon name="back" size={22} /> Back to sale</button>
      <div className="pos-pay-due"><span>Amount due · {units} item{units === 1 ? '' : 's'}{discountAmount ? ` · was ${formatMoney(subtotal)}` : ''}</span><b className="money">{formatMoney(total)}</b></div>
    </header>
    <div className="pos-pay-body">
      <section className="pos-pay-left">
        <div className="pos-methods" role="radiogroup" aria-label="How is the customer paying?">
          {METHODS.map((item) => <button type="button" key={item.value} role="radio" aria-checked={pay.method === item.value} className={`pos-method ${pay.method === item.value ? 'on' : ''}`} disabled={locked && pay.method !== item.value}
            onClick={() => setPay({ ...pay, method: item.value, received: '', reference: '', otherAmount: false })}>
            <Icon name={item.icon} size={26} /><span>{item.label}</span>
          </button>)}
        </div>

        {pay.method === 'cash' ? <div className="pos-pay-panel">
          <div className="pos-keyed"><span>Cash received</span><b className="money">GHS {keyedMoney(pay.received)}</b></div>
          <div className="pos-quick">{quick.map((amount) => <button type="button" key={amount} className={`pos-quick-btn ${parseCedis(pay.received) === amount ? 'on' : ''}`} onClick={() => setPay({ ...pay, received: (amount / 100).toFixed(2) })}>{amount === total ? 'Exact' : formatMoney(amount)}</button>)}</div>
          <div className={`pos-change ${changeDue !== null ? 'show' : ''}`}><span>{changeDue === null ? (pay.received ? `Still to pay ${formatMoney(total - (received || 0))}` : 'Change') : 'Give change'}</span><b className="money">{changeDue === null ? '—' : formatMoney(changeDue)}</b></div>
          {drawerMissing ? <p className="callout warn small"><Icon name="drawer" /> Open your cash drawer before taking cash. <a href="#/drawer">Open drawer</a></p> : null}
        </div> : null}

        {pay.method === 'momo' ? <div className="pos-pay-panel">
          {momoPrompt.ready ? <div className="segmented pos-momo-modes" role="radiogroup" aria-label="How the customer pays by MoMo">
            <button type="button" role="radio" aria-checked={pay.momoMode === 'prompt'} className={pay.momoMode === 'prompt' ? 'on' : ''} disabled={locked} onClick={() => setPay({ ...pay, momoMode: 'prompt' })}><Icon name="phone" size={16} /> Prompt on their phone</button>
            <button type="button" role="radio" aria-checked={pay.momoMode === 'manual'} className={pay.momoMode === 'manual' ? 'on' : ''} disabled={locked} onClick={() => setPay({ ...pay, momoMode: 'manual' })}>They send to the shop number</button>
          </div> : online && momoPrompt.known ? <p className="muted small">Phone prompts switch on once the Paystack key is added.</p> : null}
          {momoPrompt.ready && momoPrompt.testMode ? <p className="callout warn small"><Icon name="alertCircle" /> Paystack test mode: no real money moves.</p> : null}
        </div> : null}

        {pay.method === 'momo' && promptMode ? <div className="pos-pay-panel">
          <PromptPanel pay={pay} setPay={setPay} total={total} momo={momoPrompt} otp={otp} />
        </div> : null}

        {pay.method === 'momo' && !promptMode ? <div className="pos-pay-panel">
          <div className="pos-momo-info">
            <span className="muted">Customer sends</span><b className="money">{formatMoney(total)}</b>
            <span className="muted">to</span><b>{momo.momoNumber || 'the shop MoMo number'}{momo.momoName ? ` (${momo.momoName})` : ''}</b>
          </div>
          <div className="pos-networks">{MOMO_NETWORKS.map((network) => <button type="button" key={network} className={`pos-quick-btn ${pay.network === network ? 'on' : ''}`} onClick={() => setPay({ ...pay, network })}>{network}</button>)}</div>
          <label className="pos-field"><span>Transaction ID <em>from the payment message</em></span>
            <input value={pay.reference} onChange={(event) => setPay({ ...pay, reference: event.target.value.toUpperCase() })} autoComplete="off" spellCheck={false} placeholder="Key it in on the pad" />
          </label>
          <label className="check"><input type="checkbox" checked={pay.otherAmount} onChange={(event) => setPay({ ...pay, otherAmount: event.target.checked, received: '' })} /> The customer sent a different amount</label>
          {pay.otherAmount ? <div className="pos-keyed"><span>Amount received</span><b className="money">GHS {keyedMoney(pay.received)}</b></div> : null}
        </div> : null}

        {pay.method === 'card' ? <div className="pos-pay-panel">
          <div className="pos-momo-info"><span className="muted">Charge on the card machine</span><b className="money">{formatMoney(total)}</b></div>
          <label className="pos-field"><span>Card slip number <em>optional</em></span>
            <input value={pay.reference} onChange={(event) => setPay({ ...pay, reference: event.target.value.toUpperCase() })} autoComplete="off" spellCheck={false} />
          </label>
        </div> : null}
      </section>

      <section className="pos-pay-right">
        {promptMode ? (action.keypad
          ? <Keypad key={action.keypad} value={keyed} onChange={setKeyed} kind="digits" maxLength={action.keypad === 'phone' ? 10 : 12} onEnter={action.disabled ? undefined : action.onClick} />
          : <div className="pos-pay-hint muted">{momoPrompt.open ? 'The customer is approving on their phone.' : ' '}</div>)
          : pay.method === 'card' ? <div className="pos-pay-hint muted">When the card machine says approved, press Complete sale.</div>
            : <Keypad value={keyed} onChange={setKeyed} kind={keyTarget === 'amount' ? 'money' : 'digits'} maxLength={keyTarget === 'amount' ? 10 : 30} onEnter={ready ? onComplete : undefined} />}
        {!online ? <p className="small warn-text">No internet: this sale is saved on the till and sent later.</p> : null}
        {promptMode ? <>
          <button type="button" className="pos-complete" disabled={action.disabled} onClick={action.onClick}>{action.label}{action.sub ? <small>{action.sub}</small> : null}</button>
          {locked ? <div className="row wrap pos-prompt-actions">
            {momoPrompt.prompt?.status !== 'otp' ? <button type="button" className="btn secondary" disabled={momoPrompt.busy} onClick={onSendPrompt}>Send again</button> : null}
            <button type="button" className="btn ghost" onClick={() => { setOtp(''); momoPrompt.cancel() }}>Cancel</button>
          </div> : null}
        </> : <button type="button" className="pos-complete" disabled={!ready} onClick={onComplete}>
          {busy ? 'Saving…' : <>Complete sale{changeDue ? <small>Change {formatMoney(changeDue)}</small> : null}</>}
        </button>}
        {blocker ? <p className="pos-blocker small">{blocker}</p> : null}
      </section>
    </div>
  </div>
}

// ── After the sale: the change to give, the receipt, and the next customer ──
function DoneScreen({ sale, shop, autoPrint, onPrint, onNext }) {
  const nextRef = useRef(null)
  useEffect(() => { nextRef.current?.focus() }, [])
  const change = sale.payment.change || 0
  return <div className="pos-done" role="dialog" aria-modal="true" aria-label="Sale complete">
    <div className="pos-done-card">
      <span className="pos-done-mark"><Icon name="check" size={40} /></span>
      <h2>{sale.provisional ? 'Saved on this till' : 'Sale complete'}</h2>
      <p className="muted">{sale.provisional ? `Offline receipt ${sale.number} · sent when the internet is back` : `Receipt ${sale.number}`} · {formatMoney(sale.total)} by {PAID_BY[sale.payment.method] || sale.payment.method}</p>
      {change ? <div className="pos-done-change"><span>Give change</span><b className="money">{formatMoney(change)}</b></div> : <p className="pos-done-nochange">No change to give.</p>}
      <div className="pos-done-actions">
        <button type="button" className="pos-chip-btn big" onClick={onPrint}><Icon name="printer" size={18} /> {autoPrint ? 'Print again' : 'Print receipt'}</button>
        {sale.provisional ? null : <a className="pos-chip-btn big" href={whatsappReceiptLink(sale, shop)} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={18} /> WhatsApp</a>}
      </div>
      <button type="button" ref={nextRef} className="pos-next" onClick={onNext}>New sale</button>
      <p className="muted small">Or just scan the next customer’s first item.</p>
      <label className="check small"><input type="checkbox" checked={autoPrint} onChange={(event) => setTill({ autoPrint: event.target.checked })} /> Print the receipt by itself after every sale</label>
    </div>
    <PrintArea><Receipt sale={sale} shop={shop} /></PrintArea>
  </div>
}

function DiscountDialog({ subtotal, value, role, onClose, onSave }) {
  const [form, setForm] = useState(value)
  const amountValue = form.type === 'percent' ? Number.parseInt(form.value, 10) : parseCedis(form.value)
  const amount = amountValue > 0 ? (form.type === 'percent' ? Math.round((subtotal * Math.min(amountValue, 100)) / 100) : Math.min(amountValue, subtotal)) : 0
  const approval = amount > 0 && discountNeedsApproval(role, subtotal, amount)
  const valid = amount > 0 && form.reason.trim().length >= 3
  return <Dialog title="Discount" onClose={onClose} wide>
    <div className="pos-dialog-split">
      <div className="stack">
        <div className="pos-methods two" role="radiogroup" aria-label="Discount type">
          {[{ value: 'percent', label: 'Percent %' }, { value: 'amount', label: 'Amount GHS' }].map((item) => <button type="button" key={item.value} role="radio" aria-checked={form.type === item.value} className={`pos-method small ${form.type === item.value ? 'on' : ''}`} onClick={() => setForm({ ...form, type: item.value, value: '' })}>{item.label}</button>)}
        </div>
        <div className="pos-keyed"><span>{form.type === 'percent' ? 'Percent off' : 'Amount off'}</span><b className="money">{form.type === 'percent' ? `${form.value || 0}%` : `GHS ${keyedMoney(form.value)}`}</b></div>
        <p className="muted small">Takes <b>{formatMoney(amount)}</b> off {formatMoney(subtotal)}. {approval ? <span className="warn-text">More than {DISCOUNT_LIMIT[role]}%: a manager approves with their PIN when you complete the sale.</span> : `You can give up to ${DISCOUNT_LIMIT[role]}% yourself.`}</p>
        <span className="small strong">Reason</span>
        <div className="chip-row">{['Loyal customer', 'Promotion', 'Damaged box', 'Staff purchase'].map((preset) => <button type="button" key={preset} className={`chip ${form.reason === preset ? 'on' : ''}`} onClick={() => setForm({ ...form, reason: preset })}>{preset}</button>)}</div>
        <input aria-label="Reason for the discount" placeholder="Or type the reason" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
      </div>
      <div className="stack">
        <Keypad value={form.value} onChange={(next) => setForm({ ...form, value: next })} kind={form.type === 'percent' ? 'percent' : 'money'} maxLength={form.type === 'percent' ? 3 : 9} />
        <div className="row">
          {value.value ? <button type="button" className="btn ghost grow" onClick={() => onSave(EMPTY_DISCOUNT)}>Remove discount</button> : null}
          <button type="button" className="btn primary large grow" disabled={!valid} onClick={() => onSave(form)}>Apply</button>
        </div>
      </div>
    </div>
  </Dialog>
}

function CustomerDialog({ value, onClose, onSave }) {
  const [form, setForm] = useState(value)
  return <Dialog title="Customer (optional)" onClose={onClose}>
    <form className="stack" onSubmit={(event) => { event.preventDefault(); onSave({ name: form.name.trim(), phone: form.phone.trim() }) }}>
      <p className="muted small">Their name goes on the receipt. With a phone number you can send the receipt on WhatsApp.</p>
      <label className="field"><span>Name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={60} data-autofocus /></label>
      <label className="field"><span>Phone</span><input inputMode="tel" placeholder="024 123 4567" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} maxLength={20} /></label>
      <div className="row end">
        {value.name || value.phone ? <button type="button" className="btn ghost" onClick={() => onSave(EMPTY_CUSTOMER)}>Remove</button> : null}
        <button type="submit" className="btn primary large">Save</button>
      </div>
    </form>
  </Dialog>
}

function HeldDialog({ held, products, onResume, onDrop, onClose, hasSale }) {
  const now = useNow(30000)
  const byId = new Map(products.map((product) => [product.id, product]))
  return <Dialog title="Sales on hold" onClose={onClose} sheet>
    <div className="stack">
      {hasSale ? <p className="muted small">The sale on screen now goes on hold when you resume another one.</p> : null}
      {held.length ? <ul className="pos-held">{held.map((entry) => {
        const lines = entry.cart.map((line) => ({ ...line, product: byId.get(line.productId) })).filter((line) => line.product)
        const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0)
        const minutes = Math.max(0, Math.round((now - entry.at) / 60000))
        return <li key={entry.id}>
          <span className="grow"><b>{entry.customer?.name || `${lines.reduce((sum, line) => sum + line.quantity, 0)} item(s)`}</b><span className="muted small">{lines.map((line) => `${line.quantity}× ${line.product.name}`).join(', ')}</span><span className="muted small">{minutes < 1 ? 'Just now' : `${minutes} min ago`} · by {entry.by}</span></span>
          <b className="money">{formatMoney(total)}</b>
          <button type="button" className="btn primary" onClick={() => onResume(entry.id)}>Resume</button>
          <button type="button" className="icon-button" onClick={() => onDrop(entry.id)} aria-label="Delete this held sale"><Icon name="trash" /></button>
        </li>
      })}</ul> : <p className="muted">Nothing on hold.</p>}
    </div>
  </Dialog>
}

function UserDialog({ me, online, pending, onSignOut, onClose }) {
  const [sure, setSure] = useState(false)
  // Unsent offline sales belong to the person who made them: they send only while that person is signed in.
  const leave = () => (pending && !sure ? setSure(true) : onSignOut())
  return <Dialog title={me.name} onClose={onClose}>
    <div className="stack">
      <p className="muted small">{ROLE_LABEL[me.role]}{me.username ? ` · username ${me.username}` : ''}</p>
      {sure ? <p className="callout warn small"><Icon name="alertCircle" /> {pending} offline sale(s) by {me.name} have not reached the server yet. They stay safe on this till, but they are only sent while {me.name} is signed in here. Better: wait until the list of sales to send is empty.</p> : null}
      <button type="button" className={`btn ${sure ? 'danger' : 'primary'} large block`} disabled={!online} onClick={leave}><Icon name="switchUser" size={18} /> {sure ? 'Switch user anyway' : 'Switch user'}</button>
      {!online ? <p className="small warn-text">No internet: stay signed in. Signing back in needs the internet{pending ? `, and ${pending} sale(s) are still waiting to send` : ''}.</p> : <p className="muted small">The next person signs in with their own username and password. Held sales stay on this till.</p>}
      <div className="row wrap">
        <a className="btn secondary grow" href="#/account" onClick={onClose}><Icon name="user" size={16} /> My account</a>
        <a className="btn secondary grow" href="#/till" onClick={onClose}><Icon name="printer" size={16} /> Till setup</a>
      </div>
    </div>
  </Dialog>
}
