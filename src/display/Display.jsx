// The customer display (second screen facing the customer). It has no sign-in and no internet connection of
// its own: the till sends it everything over a BroadcastChannel (see src/admin/till/display.js).
//
// DisplayState:
//   mode: 'idle' | 'cart' | 'paying' | 'done'
//   shop: { name, phone, website }
//   idle: { products: [{ id, name, image, price }], message }
//   lines: [{ id, name, detail, quantity, unitPrice, lineTotal, image }], lastAdded
//   units, subtotal, discount, total
//   pay: { method, received, change, momo: { number, name }, prompt: { status: 'ask' | 'waiting' | 'otp' | 'failed' | …, phone } | null }
//   done: { number, total, change, method, provisional }
import { useEffect, useRef, useState } from 'react'
import { formatMoney } from '../admin/lib/money.js'
import { DISPLAY_CHANNEL } from '../admin/till/display.js'

const LOGO = '/assets/skinmatrix-logo.png'
const DONE_FOR = 20000 // back to the welcome screen this long after "Thank you"
const PAID_BY = { cash: 'Cash', momo: 'Mobile money', card: 'Card' }

const money = (value) => (Number.isSafeInteger(value) ? formatMoney(value) : '')

export default function Display() {
  const [state, setState] = useState({ mode: 'idle' })
  const [connected, setConnected] = useState(false)
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement))
  const inDesktopApp = Boolean(window.skinmatrixTill)

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined
    const channel = new BroadcastChannel(DISPLAY_CHANNEL)
    channel.onmessage = (event) => {
      if (event.data?.type !== 'state') return
      setConnected(true)
      setState(event.data.state || { mode: 'idle' })
    }
    channel.postMessage({ type: 'hello' })
    // Ask again now and then, so the display recovers if the till page was reloaded.
    const timer = setInterval(() => channel.postMessage({ type: 'hello' }), 15000)
    return () => { clearInterval(timer); channel.close() }
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // "Thank you" stays up for a while, then the welcome screen comes back even if the cashier has not started a new sale.
  const [doneExpired, setDoneExpired] = useState(false)
  useEffect(() => {
    setDoneExpired(false)
    if (state.mode !== 'done') return undefined
    const timer = setTimeout(() => setDoneExpired(true), DONE_FOR)
    return () => clearTimeout(timer)
  }, [state])

  const mode = state.mode === 'done' && doneExpired ? 'idle' : state.mode
  const goFullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {})

  return <main className={`cd cd-${mode}`} onDoubleClick={goFullscreen}>
    {mode === 'idle' ? <Welcome state={state} /> : null}
    {mode === 'cart' || mode === 'paying' ? <Basket state={state} /> : null}
    {mode === 'done' ? <ThankYou state={state} /> : null}
    {!inDesktopApp && !fullscreen ? <button type="button" className="cd-fullscreen" onClick={goFullscreen}>Tap for full screen</button> : null}
    {!connected ? <p className="cd-waiting">Waiting for the till… Open the POS page on this computer.</p> : null}
  </main>
}

// Nobody is buying: the shop's welcome and a slideshow of products that are in stock right now (the till only
// sends priced, in-stock products with a photo). Each slide stays 7 seconds.
function Welcome({ state }) {
  const products = (state.idle?.products || []).filter((product) => product.image)
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (products.length < 2) return undefined
    const timer = setInterval(() => setIndex((value) => (value + 1) % products.length), 7000)
    return () => clearInterval(timer)
  }, [products.length])
  const product = products.length ? products[index % products.length] : null
  return <section className="cd-welcome">
    <div className="cd-welcome-brand">
      <img className="cd-logo" src={LOGO} alt={state.shop?.name || 'SkinMatrix'} />
      <h1>{state.idle?.message || 'Welcome. We are happy to help.'}</h1>
      {state.shop?.website || state.shop?.phone ? <p className="cd-contact">{[state.shop.website, state.shop.phone].filter(Boolean).join('  ·  ')}</p> : null}
    </div>
    {product ? <figure className="cd-feature" key={product.id}>
      <span className="cd-feature-tag">In stock today</span>
      <img src={product.image} alt="" referrerPolicy="no-referrer" />
      <figcaption><span><b className="cd-feature-name">{product.name}</b>{product.detail ? <small>{product.detail}</small> : null}</span>{product.price ? <b className="cd-feature-price">{money(product.price)}</b> : null}</figcaption>
      {products.length > 1 ? <span className="cd-dots" aria-hidden="true">{products.slice(0, 12).map((item, dot) => <i key={item.id} className={dot === index % Math.min(products.length, 12) ? 'on' : ''} />)}</span> : null}
    </figure> : null}
  </section>
}

