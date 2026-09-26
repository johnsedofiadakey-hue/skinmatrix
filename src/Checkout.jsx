import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, CircleAlert, Lock, MapPin, Minus, Plus, Store, Trash2, Truck, X } from 'lucide-react'
import { ArrowNext, ICON, ProductVisual, useSite } from './storefront'
import { formatGhs } from './cloud/site.js'
import { buildOrder, cartLines, checkDetails, newOrderRef, orderTotals, PAYMENT, saveOrder } from './cloud/orders.js'

// The whole checkout lives in one panel that slides in from the side. Its steps slide across inside it:
// 0 Cart -> 1 Your details -> 2 Review and pay -> 3 Done.

const DETAILS_KEY = 'skinmatrix-checkout-details'
const STEPS = ['Cart', 'Your details', 'Pay']
const EMPTY_DETAILS = { name: '', phone: '', email: '', method: 'delivery', address: '', notes: '' }

function loadPaystack() {
  if (window.PaystackPop) return Promise.resolve(window.PaystackPop)
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://js.paystack.co/v2/inline.js'
    script.onload = () => (window.PaystackPop ? resolve(window.PaystackPop) : reject(new Error('Paystack did not load')))
    script.onerror = () => reject(new Error('Paystack did not load'))
    document.head.appendChild(script)
  })
}

function readDetails() {
  try { return { ...EMPTY_DETAILS, ...JSON.parse(localStorage.getItem(DETAILS_KEY) || '{}'), notes: '' } } catch { return { ...EMPTY_DETAILS } }
}

function Field({ label, hint, error, children }) {
  return <label className={`checkout-field ${error ? 'has-error' : ''}`}>
    <span>{label}{hint ? <em>{hint}</em> : null}</span>
    {children}
    {error ? <small role="alert"><CircleAlert {...ICON} /> {error}</small> : null}
  </label>
}

