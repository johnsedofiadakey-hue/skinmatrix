// Mobile money prompts ("request to pay"): pure rules shared by the server and the till.
// The cashier types the customer's number, Paystack sends a prompt to that phone, the customer approves with
// their MoMo PIN, and the sale completes by itself.
import { RuleError } from './rules.js'

// Ghana numbers by network (first three digits of the local 10-digit number).
const PREFIXES = {
  MTN: ['024', '025', '053', '054', '055', '059'],
  Telecel: ['020', '050'],
  AT: ['026', '027', '056', '057'],
}

// Paystack's provider codes for Ghana mobile money.
export const PAYSTACK_PROVIDER = { MTN: 'mtn', Telecel: 'vod', AT: 'atl' }

// How long the till keeps waiting before it suggests trying again (the customer may not have seen the prompt).
export const PROMPT_WAIT_MS = 120000

// "+233 55 123 4987", "233551234987", "0551234987" → "0551234987". Anything else → ''.
export function cleanMomoNumber(value) {
  let digits = String(value ?? '').replace(/\D/g, '')
  if (digits.startsWith('233') && digits.length === 12) digits = `0${digits.slice(3)}`
  if (digits.length === 9 && !digits.startsWith('0')) digits = `0${digits}`
  return /^0\d{9}$/.test(digits) ? digits : ''
}

// The network a number belongs to, or '' when the prefix is not a known MoMo network (or the number is incomplete).
export function networkOf(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  const local = digits.startsWith('233') ? `0${digits.slice(3)}` : digits.startsWith('0') ? digits : `0${digits}`
  const prefix = local.slice(0, 3)
  return Object.keys(PREFIXES).find((network) => PREFIXES[network].includes(prefix)) || ''
}

// For receipts and the customer screen: "055 *** 4987".
export function maskMomoNumber(value) {
  const number = cleanMomoNumber(value)
  return number ? `${number.slice(0, 3)} *** ${number.slice(6)}` : ''
}

// Checks what the cashier typed. Returns { phone, network }.
export function checkMomoTarget(phone, network) {
  const number = cleanMomoNumber(phone)
  if (!number) throw new RuleError('bad_phone', 'Type the customer’s 10-digit MoMo number, for example 0551234987.')
  const chosen = PAYSTACK_PROVIDER[network] ? network : networkOf(number)
  if (!chosen) throw new RuleError('bad_network', 'Choose the customer’s MoMo network.')
  return { phone: number, network: chosen }
}

// What the till shows for each state of a prompt.
export const PROMPT_STATUS = {
  sending: 'Sending the prompt…',
  waiting: 'Waiting for the customer to approve on their phone.',
  otp: 'The customer received a code. Type it in to finish.',
  paid: 'Paid.',
  failed: 'The payment did not go through.',
  cancelled: 'Cancelled.',
  // Money arrived but the sale could not be saved (e.g. stock ran out meanwhile): a manager must refund it.
  paid_not_sold: 'Paid, but the sale could not be saved. A manager must refund the customer in Paystack.',
  mismatch: 'Paystack reported a different amount. A manager must check it in Paystack.',
}
