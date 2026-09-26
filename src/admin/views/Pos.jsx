import { useEffect, useMemo, useRef, useState } from 'react'
import { useNow, useOps } from '../hooks.js'
import { HOLD_TTL_MS, MOMO_NETWORKS } from '../demo/opsStore.js'
import { expiryStatus, nextExpiry, onHand, stockStatus } from '../lib/stock.js'
import { formatMoney, parseCedis, sumPesewas } from '../lib/money.js'
import { buildCustomers, normalizePhone } from '../lib/customers.js'
import { discountAmount, discountPercent } from '../lib/pricing.js'
import { capability } from '../lib/permissions.js'
import { Icon, Money, Pill, Segmented, ServerNote } from '../components/ui.jsx'
import { fmtCountdown, fmtExpiryMonth, fmtFull, paymentLabel } from '../components/format.js'

const newKey = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
const VIEW_KEY = 'skinmatrix-ops-pos-view'
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid' } catch { return 'grid' } }

const METHODS = [
  { value: 'cash', label: 'Cash', key: 'C' },
  { value: 'momo_shop', label: 'MoMo to shop', key: 'M' },
  { value: 'momo_prompt', label: 'MoMo prompt', key: 'R' },
]

export default function Pos() {
  const { state, staff, run, toast, branchFilter } = useOps()
  const now = useNow(30000)
  const tillBranch = branchFilter !== 'all' ? branchFilter : staff.branchId
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [view, setView] = useState(readView)
  const [cart, setCart] = useState([])
  const [method, setMethod] = useState('cash')
  const [tendered, setTendered] = useState('')
  const [momo, setMomo] = useState({ reference: '', network: 'MTN', amount: '' })
  const [customer, setCustomer] = useState({ name: '', phone: '' })
  const [showCustomer, setShowCustomer] = useState(false)
  const [payer, setPayer] = useState({ phone: '', network: 'MTN' })
  const [phase, setPhase] = useState({ kind: 'cart' })
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [discount, setDiscount] = useState({ open: false, type: 'percent', value: '', reason: '' })
  const searchRef = useRef(null)
  const payRef = useRef(null)
  const keyHandler = useRef(null)

  // A cart belongs to one branch's stock: switching branch starts a new sale.
  useEffect(() => { setCart([]); setPhase({ kind: 'cart' }) }, [tillBranch])

  const variants = useMemo(() => state.catalog.filter((product) => product.active !== false).flatMap((product) => product.variants.map((variant) => ({ product, variant }))), [state.catalog])
  const byVariant = useMemo(() => new Map(variants.map((entry) => [entry.variant.id, entry])), [variants])
  const customers = useMemo(() => buildCustomers(state.orders), [state.orders])
  const categories = ['All', ...new Set(state.catalog.map((product) => product.category))]
  const needle = query.trim().toLowerCase()
  const results = variants.filter(({ product, variant }) =>
    (category === 'All' || product.category === category) &&
    (!needle || `${product.name} ${variant.name} ${variant.sku}`.toLowerCase().includes(needle)))

  const shelfOf = (variantId) => onHand(state, variantId, tillBranch, now)
  const inCart = (variantId) => cart.find((line) => line.variantId === variantId)?.quantity || 0
  const lines = cart.map((line) => {
    const { product, variant } = byVariant.get(line.variantId)
    return { ...line, product, variant, lineTotal: variant.price * line.quantity, shelf: shelfOf(line.variantId) ?? 0 }
  })
  const subtotal = sumPesewas(lines, (line) => line.lineTotal)
  const discountInput = discount.open && discount.value !== ''
    ? { type: discount.type, value: discount.type === 'percent' ? Number.parseInt(discount.value, 10) : parseCedis(discount.value), reason: discount.reason }
    : null
  const discountOff = discountInput ? discountAmount(subtotal, discountInput) : 0
  const discountValid = !discountInput || (discountOff > 0 && discount.reason.trim().length >= 3)
  const total = subtotal - (discountOff || 0)
  const staffLimit = capability(staff, 'discountLimitPct')
  const overLimit = discountOff > 0 && discountPercent(subtotal, discountOff) > staffLimit
  const units = lines.reduce((sum, line) => sum + line.quantity, 0)
  const cartSignature = JSON.stringify([cart, discountInput])
  // One idempotency key per checkout attempt: a retried request cannot double-sell, and a new attempt
  // (after a declined or cancelled MoMo prompt, or a changed cart) always gets a fresh key.
  const attemptKey = useMemo(() => newKey(), [cartSignature, method, tillBranch, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  const returning = customers.get(normalizePhone(customer.phone))

  const add = (variantId) => {
    if (inCart(variantId) >= (shelfOf(variantId) ?? 0)) return
    setCart((list) => list.some((line) => line.variantId === variantId)
      ? list.map((line) => line.variantId === variantId ? { ...line, quantity: line.quantity + 1 } : line)
      : [...list, { variantId, quantity: 1 }])
  }
  const change = (variantId, delta) => setCart((list) => list
    .map((line) => line.variantId === variantId ? { ...line, quantity: Math.min(line.quantity + delta, shelfOf(variantId) ?? 0) } : line)
    .filter((line) => line.quantity > 0))
  const remove = (variantId) => setCart((list) => list.filter((line) => line.variantId !== variantId))

  const clearSale = () => {
    setCart([]); setTendered(''); setMomo({ reference: '', network: 'MTN', amount: '' }); setCustomer({ name: '', phone: '' }); setShowCustomer(false)
    setPayer({ phone: '', network: 'MTN' }); setMethod('cash'); setPhase({ kind: 'cart' }); setAttempt((n) => n + 1)
    setDiscount({ open: false, type: 'percent', value: '', reason: '' })
    setTimeout(() => searchRef.current?.focus(), 0)
  }
  const chooseView = (next) => { setView(next); try { localStorage.setItem(VIEW_KEY, next) } catch { /* not remembered in private mode */ } }
  const chooseMethod = (next) => { setMethod(next); setTimeout(() => payRef.current?.focus(), 0) }

  const tenderedPesewas = parseCedis(tendered)
  const momoAmount = parseCedis(momo.amount)
  const ready = lines.length > 0 && !busy && discountValid && ({
    cash: tenderedPesewas !== null && tenderedPesewas >= total,
    momo_shop: momoAmount !== null && momoAmount >= total && /^[A-Za-z0-9.-]{6,30}$/.test(momo.reference.trim()),
    momo_prompt: /^0\d{9}$/.test(payer.phone.replace(/\D/g, '')),
  })[method]

  const pay = async (event) => {
    event?.preventDefault()
    if (!ready) return
    setBusy(true)
    if (method === 'momo_prompt') {
      const hold = await run((store, approval) => store.startMomoSale(staff, { branchId: tillBranch, lines: cart, customer, payerPhone: payer.phone, network: payer.network, discount: discountInput, approval, idempotencyKey: attemptKey }),
        (result) => `Stock held under ${result.reference}. Waiting for the customer.`)
      setBusy(false)
      if (hold) setPhase({ kind: 'momo', reference: hold.reference })
      return
    }
    const payment = method === 'cash'
      ? { method: 'cash', tendered: tenderedPesewas }
      : { method: 'momo', amountReceived: momoAmount, reference: momo.reference, network: momo.network }
    const order = await run((store, approval) => store.completeCounterSale(staff, { branchId: tillBranch, lines: cart, customer, payment, discount: discountInput, approval, idempotencyKey: attemptKey }),
      (result) => `${paymentLabel(result.payment, { short: true })} sale ${result.id} completed.`)
    setBusy(false)
    if (order) { setCart([]); setPhase({ kind: 'receipt', orderId: order.id }) }
  }

  // Keyboard control for desktop tills. Re-created every render so it sees the current state; one stable listener calls it.
  keyHandler.current = (event) => {
    if (event.altKey || document.querySelector('.dialog-layer')) return
    const tag = (event.target?.tagName || '').toLowerCase()
    const typing = ['input', 'textarea', 'select'].includes(tag)
    const key = event.key
    if (phase.kind === 'receipt') {
      if (typing) return
      if (key === 'n' || key === 'N' || key === 'Enter') { event.preventDefault(); clearSale() }
      if (key === 'p' || key === 'P') { event.preventDefault(); window.print() }
      return
    }
    if (phase.kind !== 'cart') return
    if (key === 'F2' || (!typing && key === '/')) { event.preventDefault(); searchRef.current?.focus(); return }
    if (key === 'F8' || (key === 'Enter' && (event.ctrlKey || event.metaKey))) { if (cart.length) { event.preventDefault(); payRef.current?.focus() } return }
    if (key === 'Escape' && event.target === searchRef.current) { if (query) setQuery(''); else searchRef.current.blur(); return }
    // A barcode scanner types into whatever has focus; send stray digits to the search box.
    if (!typing && /^\d$/.test(key) && !event.ctrlKey && !event.metaKey) { event.preventDefault(); searchRef.current?.focus(); setQuery((current) => current + key); return }
    if (typing || !cart.length || event.ctrlKey || event.metaKey) return
    const next = METHODS.find((option) => option.key === key.toUpperCase())
    if (next) { event.preventDefault(); chooseMethod(next.value) }
  }
  useEffect(() => {
    const onKey = (event) => keyHandler.current?.(event)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const quickCash = [...new Set([total, ...[1000, 2000, 5000, 10000, 20000].map((step) => Math.ceil((total + 1) / step) * step)])]
    .filter((amount) => amount >= total && amount > 0).slice(0, 5)

  return <div className="pos-layout">
    <section className="pos-catalog" aria-label="Products">
      <div className="pos-toolbar">
        <div className="row">
          <label className="search grow">
            <Icon name="search" />
            <input ref={searchRef} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product, size or SKU" aria-label="Search products"
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || phase.kind !== 'cart') return
                event.preventDefault()
                // A scanner types the barcode and presses Enter: an exact barcode or SKU wins over a text match.
                const code = query.trim().toUpperCase()
                const exact = variants.find(({ variant }) => variant.barcode === code || variant.sku === code)
                const match = exact || (results.length ? results[0] : null)
                if (!match) { toast(`No product with barcode or SKU ${query.trim()}.`, 'error'); return }
                if (inCart(match.variant.id) >= (shelfOf(match.variant.id) ?? 0)) toast(`No more ${match.product.name} on the shelf.`, 'error')
                add(match.variant.id)
                setQuery('')
              }} />
            <kbd className="kbd hide-touch">/</kbd>
            {query ? <button type="button" className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><Icon name="close" size={16} /></button> : null}
          </label>
          <Segmented label="Layout" value={view} onChange={chooseView} options={[{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }]} />
        </div>
        <Segmented label="Category" value={category} onChange={setCategory} options={categories.map((item) => ({ value: item, label: item }))} />
      </div>
      <div className="till-branch">
        <span>Selling from</span><b>{state.branches.find((branch) => branch.id === tillBranch)?.name}</b>
        <span className="muted">· this branch's shelf only · soonest expiry sells first</span>
      </div>
      <div className={view === 'list' ? 'product-list' : 'product-grid'}>
        {results.map(({ product, variant }) => {
          const shelf = shelfOf(variant.id)
          const status = stockStatus(shelf, product.reorderPoint)
          // While a MoMo prompt is open its units are already off the shelf, so don't subtract the cart again.
          const left = (shelf ?? 0) - (phase.kind === 'cart' ? inCart(variant.id) : 0)
          const disabled = phase.kind !== 'cart' || left <= 0
          const stockText = status === 'unlisted' ? 'Not stocked here' : status === 'out' ? 'Out of stock' : `${left} on shelf`
          const expiry = nextExpiry(state, variant.id, tillBranch, now)
          const expiryFlag = expiry && ['soon', 'urgent'].includes(expiryStatus(expiry, now)) ? `Sell first · exp ${fmtExpiryMonth(expiry)}` : null
          return <button type="button" key={variant.id} className={`product-tile ${status}`} disabled={disabled} onClick={() => add(variant.id)}
            aria-label={`${product.name}, ${variant.name}, ${formatMoney(variant.price)}, ${stockText}${expiryFlag ? `, ${expiryFlag}` : ''}${inCart(variant.id) ? `, ${inCart(variant.id)} in cart` : ''}`}>
            <span className="tile-top">
              <span className="tile-cat">{product.category}{product.walkInOnly ? <span className="tile-flag">Counter only</span> : null}</span>
              {inCart(variant.id) ? <span className="tile-count">{inCart(variant.id)} in cart</span> : null}
            </span>
            <b className="tile-name">{product.name}</b>
            <span className="tile-variant">{variant.name} · <span className="mono">{variant.sku}</span></span>
            {expiryFlag ? <span className="tile-expiry">{expiryFlag}</span> : null}
            <span className="tile-foot">
              <Money value={variant.price} className="tile-price" />
              <span className={`tile-stock ${status}`}>{stockText}</span>
            </span>
          </button>
        })}
        {!results.length ? <p className="muted">No products match “{query}”.</p> : null}
      </div>
      <p className="shortcut-bar hide-touch" aria-label="Keyboard shortcuts">
        <span><kbd className="kbd">/</kbd> Search</span><span>Scan a barcode any time</span><span><kbd className="kbd">Enter</kbd> Add first match</span><span><kbd className="kbd">F8</kbd> Pay</span>
        <span><kbd className="kbd">C</kbd> Cash</span><span><kbd className="kbd">M</kbd> MoMo to shop</span><span><kbd className="kbd">R</kbd> MoMo prompt</span>
        <span><kbd className="kbd">N</kbd> New sale</span><span><kbd className="kbd">P</kbd> Print</span>
      </p>
    </section>

    <aside className="till" aria-label="Current sale">
      {phase.kind === 'receipt'
        ? <Receipt orderId={phase.orderId} onNew={clearSale} />
        : phase.kind === 'momo'
          ? <MomoWait reference={phase.reference} onBack={() => { setAttempt((n) => n + 1); setPhase({ kind: 'cart' }) }} onSettled={(orderId) => { setCart([]); setPhase({ kind: 'receipt', orderId }) }} />
          : <>
            <header className="till-head">
              <h2>Current sale</h2>
              {lines.length ? <button type="button" className="btn ghost small" onClick={() => setCart([])}>Clear</button> : null}
            </header>
            <div className="till-lines">
              {lines.length ? lines.map((line) => <div className="till-line" key={line.variantId}>
                <div className="till-line-main">
                  <b>{line.product.name}</b>
                  <span className="muted small">{line.variant.name} · {formatMoney(line.variant.price)} each</span>
                </div>
                <div className="qty" role="group" aria-label={`Quantity of ${line.product.name}`}>
                  <button type="button" onClick={() => change(line.variantId, -1)} aria-label="One fewer"><Icon name="minus" size={16} /></button>
                  <span aria-live="polite">{line.quantity}</span>
                  <button type="button" onClick={() => change(line.variantId, 1)} disabled={line.quantity >= line.shelf} aria-label="One more"><Icon name="plus" size={16} /></button>
                </div>
                <Money value={line.lineTotal} className="till-line-total" />
                <button type="button" className="icon-button subtle" onClick={() => remove(line.variantId)} aria-label={`Remove ${line.product.name}`}><Icon name="trash" size={16} /></button>
              </div>) : <p className="till-empty">Search or tap a product to start a sale.<br /><span className="muted small">Press Enter in search to add the first match.</span></p>}
            </div>

            <div className="till-total">
              <span>{units} item{units === 1 ? '' : 's'}{discountOff ? <span className="block small">Subtotal {formatMoney(subtotal)} · −{formatMoney(discountOff)}</span> : null}</span>
              <Money value={total} className="grand" />
            </div>

            {lines.length ? <div className="till-section">
              <button type="button" className="disclosure" aria-expanded={discount.open} onClick={() => setDiscount({ ...discount, open: !discount.open })}>
                <Icon name="tag" size={16} /> Discount <span className="muted">{discountOff ? `−${formatMoney(discountOff)}` : '(optional)'}</span><span className="disclosure-mark">{discount.open ? '−' : '+'}</span>
              </button>
              {discount.open ? <>
                <div className="field-row">
                  <Segmented label="Discount type" value={discount.type} onChange={(type) => setDiscount({ ...discount, type, value: '' })} options={[{ value: 'percent', label: '%' }, { value: 'amount', label: 'GHS' }]} />
                  <label className="field"><span className="sr-only">Discount value</span><input inputMode="decimal" value={discount.value} onChange={(event) => setDiscount({ ...discount, value: event.target.value })} placeholder={discount.type === 'percent' ? 'e.g. 10' : '0.00'} aria-invalid={discount.value !== '' && !discountOff} /></label>
                </div>
                <div className="chip-row">{['Loyal customer', 'Bundle offer', 'Damaged packaging', 'Staff purchase'].map((reason) => <button type="button" key={reason} className={`chip ${discount.reason === reason ? 'on' : ''}`} onClick={() => setDiscount({ ...discount, reason })}>{reason}</button>)}</div>
                <label className="field"><span>Reason <em>required</em></span><input value={discount.reason} onChange={(event) => setDiscount({ ...discount, reason: event.target.value })} /></label>
                {overLimit ? <p className="warn-text small">Over your {staffLimit}% limit — a manager will approve with their PIN when you take payment.</p> : <p className="muted small">You can give up to {staffLimit}% without approval.</p>}
              </> : null}
            </div> : null}

            <div className="till-section">
              <button type="button" className="disclosure" aria-expanded={showCustomer} onClick={() => setShowCustomer((open) => !open)}>
                Customer <span className="muted">(optional)</span><span className="disclosure-mark">{showCustomer ? '−' : '+'}</span>
              </button>
              {showCustomer ? <>
                <div className="field-row">
                  <label className="field"><span>Phone</span><input inputMode="tel" value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} placeholder="024 000 0000" /></label>
                  <label className="field"><span>Name</span><input value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })} /></label>
                </div>
                {returning ? <div className="returning">
                  <span><b>Returning customer{returning.name ? ` · ${returning.name}` : ''}</b><span className="muted small block">{returning.orders} paid order{returning.orders === 1 ? '' : 's'} · {formatMoney(returning.spend)} lifetime</span></span>
                  {returning.name && !customer.name ? <button type="button" className="btn ghost small" onClick={() => setCustomer({ ...customer, name: returning.name })}>Use name</button> : null}
                </div> : null}
              </> : null}
            </div>

            <form className="till-section" onSubmit={pay}>
              <Segmented label="Payment method" value={method} onChange={chooseMethod} options={METHODS.map((option) => ({ value: option.value, label: option.label }))} />
              {method === 'cash' ? <>
                <label className="field">
                  <span>Cash received (GHS)</span>
                  <input ref={payRef} className="big-input" inputMode="decimal" value={tendered} onChange={(event) => setTendered(event.target.value)} placeholder="0.00" aria-invalid={tendered !== '' && tenderedPesewas === null} />
                </label>
                <div className="chip-row">
                  {quickCash.map((amount) => <button type="button" key={amount} className="chip" onClick={() => setTendered((amount / 100).toFixed(2))}>{amount === total ? 'Exact' : formatMoney(amount)}</button>)}
                </div>
                <ChangeDue received={tenderedPesewas} total={total} show={lines.length > 0} />
                <button type="submit" className="btn primary block large" disabled={!ready}>{busy ? 'Recording sale…' : `Complete cash sale · ${formatMoney(total)}`}</button>
                <ServerNote contract="posCounterSale">prices, stock (first expiry first) and the sale are checked and recorded in one transaction</ServerNote>
              </> : null}
              {method === 'momo_shop' ? <>
                <p className="muted small">The customer sends the money to this shop's MoMo number. Copy the details from the confirmation message.</p>
                <div className="field-row">
                  <label className="field"><span>Transaction ID</span><input ref={payRef} value={momo.reference} onChange={(event) => setMomo({ ...momo, reference: event.target.value })} placeholder="From the SMS" autoComplete="off" /></label>
                  <label className="field"><span>Network</span><select value={momo.network} onChange={(event) => setMomo({ ...momo, network: event.target.value })}>{MOMO_NETWORKS.map((network) => <option key={network}>{network}</option>)}</select></label>
                </div>
                <label className="field"><span>Amount received (GHS)</span>
                  <input className="big-input" inputMode="decimal" value={momo.amount} onChange={(event) => setMomo({ ...momo, amount: event.target.value })} placeholder="0.00" />
                </label>
                {total ? <div className="chip-row"><button type="button" className="chip" onClick={() => setMomo({ ...momo, amount: (total / 100).toFixed(2) })}>Exact · {formatMoney(total)}</button></div> : null}
                <ChangeDue received={momoAmount} total={total} show={lines.length > 0 && momo.amount !== ''} />
                <button type="submit" className="btn primary block large" disabled={!ready}>{busy ? 'Recording sale…' : `Record MoMo sale · ${formatMoney(total)}`}</button>
                <ServerNote contract="posCounterSale">a transaction ID can only ever be recorded once, so one payment can't pay for two sales</ServerNote>
              </> : null}
              {method === 'momo_prompt' ? <>
                <div className="field-row">
                  <label className="field"><span>Payer MoMo number</span><input ref={payRef} inputMode="tel" value={payer.phone} onChange={(event) => setPayer({ ...payer, phone: event.target.value })} placeholder="024 000 0000" /></label>
                  <label className="field"><span>Network</span><select value={payer.network} onChange={(event) => setPayer({ ...payer, network: event.target.value })}>{MOMO_NETWORKS.map((network) => <option key={network}>{network}</option>)}</select></label>
                </div>
                <button type="submit" className="btn primary block large" disabled={!ready}>{busy ? 'Holding stock…' : `Hold stock and send prompt · ${formatMoney(total)}`}</button>
                <ServerNote contract="posStartMomo">stock is reserved for {Math.round(HOLD_TTL_MS / 60000)} minutes before the prompt is sent; nothing is sold until the payment is verified</ServerNote>
              </> : null}
            </form>
          </>}
    </aside>
  </div>
}

