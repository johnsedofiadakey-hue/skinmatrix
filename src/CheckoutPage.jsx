import { useEffect, useMemo, useState } from 'react'
import { Check, CircleAlert, Lock, MapPin, Store, Truck } from 'lucide-react'
import { ArrowNext, CartPanel, ICON, ProductVisual, SiteFooter, SiteHeader, useSite } from './storefront'
import { formatGhs } from './cloud/site.js'
import { buildOrder, cartLines, checkDetails, newOrderRef, orderTotals, PAYMENT, saveOrder } from './cloud/orders.js'

const DETAILS_KEY = 'skinmatrix-checkout-details'

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

function Steps({ step }) {
  const steps = ['Cart', 'Your details', 'Pay']
  return <ol className="checkout-steps" aria-label="Checkout steps">
    {steps.map((label, index) => {
      const number = index + 1
      const state = number < step ? 'done' : number === step ? 'current' : 'next'
      return <li key={label} className={state} aria-current={state === 'current' ? 'step' : undefined}>
        <span className="step-dot">{state === 'done' ? <Check {...ICON} /> : number}</span>{label}
      </li>
    })}
  </ol>
}

function Field({ label, hint, error, children }) {
  return <label className={`checkout-field ${error ? 'has-error' : ''}`}>
    <span>{label}{hint ? <em>{hint}</em> : null}</span>
    {children}
    {error ? <small role="alert"><CircleAlert {...ICON} /> {error}</small> : null}
  </label>
}

