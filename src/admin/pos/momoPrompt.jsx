// MoMo prompt at the till: the cashier types the customer's number, the customer gets a prompt on their phone and
// approves with their MoMo PIN, and the sale completes by itself. The server does the work (functions/src/momo.js);
// this file holds the till's side: the state, asking the server every few seconds, and the panel on the Pay screen.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNow } from '../hooks.js'
import { formatMoney } from '../lib/money.js'
import { MOMO_NETWORKS } from '../../../functions/src/core/rules.js'
import { cleanMomoNumber, networkOf, PROMPT_WAIT_MS } from '../../../functions/src/core/momo.js'
import { Icon } from '../components/ui.jsx'

const OPEN = ['sending', 'waiting', 'otp']
const CHECK_EVERY = 4000
// Where a customer finds a prompt they missed. MTN keeps unanswered prompts under "My Approvals".
const MISSED_PROMPT = {
  MTN: 'Ask them to dial *170#, then My Wallet → My Approvals, and approve it there.',
  Telecel: 'Ask them to check their phone for a Telecel Cash message, or dial *110#.',
  AT: 'Ask them to check their phone for an AT Money message.',
}

export const promptIsOpen = (prompt) => Boolean(prompt && OPEN.includes(prompt.status))
export const promptNetwork = (pay) => pay.promptNetwork || networkOf(pay.phone)
export const promptTargetOk = (pay) => Boolean(cleanMomoNumber(pay.phone) && promptNetwork(pay))
const showPhone = (digits) => digits.replace(/^(\d{3})(\d{0,3})(\d{0,4}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join(' '))

// State of the prompt for the sale on screen. onPaid(sale) runs once when the customer has paid.
export function useMomoPrompt({ call, online, onPaid }) {
  const [status, setStatus] = useState(null) // { ready, testMode } from the server
  const [prompt, setPrompt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const paidRef = useRef(onPaid)
  paidRef.current = onPaid
  const asking = useRef(false)
  const current = useRef(null)
  current.current = prompt

  useEffect(() => {
    if (!online || status?.ready) return
    call('momoPromptReady', {}, { quiet: true }).then((result) => result && setStatus(result)).catch(() => {})
  }, [online]) // eslint-disable-line react-hooks/exhaustive-deps

  const take = useCallback((result) => {
    if (!result) return
    // Ignore a late answer about a prompt that was replaced or cleared meanwhile.
    if (current.current && result.reference !== current.current.reference && OPEN.includes(current.current.status)) return
    setPrompt(result)
    if (result.status === 'paid' && result.sale) paidRef.current(result.sale)
  }, [])

  const run = async (name, data) => {
    setBusy(true)
    setError('')
    try {
      const result = await call(name, data, { quiet: true })
      if (result) { current.current = null; take(result) }
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  // While the customer decides, ask the server every few seconds (it asks Paystack).
  useEffect(() => {
    if (!promptIsOpen(prompt) || prompt.status === 'otp') return undefined
    const timer = setInterval(async () => {
      if (asking.current) return
      asking.current = true
      try { take(await call('checkMomoPrompt', { reference: prompt.reference }, { quiet: true })) } catch { /* try again next time */ }
      asking.current = false
    }, CHECK_EVERY)
    return () => clearInterval(timer)
  }, [prompt?.reference, prompt?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ready: Boolean(status?.ready) && online,
    known: status !== null,
    testMode: Boolean(status?.testMode),
    prompt, busy, error,
    open: promptIsOpen(prompt),
    send: (payload) => run('startMomoPrompt', payload),
    submitOtp: (otp) => run('submitMomoOtp', { reference: prompt.reference, otp }),
    check: async () => { if (prompt) take(await call('checkMomoPrompt', { reference: prompt.reference }, { quiet: true }).catch(() => null)) },
    cancel: async () => {
      if (promptIsOpen(prompt)) await call('cancelMomoPrompt', { reference: prompt.reference }, { quiet: true }).catch(() => null)
      setPrompt(null)
      setError('')
    },
    clear: () => { setPrompt(null); setError('') },
  }
}

// The left side of the Pay screen in prompt mode.
export function PromptPanel({ pay, setPay, total, momo, otp }) {
  const now = useNow(1000)
  const { prompt, error } = momo
  const network = promptNetwork(pay)

  if (!prompt || ['cancelled', 'replaced', 'failed'].includes(prompt.status)) {
    const failed = prompt?.status === 'failed'
    const digits = pay.phone.replace(/\D/g, '')
    const guessed = networkOf(digits)
    return <>
      {failed ? <div className="callout bad"><Icon name="alertCircle" /><p><b>The payment did not go through.</b> {String(prompt.message || '').replace(/([^.!?])$/, '$1.')} Send it again, check the number, or choose Cash or Card.</p></div> : null}
      <div className="pos-keyed pos-phone"><span>Customer’s MoMo number</span><b>{digits ? showPhone(digits) : <em>Type it on the pad</em>}</b></div>
      <div className="pos-networks" role="radiogroup" aria-label="Network">
        {MOMO_NETWORKS.map((item) => <button type="button" key={item} role="radio" aria-checked={network === item} className={`pos-quick-btn ${network === item ? 'on' : ''}`}
          onClick={() => setPay({ ...pay, promptNetwork: item === guessed ? '' : item })}>{item}</button>)}
      </div>
      <p className="muted small">{digits.length === 10 && !network ? 'This number’s network is not known. Choose it above.' : guessed && !pay.promptNetwork ? `Network found from the number: ${guessed}.` : 'Ask the customer for their MoMo number. The network is picked from the number.'}</p>
      {error ? <p className="callout bad small"><Icon name="alertCircle" /> {error}</p> : null}
    </>
  }

  if (prompt.status === 'sending' || prompt.status === 'waiting') {
    const waited = Math.max(0, now - (prompt.startedAt || now))
    return <div className="pos-prompt">
      <span className="pos-prompt-pulse" aria-hidden="true"><Icon name="phone" size={30} /></span>
      <b className="pos-prompt-title">Waiting for the customer</b>
      <span>Prompt sent to <b>{prompt.phone}</b> ({prompt.network}) for <b>{formatMoney(prompt.amount)}</b>.</span>
      <span className="muted">Ask them to check their phone and enter their MoMo PIN. The sale finishes by itself.</span>
      <span className="muted small">Waiting {Math.floor(waited / 1000)} s</span>
      {waited > PROMPT_WAIT_MS / 2 ? <p className="callout warn small"><Icon name="alertCircle" /> No prompt on their phone? {MISSED_PROMPT[prompt.network] || ''} Or press Send again.</p> : null}
    </div>
  }

  if (prompt.status === 'otp') {
    return <div className="pos-prompt">
      <b className="pos-prompt-title">Type the customer’s code</b>
      <span className="muted">{prompt.message || 'The customer received a code on their phone.'}</span>
      <div className="pos-keyed"><span>Code</span><b>{otp || <em>On the pad</em>}</b></div>
      {error ? <p className="callout bad small"><Icon name="alertCircle" /> {error}</p> : null}
    </div>
  }

  if (prompt.status === 'paid') return <div className="pos-prompt is-good"><Icon name="check" size={30} /><b className="pos-prompt-title">Paid</b></div>

  // paid_not_sold, mismatch, duplicate, paid_after_cancel: money arrived but needs a manager.
  return <div className="pos-prompt is-bad">
    <Icon name="alertCircle" size={30} />
    <b className="pos-prompt-title">A manager needs to check this payment</b>
    <span>{prompt.message}</span>
    <span className="muted small">Reference {prompt.reference}. It is in Reports → Activity.</span>
  </div>
}

// What the big button on the right does in prompt mode.
export function promptAction({ pay, momo, otp, total, ready, onSend }) {
  const { prompt, busy } = momo
  if (prompt?.status === 'otp') return { label: busy ? 'Sending…' : 'Submit code', disabled: busy || otp.length < 3, onClick: () => momo.submitOtp(otp), keypad: 'otp' }
  if (prompt && ['sending', 'waiting'].includes(prompt.status)) return { label: 'Waiting for approval…', disabled: true, keypad: null }
  if (prompt && !['failed', 'cancelled', 'replaced'].includes(prompt.status)) return { label: 'Close', disabled: false, onClick: momo.clear, keypad: null }
  const label = prompt?.status === 'failed' ? 'Send again' : 'Send prompt to phone'
  return { label: busy ? 'Sending…' : label, sub: formatMoney(total), disabled: busy || !ready || !promptTargetOk(pay), onClick: onSend, keypad: 'phone' }
}