function ChangeDue({ received, total, show }) {
  if (!show || received === null) return null
  const short = received < total
  return <div className={`change-due ${short ? 'short' : ''}`}>
    <span>{short ? 'Still to collect' : 'Change to give'}</span>
    <Money value={Math.abs(received - total)} />
  </div>
}

function MomoWait({ reference, onBack, onSettled }) {
  const { state, staff, run } = useOps()
  const now = useNow(1000)
  const hold = state.holds.find((candidate) => candidate.reference === reference)

  useEffect(() => {
    if (hold?.status === 'consumed') onSettled(hold.orderId)
  }, [hold?.status, hold?.orderId, onSettled])

  if (!hold) return null
  const simulate = (amount) => run((store) => store.settleMomoPayment({ reference, amount }), (result) =>
    result.outcome === 'sale' ? `Payment verified. Sale ${result.order.id} recorded.` : result.outcome === 'duplicate' ? 'Already settled — no second sale.' : 'Payment did not match a usable hold. Logged as a payment exception.')

  return <div className="momo-wait">
    <header className="till-head"><h2>MoMo prompt</h2><span className="mono small">{reference}</span></header>
    <div className="till-total"><span>{hold.payer.network} · {hold.payer.phone}</span><Money value={hold.amount} className="grand" /></div>

    {hold.status === 'reserved' ? <>
      <div className="momo-status">
        <span className="pulse" aria-hidden="true" />
        <div><b>Waiting for the customer to approve</b><p className="muted small">Stock for this sale is held off the shelf. Hold expires in <b>{fmtCountdown(hold.expiresAt - now)}</b>.</p></div>
      </div>
      <div className="sim-box">
        <p className="sim-title"><Pill tone="amber">Demo</Pill> Simulate the payment provider's response</p>
        <div className="sim-actions">
          <button type="button" className="btn secondary" onClick={() => simulate(hold.amount)}>Customer approved</button>
          <button type="button" className="btn secondary" onClick={() => run((store) => store.releaseMomoHold(null, { reference, reason: 'declined' }), 'Declined. Held stock returned to the shelf.')}>Declined</button>
          <button type="button" className="btn secondary" onClick={() => simulate(hold.amount - 100)}>Wrong amount paid</button>
        </div>
      </div>
      <button type="button" className="btn ghost block" onClick={() => run((store) => store.releaseMomoHold(staff, { reference, reason: 'cancelled' }), 'Prompt cancelled. Held stock returned.')}>Cancel prompt and release stock</button>
      <ServerNote contract="posSettleMomo / posReleaseMomo">only a verified payment consumes the hold, exactly once; decline, cancel or expiry returns the exact units once</ServerNote>
    </> : null}

    {hold.status === 'released' ? <>
      <div className="callout warn">
        <Icon name="alert" />
        <p><b>No sale was made.</b> The hold was {hold.releaseReason} and its stock is back on the shelf. The cart is still here, so you can try again or take another payment method.</p>
      </div>
      <div className="sim-box">
        <p className="sim-title"><Pill tone="amber">Demo</Pill> What if the payment arrives now?</p>
        <button type="button" className="btn secondary" onClick={() => simulate(hold.amount)}>Simulate late payment</button>
        <p className="muted small">It becomes a payment exception for a manager to resolve. No sale is created and stock does not move.</p>
      </div>
      <button type="button" className="btn primary block" onClick={onBack}>Back to the sale</button>
    </> : null}
  </div>
}