export default function CheckoutPage() {
  const { content, products, cart, clear, openCart } = useSite()
  const { checkout, shop } = content
  const online = Boolean(checkout.paystackPublicKey)
  const [details, setDetails] = useState(() => {
    try { return { name: '', phone: '', email: '', method: 'delivery', address: '', notes: '', ...JSON.parse(localStorage.getItem(DETAILS_KEY) || '{}') } } catch { return { name: '', phone: '', email: '', method: 'delivery', address: '', notes: '' } }
  })
  const [errors, setErrors] = useState({})
  const [phase, setPhase] = useState({ kind: 'form' }) // form | paying | saving | done | failed
  const lines = useMemo(() => cartLines(cart, products), [cart, products])
  const totals = orderTotals(lines, details.method, checkout.deliveryFee)

  useEffect(() => { document.title = 'Checkout — SkinMatrix' }, [])
  useEffect(() => {
    const { notes, ...remember } = details
    try { localStorage.setItem(DETAILS_KEY, JSON.stringify(remember)) } catch { /* not remembered */ }
  }, [details])

  const update = (key) => (event) => { setDetails({ ...details, [key]: event.target.value }); if (errors[key]) setErrors({ ...errors, [key]: undefined }) }

  const finish = async (payment, ref) => {
    const order = buildOrder({ ref, cart, products, details, checkout, payment })
    setPhase({ kind: 'saving' })
    try {
      await saveOrder(order)
      clear()
      setPhase({ kind: 'done', order })
      window.scrollTo({ top: 0 })
    } catch {
      setPhase({ kind: 'failed', order, payment })
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    const found = checkDetails(details, { needEmail: online, delivery: true })
    if (details.method === 'pickup' && !checkout.pickup) found.method = 'Pickup is not available right now. Choose delivery.'
    setErrors(found)
    if (Object.keys(found).length) {
      document.querySelector('.checkout-field.has-error input, .checkout-field.has-error textarea')?.focus()
      return
    }
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
        onCancel: () => setPhase({ kind: 'form', notice: 'Payment was cancelled. Your order has not been placed. You can try again.' }),
        onError: () => setPhase({ kind: 'form', notice: 'Paystack could not start the payment. Please try again.' }),
      })
    } catch {
      setPhase({ kind: 'form', notice: 'We could not open Paystack. Check your internet and try again.' })
    }
  }

  if (phase.kind === 'done') {
    const { order } = phase
    return <main className="checkout-page">
      <SiteHeader base="/" />
      <section className="checkout-band"><Steps step={4} /></section>
      <section className="checkout-done">
        <span className="done-icon"><Check {...ICON} /></span>
        <h1>Thank you, {order.customer.name.split(' ')[0]}.</h1>
        <p className="done-ref">Your order number is <b>{order.ref}</b>. Please keep it.</p>
        <p>{order.payment.status === 'reported' ? `We have your payment of ${formatGhs(order.total)}.` : `Total: ${formatGhs(order.total)}. You have not paid yet.`}</p>
        <h2>What happens next</h2>
        <ol className="done-steps">
          <li>We call you on <b>{order.customer.phone}</b> to confirm your order.</li>
          {order.payment.status === 'reported' ? null : <li>We tell you how to pay.</li>}
          <li>{order.fulfilment.method === 'delivery' ? `We deliver to: ${order.fulfilment.address}.` : `You pick up your order at our shop${shop.address ? `: ${shop.address}` : ''}.`}{order.deliveryFee === null ? ' We tell you the delivery fee when we call.' : ''}</li>
        </ol>
        <a className="button dark" href="/shop">Back to the shop <ArrowNext /></a>
      </section>
      <SiteFooter />
    </main>
  }

  if (!lines.length) {
    return <main className="checkout-page">
      <SiteHeader base="/" />
      <section className="checkout-band"><Steps step={1} /></section>
      <section className="checkout-empty">
        <h1>Your cart is empty.</h1>
        <p>Add something from the shop first.</p>
        <a className="button dark" href="/shop">Go to the shop <ArrowNext /></a>
      </section>
      <SiteFooter />
      <CartPanel />
    </main>
  }

  const busy = phase.kind === 'paying' || phase.kind === 'saving'
  const feeText = details.method === 'pickup' ? 'Free' : totals.deliveryFee === null ? 'We tell you when we call' : formatGhs(totals.deliveryFee)

  return <main className="checkout-page">
    <SiteHeader base="/" />
    <section className="checkout-band">
      <Steps step={busy ? 3 : 2} />
      <h1>Checkout</h1>
    </section>

    <form className="checkout-layout" onSubmit={submit} noValidate>
      <div className="checkout-main">
        <fieldset className="checkout-card">
          <legend>Your details</legend>
          <Field label="Full name" error={errors.name}><input value={details.name} onChange={update('name')} autoComplete="name" /></Field>
          <Field label="Phone number" hint="We call you on this number" error={errors.phone}><input value={details.phone} onChange={update('phone')} inputMode="tel" autoComplete="tel" placeholder="024 123 4567" /></Field>
          <Field label="Email" hint={online ? 'For your payment receipt' : 'Optional'} error={errors.email}><input value={details.email} onChange={update('email')} type="email" inputMode="email" autoComplete="email" /></Field>
        </fieldset>

        <fieldset className="checkout-card">
          <legend>How do you want to get your order?</legend>
          <div className="method-choices" role="radiogroup" aria-label="Delivery or pickup">
            <label className={`method-choice ${details.method === 'delivery' ? 'on' : ''}`}>
              <input type="radio" name="method" value="delivery" checked={details.method === 'delivery'} onChange={update('method')} />
              <Truck {...ICON} /><span><b>Delivery</b><small>{feeText === 'We tell you when we call' ? 'Fee confirmed when we call' : `Fee: ${feeText}`}</small></span>
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
        </fieldset>
      </div>

      <aside className="checkout-card checkout-summary" aria-label="Order summary">
        <div className="summary-head"><h2>Your order</h2><button type="button" onClick={openCart}>Change</button></div>
        <ul>{lines.map((line) => {
          const product = products.find((item) => item.id === line.id)
          return <li key={line.id}><div className="summary-art"><ProductVisual product={product} /></div><span><b>{line.name}</b><small>{line.qty} × {formatGhs(line.price)}</small></span><b>{formatGhs(line.lineTotal)}</b></li>
        })}</ul>
        <dl>
          <div><dt>Items</dt><dd>{formatGhs(totals.subtotal)}</dd></div>
          <div><dt>{details.method === 'pickup' ? 'Pickup' : 'Delivery'}</dt><dd>{feeText}</dd></div>
          <div className="summary-total"><dt>{online ? 'You pay now' : 'Total'}</dt><dd>{formatGhs(totals.total)}</dd></div>
        </dl>
        {totals.deliveryFee === null && details.method === 'delivery' ? <p className="summary-note">You pay the delivery fee when your order arrives.</p> : null}
        {phase.notice ? <p className="checkout-error" role="alert"><CircleAlert {...ICON} /> {phase.notice}</p> : null}
        {phase.kind === 'failed' ? <p className="checkout-error" role="alert"><CircleAlert {...ICON} /> {phase.payment.status === 'reported'
          ? `Your payment went through (reference ${phase.payment.reference}), but we could not save your order. Press the button again. If it still fails, contact us with this reference.`
          : 'We could not send your order. Check your internet and press the button again.'}</p> : null}
        <button className="button dark checkout-pay" type={phase.kind === 'failed' ? 'button' : 'submit'} disabled={busy} onClick={phase.kind === 'failed' ? () => finish(phase.payment, phase.order.ref) : undefined}>
          {busy ? (phase.kind === 'paying' ? 'Opening Paystack…' : 'Sending your order…') : phase.kind === 'failed' ? 'Try again' : online ? <><Lock {...ICON} /> Pay {formatGhs(totals.total)}</> : 'Place order'}
        </button>
        <p className="summary-note">{online ? 'You pay safely with Paystack (card or mobile money). We never see your card details.' : 'Online payment is not ready yet. After you place your order, we call you to arrange payment.'}</p>
        <p className="summary-terms">By placing your order, you agree to our <a href="/terms" target="_blank" rel="noreferrer">terms and conditions</a>.</p>
      </aside>
    </form>

    <SiteFooter />
    <CartPanel />
  </main>
}