function Basket({ state }) {
  const lines = state.lines || []
  const listRef = useRef(null)
  useEffect(() => {
    const row = listRef.current?.querySelector('.cd-line.is-new')
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [state.lastAdded, lines.length])
  const pay = state.pay || {}
  return <section className="cd-basket">
    <header className="cd-basket-head">
      <img className="cd-logo small" src={LOGO} alt={state.shop?.name || 'SkinMatrix'} />
      <span>Your items</span>
    </header>
    <ol className="cd-lines" ref={listRef}>
      {lines.map((line) => <li key={line.id} className={`cd-line ${line.id === state.lastAdded ? 'is-new' : ''}`}>
        <span className="cd-thumb">{line.image ? <img src={line.image} alt="" referrerPolicy="no-referrer" /> : null}</span>
        <span className="cd-line-name"><b>{line.name}</b>{line.detail ? <small>{line.detail}</small> : null}</span>
        <span className="cd-line-qty">{line.quantity} × {money(line.unitPrice)}</span>
        <b className="cd-line-total">{money(line.lineTotal)}</b>
      </li>)}
    </ol>
    <aside className="cd-summary">
      <div className="cd-rows">
        <div><span>{state.units} item{state.units === 1 ? '' : 's'}</span><span>{money(state.subtotal)}</span></div>
        {state.discount ? <div className="cd-discount"><span>Discount</span><span>−{money(state.discount)}</span></div> : null}
      </div>
      <div className="cd-total"><span>Total</span><b>{money(state.total)}</b></div>
      {state.mode === 'paying' ? <Payment pay={pay} total={state.total} /> : null}
    </aside>
  </section>
}

function Payment({ pay, total }) {
  if (pay.method === 'momo' && pay.prompt) return <PhonePrompt prompt={pay.prompt} total={total} />
  if (pay.method === 'momo') {
    return <div className="cd-pay">
      <span className="cd-pay-label">Pay with Mobile Money</span>
      {pay.momo?.number ? <><b className="cd-momo">{pay.momo.number}</b>{pay.momo.name ? <span>Name: {pay.momo.name}</span> : null}</> : <span>Ask the cashier for the shop’s MoMo number.</span>}
      <span className="cd-pay-amount">Amount: <b>{money(total)}</b></span>
    </div>
  }
  if (pay.method === 'card') return <div className="cd-pay"><span className="cd-pay-label">Card payment</span><span>Please follow the card machine.</span></div>
  return <div className="cd-pay">
    <span className="cd-pay-label">Cash</span>
    {pay.received ? <>
      <div className="cd-rows"><div><span>You gave</span><span>{money(pay.received)}</span></div></div>
      {pay.received >= total ? <div className="cd-change"><span>Your change</span><b>{money(pay.change)}</b></div> : <span>Still to pay: <b>{money(total - pay.received)}</b></span>}
    </> : <span>Please hand your cash to the cashier.</span>}
  </div>
}

// MoMo prompt: the cashier types the customer's number and the customer approves on their own phone.
function PhonePrompt({ prompt, total }) {
  if (['sending', 'waiting', 'otp'].includes(prompt.status)) {
    return <div className="cd-pay cd-prompt">
      <span className="cd-pay-label">Mobile Money</span>
      <b className="cd-prompt-title">Check your phone</b>
      <span>Enter your MoMo PIN to approve <b>{money(total)}</b>{prompt.phone ? <> on {prompt.phone}</> : null}.</span>
      {prompt.status === 'otp' ? <span>Read the code you received to the cashier.</span> : null}
    </div>
  }
  if (prompt.status === 'failed') {
    return <div className="cd-pay cd-prompt">
      <span className="cd-pay-label">Mobile Money</span>
      <b className="cd-prompt-title">Not approved</b>
      <span>The payment did not go through. Please speak to the cashier.</span>
    </div>
  }
  return <div className="cd-pay">
    <span className="cd-pay-label">Mobile Money</span>
    <span>Tell the cashier your MoMo number. You will get a prompt on your phone to approve <b>{money(total)}</b>.</span>
  </div>
}

function ThankYou({ state }) {
  const done = state.done || {}
  return <section className="cd-thanks">
    <img className="cd-logo" src={LOGO} alt={state.shop?.name || 'SkinMatrix'} />
    <h1>Thank you!</h1>
    <p className="cd-thanks-total">Paid {money(done.total)}{done.method ? ` by ${PAID_BY[done.method] || done.method}` : ''}</p>
    {done.change ? <div className="cd-change big"><span>Your change</span><b>{money(done.change)}</b></div> : null}
    {done.number ? <p className="muted">{done.provisional ? 'Offline receipt' : 'Receipt'} {done.number}</p> : null}
    <p className="cd-thanks-note">We look forward to seeing you again.</p>
  </section>
}