function Receipt({ orderId, onNew }) {
  const { state, branchName } = useOps()
  const order = state.orders.find((candidate) => candidate.id === orderId)
  if (!order) return null
  const received = order.payment.method === 'cash' ? order.payment.tendered : order.payment.amountReceived
  return <div className="receipt-wrap">
    <div className="receipt" aria-label={`Receipt for ${order.id}`}>
      <p className="receipt-demo">Demo receipt · not a tax document</p>
      <h2>SkinMatrix</h2>
      <p className="muted small">{branchName(order.branchId)} · served by {order.createdBy.name}</p>
      <p className="muted small">{fmtFull(order.createdAt)}</p>
      <p className="receipt-id mono">{order.id}</p>
      <table className="receipt-lines"><tbody>
        {order.items.map((item) => <tr key={item.variantId}><td>{item.quantity} × {item.name}<span className="muted small"> {item.variantName}</span></td><td><Money value={item.lineTotal} /></td></tr>)}
      </tbody></table>
      {order.discount ? <>
        <div className="receipt-row"><span>Subtotal</span><Money value={order.subtotal} /></div>
        <div className="receipt-row"><span>Discount ({order.discount.reason})</span><span>−<Money value={order.discount.amount} /></span></div>
      </> : null}
      <div className="receipt-total"><span>Total</span><Money value={order.total} /></div>
      <dl className="receipt-meta">
        <dt>Paid by</dt><dd>{paymentLabel(order.payment, { short: true })}{order.payment.network ? ` · ${order.payment.network}` : ''}</dd>
        {received !== undefined ? <><dt>Received</dt><dd><Money value={received} /></dd><dt>Change</dt><dd><Money value={order.payment.change || 0} /></dd></> : null}
        {order.payment.reference ? <><dt>Reference</dt><dd className="mono">{order.payment.reference}</dd></> : null}
        {order.customer?.name ? <><dt>Customer</dt><dd>{order.customer.name}</dd></> : null}
      </dl>
      <p className="receipt-thanks">Thank you for shopping with SkinMatrix.</p>
    </div>
    <div className="stack">
      <button type="button" className="btn primary block large" autoFocus onClick={onNew}>New sale <kbd className="kbd on-dark hide-touch">N</kbd></button>
      <div className="row">
        <a className="btn secondary grow" href={`#/orders/${order.id}`}>Open order</a>
        <button type="button" className="btn secondary grow" onClick={() => window.print()}>Print <kbd className="kbd hide-touch">P</kbd></button>
      </div>
    </div>
  </div>
}