export default function CheckoutDrawer() {
  const { content, products, cart, setQty, clear, cartOpen, checkoutStep: step, setCheckoutStep: setStep, closeCart, openProduct } = useSite()
  const { checkout, shop } = content
  const online = Boolean(checkout.paystackPublicKey)
  const [details, setDetails] = useState(readDetails)
  const [errors, setErrors] = useState({})
  const [phase, setPhase] = useState({ kind: 'idle' }) // idle | paying | saving | failed
  const [placed, setPlaced] = useState(null)
  const sheet = useRef(null)

  const lines = useMemo(() => cartLines(cart, products), [cart, products])
  const totals = orderTotals(lines, details.method, checkout.deliveryFee)
  const busy = phase.kind === 'paying' || phase.kind === 'saving'
  const feeText = details.method === 'pickup' ? 'Free' : totals.deliveryFee === null ? 'We tell you when we call' : formatGhs(totals.deliveryFee)

  useEffect(() => {
    const { notes, ...remember } = details
    try { localStorage.setItem(DETAILS_KEY, JSON.stringify(remember)) } catch { /* not remembered */ }
  }, [details])

  // Esc closes; the page behind does not scroll while the panel is open.
  useEffect(() => {
    if (!cartOpen) return undefined
    const onKey = (event) => { if (event.key === 'Escape' && !busy) closeCart() }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow }
  }, [cartOpen, busy, closeCart])

  // Move focus to the top of each new step.
  useEffect(() => {
    if (!cartOpen) return
    const pane = sheet.current?.querySelector(`[data-step="${step}"]`)
    pane?.scrollTo?.({ top: 0 })
    const timer = setTimeout(() => pane?.querySelector('h2')?.focus({ preventScroll: true }), 380)
    return () => clearTimeout(timer)
  }, [step, cartOpen])

  // An emptied cart goes back to step 0.
  useEffect(() => { if (!lines.length && (step === 1 || step === 2)) setStep(0) }, [lines.length, step, setStep])

  const update = (key) => (event) => { setDetails({ ...details, [key]: event.target.value }); if (errors[key]) setErrors({ ...errors, [key]: undefined }) }

  const goToPay = (event) => {
    event.preventDefault()
    const found = checkDetails(details, { needEmail: online, delivery: true })
    if (details.method === 'pickup' && !checkout.pickup) found.method = 'Pickup is not available right now. Choose delivery.'
    setErrors(found)
    if (Object.keys(found).length) {
      sheet.current?.querySelector('[data-step="1"] .has-error input, [data-step="1"] .has-error textarea')?.focus()
      return
    }
    setPhase({ kind: 'idle' })
    setStep(2)
  }

  const finish = async (payment, ref) => {
    const order = buildOrder({ ref, cart, products, details, checkout, payment })
    setPhase({ kind: 'saving' })
    try {
      await saveOrder(order)
      clear()
      setPlaced(order)
      setPhase({ kind: 'idle' })
      setStep(3)
    } catch {
      setPhase({ kind: 'failed', order, payment })
    }
  }

  const pay = async () => {
    if (phase.kind === 'failed') return finish(phase.payment, phase.order.ref)
    const ref = newOrderRef()
    if (!online) return finish({ method: PAYMENT.later, status: 'unpaid', reference: null }, ref)
    setPhase({ kind: 'paying' })
    try {
      const Paystack = await loadPaystack()
      new Paystack().newTransaction({
        key: checkout.paystackPublicKey,
        email: details.email.trim(),
        amount: totals.total,
        currency: 'GHS',
        reference: ref,
        metadata: { custom_fields: [{ display_name: 'Order', variable_name: 'order', value: ref }, { display_name: 'Phone', variable_name: 'phone', value: details.phone }] },
        onSuccess: (transaction) => finish({ method: PAYMENT.paystack, status: 'reported', reference: transaction?.reference || ref }, ref),
        onCancel: () => setPhase({ kind: 'idle', notice: 'Payment was cancelled. Your order has not been placed. You can try again.' }),
        onError: () => setPhase({ kind: 'idle', notice: 'Paystack could not start the payment. Please try again.' }),
      })
    } catch {
      setPhase({ kind: 'idle', notice: 'We could not open Paystack. Check your internet and try again.' })
    }
  }

  const close = () => { if (!busy) closeCart() }
  const tab = (index) => (cartOpen && step === index ? 0 : -1)

  return <aside className={`shop-panel checkout-drawer ${cartOpen ? 'open' : ''}`} aria-hidden={!cartOpen}>
    <button className="panel-backdrop" onClick={close} aria-label="Close checkout" tabIndex={-1} />
    <div ref={sheet} className="panel-sheet drawer-sheet" role="dialog" aria-modal="true" aria-label="Checkout">
      <header className="drawer-head">
        {step === 1 || step === 2
          ? <button className="drawer-icon" onClick={() => setStep(step - 1)} disabled={busy} aria-label="Back" tabIndex={cartOpen ? 0 : -1}><ArrowLeft {...ICON} /></button>
          : <span className="drawer-icon-space" />}
        <ol className="drawer-steps" aria-label="Checkout steps">
          {STEPS.map((label, index) => <li key={label} className={index < step ? 'done' : index === step ? 'current' : ''} aria-current={index === step ? 'step' : undefined}>
            <span className="step-dot">{index < step ? <Check {...ICON} /> : index + 1}</span><span className="step-label">{label}</span>
          </li>)}
        </ol>
        <button className="drawer-icon" onClick={close} disabled={busy} aria-label="Close checkout" tabIndex={cartOpen ? 0 : -1}><X {...ICON} /></button>
      </header>
      <div className="drawer-progress" aria-hidden="true"><i style={{ width: `${(Math.min(step, 2) + 1) / 3 * 100}%` }} /></div>

      <div className="drawer-viewport">
        <div className="drawer-track" style={{ transform: `translateX(-${step * 100}%)` }}>

          {/* 0 · Cart */}
          <section className="drawer-pane" data-step="0" inert={step !== 0 || !cartOpen ? true : undefined}>
            <div className="drawer-scroll">
              <h2 tabIndex={-1}>Your cart</h2>
              {lines.length ? <ul className="cart-lines">{lines.map((line) => {
                const product = products.find((item) => item.id === line.id)
                return <li className="cart-line" key={line.id}>
                  <button className="cart-line-art" onClick={() => openProduct(line.id)} aria-label={`See ${line.name}`}><ProductVisual product={product} /></button>
                  <div className="cart-line-info">
                    <span className="eyebrow">{line.brand}</span>
                    <b>{line.name}</b>
                    <small>{line.size ? `${line.size} · ` : ''}{formatGhs(line.price)} each</small>
                    <div className="qty" role="group" aria-label={`Quantity of ${line.name}`}>
                      <button onClick={() => setQty(line.id, line.qty - 1)} aria-label={line.qty === 1 ? 'Remove' : 'One less'}>{line.qty === 1 ? <Trash2 {...ICON} /> : <Minus {...ICON} />}</button>
                      <span aria-live="polite">{line.qty}</span>
                      <button onClick={() => setQty(line.id, line.qty + 1)} aria-label="One more" disabled={line.qty >= 20}><Plus {...ICON} /></button>
                    </div>
                  </div>
                  <b className="cart-line-total">{formatGhs(line.lineTotal)}</b>
                </li>
              })}</ul> : <div className="cart-empty"><p>Your cart is empty.</p><a className="button dark" href="/shop">Go to the shop <ArrowNext /></a></div>}
            </div>
            {lines.length ? <div className="drawer-foot">
              <div className="drawer-total"><span>Items total</span><b>{formatGhs(totals.subtotal)}</b></div>
              <p className="drawer-note">Delivery fee comes next.</p>
              <button className="button dark drawer-cta" onClick={() => setStep(1)} tabIndex={tab(0)}>Continue to checkout <ArrowNext /></button>
              <button className="drawer-link" onClick={close} tabIndex={tab(0)}>Keep shopping</button>
            </div> : null}
          </section>

          {/* 1 · Your details */}
          <form className="drawer-pane" data-step="1" onSubmit={goToPay} noValidate inert={step !== 1 || !cartOpen ? true : undefined}>
            <div className="drawer-scroll">
              <h2 tabIndex={-1}>Your details</h2>
              <Field label="Full name" error={errors.name}><input value={details.name} onChange={update('name')} autoComplete="name" /></Field>
              <Field label="Phone number" hint="We call you on this number" error={errors.phone}><input value={details.phone} onChange={update('phone')} inputMode="tel" autoComplete="tel" placeholder="024 123 4567" /></Field>
              <Field label="Email" hint={online ? 'For your payment receipt' : 'Optional'} error={errors.email}><input value={details.email} onChange={update('email')} type="email" inputMode="email" autoComplete="email" /></Field>
              <h3 className="drawer-subhead">How do you want to get it?</h3>
              <div className="method-choices" role="radiogroup" aria-label="Delivery or pickup">
                <label className={`method-choice ${details.method === 'delivery' ? 'on' : ''}`}>
                  <input type="radio" name="method" value="delivery" checked={details.method === 'delivery'} onChange={update('method')} />
                  <Truck {...ICON} /><span><b>Delivery</b><small>{Number.isInteger(checkout.deliveryFee) ? `Fee: ${formatGhs(checkout.deliveryFee)}` : 'Fee confirmed when we call'}</small></span>
                </label>
                {checkout.pickup ? <label className={`method-choice ${details.method === 'pickup' ? 'on' : ''}`}>
                  <input type="radio" name="method" value="pickup" checked={details.method === 'pickup'} onChange={update('method')} />
                  <Store {...ICON} /><span><b>Pick up at the shop</b><small>Free</small></span>
                </label> : null}
              </div>
              {errors.method ? <p className="checkout-error" role="alert"><CircleAlert {...ICON} /> {errors.method}</p> : null}
              {details.method === 'delivery'
                ? <Field label="Delivery address" hint="Add a landmark or GPS address" error={errors.address}><textarea rows={3} value={details.address} onChange={update('address')} autoComplete="street-address" /></Field>
                : <p className="pickup-info"><MapPin {...ICON} /> {shop.address || 'We send you the shop address when we call.'}{shop.hours ? ` · Open ${shop.hours}` : ''}</p>}
              <Field label="Note for us" hint="Optional"><textarea rows={2} value={details.notes} onChange={update('notes')} maxLength={500} /></Field>
            </div>
            <div className="drawer-foot">
              <div className="drawer-total"><span>Total so far</span><b>{formatGhs(totals.total)}</b></div>
              <button className="button dark drawer-cta" type="submit" tabIndex={tab(1)}>Review your order <ArrowNext /></button>
            </div>
          </form>

          {/* 2 · Review and pay */}
          <section className="drawer-pane" data-step="2" inert={step !== 2 || !cartOpen ? true : undefined}>
            <div className="drawer-scroll">
              <h2 tabIndex={-1}>Review and pay</h2>
              <div className="review-block">
                <div className="review-head"><b>Items</b><button className="drawer-link inline" onClick={() => setStep(0)} disabled={busy} tabIndex={tab(2)}>Change</button></div>
                <ul className="review-lines">{lines.map((line) => <li key={line.id}><span>{line.qty} × {line.name}</span><b>{formatGhs(line.lineTotal)}</b></li>)}</ul>
              </div>
              <div className="review-block">
                <div className="review-head"><b>{details.method === 'delivery' ? 'Delivery to' : 'Pickup'}</b><button className="drawer-link inline" onClick={() => setStep(1)} disabled={busy} tabIndex={tab(2)}>Change</button></div>
                <p>{details.name} · {details.phone}{details.email ? ` · ${details.email}` : ''}</p>
                <p className="muted-line">{details.method === 'delivery' ? details.address : (shop.address || 'At our shop')}</p>
              </div>
              <dl className="review-sum">
                <div><dt>Items</dt><dd>{formatGhs(totals.subtotal)}</dd></div>
                <div><dt>{details.method === 'pickup' ? 'Pickup' : 'Delivery'}</dt><dd>{feeText}</dd></div>
                <div className="summary-total"><dt>{online ? 'You pay now' : 'Total'}</dt><dd>{formatGhs(totals.total)}</dd></div>
              </dl>
              {totals.deliveryFee === null && details.method === 'delivery' ? <p className="drawer-note">You pay the delivery fee when your order arrives.</p> : null}
              {phase.notice ? <p className="checkout-error" role="alert"><CircleAlert {...ICON} /> {phase.notice}</p> : null}
              {phase.kind === 'failed' ? <p className="checkout-error" role="alert"><CircleAlert {...ICON} /> {phase.payment.status === 'reported'
                ? `Your payment went through (reference ${phase.payment.reference}), but we could not save your order. Press the button again. If it still fails, contact us with this reference.`
                : 'We could not send your order. Check your internet and press the button again.'}</p> : null}
            </div>
            <div className="drawer-foot">
              <button className="button dark drawer-cta" onClick={pay} disabled={busy || !lines.length} tabIndex={tab(2)}>
                {busy ? (phase.kind === 'paying' ? 'Opening Paystack…' : 'Sending your order…') : phase.kind === 'failed' ? 'Try again' : online ? <><Lock {...ICON} /> Pay {formatGhs(totals.total)}</> : <>Place order <ArrowNext /></>}
              </button>
              <p className="drawer-note">{online ? 'You pay safely with Paystack (card or mobile money).' : 'Online payment is not ready yet. We call you to arrange payment.'} By ordering you agree to our <a href="/terms" target="_blank" rel="noreferrer">terms</a>.</p>
            </div>
          </section>

          {/* 3 · Done */}
          <section className="drawer-pane" data-step="3" inert={step !== 3 || !cartOpen ? true : undefined}>
            <div className="drawer-scroll drawer-done">
              {placed ? <>
                <span className="done-icon"><Check {...ICON} /></span>
                <h2 tabIndex={-1}>Thank you, {placed.customer.name.split(' ')[0]}.</h2>
                <p className="done-ref">Your order number is <b>{placed.ref}</b>.</p>
                <p>{placed.payment.status === 'reported' ? `We have your payment of ${formatGhs(placed.total)}.` : `Total: ${formatGhs(placed.total)}. You have not paid yet.`}</p>
                <h3 className="drawer-subhead">What happens next</h3>
                <ol className="done-steps">
                  <li>We call you on <b>{placed.customer.phone}</b> to confirm.</li>
                  {placed.payment.status === 'reported' ? null : <li>We tell you how to pay.</li>}
                  <li>{placed.fulfilment.method === 'delivery' ? `We deliver to: ${placed.fulfilment.address}.` : 'You pick up your order at our shop.'}</li>
                </ol>
              </> : <h2 tabIndex={-1}>Thank you.</h2>}
            </div>
            <div className="drawer-foot">
              <button className="button dark drawer-cta" onClick={() => { closeCart(); setStep(0) }} tabIndex={tab(3)}>Keep shopping <ArrowNext /></button>
            </div>
          </section>
        </div>
      </div>
    </div>
  </aside>
}

