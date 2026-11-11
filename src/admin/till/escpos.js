// ESC/POS for 80 mm (and 58 mm) thermal receipt printers. Pure JavaScript: a receipt is first described as a
// short list of lines ("ops"), then encoded to the bytes the printer understands. The desktop till app sends
// these bytes straight to the printer (USB through the Windows spooler, or a network printer on port 9100), so
// receipts print instantly with no print dialog, and the cash drawer plugged into the printer can be opened.
//
// ops: { text, align: 'left'|'center'|'right', bold, big }   one line of text (big = double width and height)
//      { pair: [left, right], bold, big }                    left and right text on one line
//      { rule: '-' }                                         a line across the paper
//      { feed: n }                                           n empty lines
//      { barcode: '2012345678903' }                          a printed barcode (EAN-13, else CODE128) with digits below
//      { cut: true }                                         feed and cut here (between stickers)
import { formatMoney } from '../lib/money.js'
import { percentLabel } from '../../../functions/src/core/tax.js'
import { refundedAmount } from '../../../functions/src/core/sale.js'

const ESC = 0x1b
const GS = 0x1d

export const COMMANDS = {
  init: [ESC, 0x40],
  alignLeft: [ESC, 0x61, 0], alignCenter: [ESC, 0x61, 1], alignRight: [ESC, 0x61, 2],
  boldOn: [ESC, 0x45, 1], boldOff: [ESC, 0x45, 0],
  bigOn: [GS, 0x21, 0x11], bigOff: [GS, 0x21, 0x00],
  feedAndCut: [ESC, 0x64, 4, GS, 0x56, 0x42, 0x00], // feed 4 lines, then partial cut
  barcodeHeight: [GS, 0x68, 80], barcodeWidth: [GS, 0x77, 2], barcodeTextBelow: [GS, 0x48, 2],
  // Drawer kick on connector pin 2: pulse 50 ms on, 500 ms off. Most drawers (RJ11/RJ12 into the printer) use pin 2.
  kickPin2: [ESC, 0x70, 0x00, 0x19, 0xfa],
  kickPin5: [ESC, 0x70, 0x01, 0x19, 0xfa],
}

// 80 mm paper with Font A prints 48 characters per line; 58 mm prints 32.
export const PAPER_WIDTH = { 80: 48, 58: 32 }

// Receipt printers' built-in code page is only safe for plain ASCII; swap the few other characters we use.
export function toPrinterText(text) {
  return String(text ?? '')
    .replace(/GH₵/g, 'GHS ')
    .replace(/[₵¢]/g, 'C')
    .replace(/[−–—]/g, '-')
    .replace(/×/g, 'x')
    .replace(/…/g, '...')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/·/g, '-')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?')
}

// Left and right text on one line of `width` characters. Long left text is cut so the amount always shows.
export function pairLine(left, right, width) {
  const l = toPrinterText(left)
  const r = toPrinterText(right)
  const room = width - r.length - 1
  const clipped = l.length > room ? `${l.slice(0, Math.max(0, room - 1))}.` : l
  return clipped + ' '.repeat(Math.max(1, width - clipped.length - r.length)) + r
}

// Splits text into lines of at most `width` characters, breaking at spaces where it can.
export function wrap(text, width) {
  const words = toPrinterText(text).split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    if (!line) line = word
    else if (line.length + 1 + word.length <= width) line += ` ${word}`
    else { lines.push(line); line = word }
    while (line.length > width) { lines.push(line.slice(0, width)); line = line.slice(width) }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

// Turns ops into printer bytes. options: { width, cut = true, kick = false, kickPin = 2 }
export function encode(ops, { width = 48, cut = true, kick = false, kickPin = 2 } = {}) {
  const bytes = [...COMMANDS.init]
  const push = (list) => { for (const value of list) bytes.push(value) }
  const pushText = (text) => { for (let i = 0; i < text.length; i += 1) bytes.push(text.charCodeAt(i) & 0x7f) }
  for (const op of ops) {
    if (op.rule) { push(COMMANDS.alignLeft); pushText(op.rule.repeat(width)); bytes.push(0x0a); continue }
    if (op.feed) { for (let i = 0; i < op.feed; i += 1) bytes.push(0x0a); continue }
    if (op.cut) { push(COMMANDS.alignLeft); push(COMMANDS.feedAndCut); continue }
    if (op.barcode) {
      const digits = String(op.barcode).replace(/\D/g, '')
      const ean = digits.length === 13 || digits.length === 12
      const data = ean ? digits.slice(0, 12) : String(op.barcode).replace(/[^\x20-\x7e]/g, '')
      push(COMMANDS.alignCenter)
      push(COMMANDS.barcodeHeight); push(COMMANDS.barcodeWidth); push(COMMANDS.barcodeTextBelow)
      // EAN-13 (function B, type 67): the printer adds the check digit itself. Anything else: CODE128 set B.
      if (ean) { push([GS, 0x6b, 67, data.length]); pushText(data) } else {
        const payload = `{B${data}`
        push([GS, 0x6b, 73, payload.length]); pushText(payload)
      }
      bytes.push(0x0a)
      continue
    }
    const columns = op.big ? Math.floor(width / 2) : width
    push(op.align === 'center' ? COMMANDS.alignCenter : op.align === 'right' ? COMMANDS.alignRight : COMMANDS.alignLeft)
    if (op.bold) push(COMMANDS.boldOn)
    if (op.big) push(COMMANDS.bigOn)
    const lines = op.pair ? [pairLine(op.pair[0], op.pair[1], columns)] : wrap(op.text, columns)
    for (const line of lines) { pushText(line); bytes.push(0x0a) }
    if (op.big) push(COMMANDS.bigOff)
    if (op.bold) push(COMMANDS.boldOff)
  }
  push(COMMANDS.alignLeft)
  if (cut) push(COMMANDS.feedAndCut)
  if (kick) push(kickPin === 5 ? COMMANDS.kickPin5 : COMMANDS.kickPin2)
  return Uint8Array.from(bytes)
}

// Just the drawer pulse (the "No sale" button).
export const drawerKickBytes = (kickPin = 2) => Uint8Array.from([...COMMANDS.init, ...(kickPin === 5 ? COMMANDS.kickPin5 : COMMANDS.kickPin2)])

// Plain text of ops, for previews and tests.
export function toText(ops, width = 48) {
  return ops.flatMap((op) => {
    if (op.rule) return [op.rule.repeat(width)]
    if (op.feed) return Array(op.feed).fill('')
    if (op.cut) return ['- - - - cut - - - -']
    if (op.barcode) return [`||| ${op.barcode} |||`]
    const columns = op.big ? Math.floor(width / 2) : width
    return op.pair ? [pairLine(op.pair[0], op.pair[1], columns)] : wrap(op.text, columns)
  }).join('\n')
}

// ── Documents ──────────────────────────────────────────────────────────────────────────────────

const PAID_BY = { cash: 'Cash', momo: 'Mobile money', card: 'Card' }
const money = (value) => formatMoney(value).replace('−', '-')

export const fmtStamp = (ms) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Accra', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(ms)

function shopHeader(shop) {
  return [
    { text: shop?.legalName || 'SkinMatrix', align: 'center', bold: true, big: true },
    shop?.address ? { text: shop.address, align: 'center' } : null,
    shop?.phone ? { text: `Tel ${shop.phone}`, align: 'center' } : null,
  ].filter(Boolean)
}

// The sale receipt, matching the on-screen Receipt in components/receipt.jsx.
export function saleReceiptOps(sale, shop, { reprint = false } = {}) {
  const refunded = refundedAmount(sale)
  const ops = [...shopHeader(shop)]
  if (sale.tax) ops.push({ text: `TIN ${sale.tax.tin}`, align: 'center' })
  ops.push({ rule: '-' })
  if (sale.status === 'voided') ops.push({ text: 'CANCELLED', align: 'center', bold: true, big: true })
  if (sale.provisional) ops.push({ text: 'OFFLINE SALE', align: 'center', bold: true }, { text: 'Saved on this till. It gets its final number when the internet is back.', align: 'center' })
  if (reprint) ops.push({ text: 'COPY', align: 'center', bold: true })
  ops.push(
    { pair: [sale.provisional ? 'Offline no.' : 'Receipt no.', String(sale.number)] },
    { pair: ['Date', fmtStamp(sale.at)] },
    { pair: ['Served by', sale.cashier?.name || ''] },
  )
  if (sale.customer?.name) ops.push({ pair: ['Customer', sale.customer.name] })
  ops.push({ rule: '-' })
  for (const item of sale.items) {
    ops.push({ text: `${item.name}${item.size ? ` ${item.size}` : ''}` })
    ops.push({ pair: [`  ${item.quantity} x ${money(item.unitPrice)}`, money(item.lineTotal)] })
  }
  ops.push({ rule: '-' })
  if (sale.discount || sale.offline?.adjustment) ops.push({ pair: ['Subtotal', money(sale.subtotal)] })
  if (sale.discount) ops.push({ pair: ['Discount', `-${money(sale.discount.amount)}`] })
  if (sale.offline?.adjustment) ops.push({ pair: ['Price at time of sale', `${sale.offline.adjustment > 0 ? '-' : '+'}${money(Math.abs(sale.offline.adjustment))}`] })
  ops.push({ pair: ['TOTAL', money(sale.total)], bold: true, big: true })
  ops.push({ pair: [`Paid by ${PAID_BY[sale.payment.method] || sale.payment.method}${sale.payment.network ? ` (${sale.payment.network})` : ''}`, money(sale.payment.received)] })
  if (sale.payment.change) ops.push({ pair: ['Change', money(sale.payment.change)], bold: true })
  if (sale.payment.reference) ops.push({ pair: ['Ref', sale.payment.reference] })
  if (refunded) ops.push({ pair: ['Refunded', `-${money(refunded)}`] })
  if (sale.tax) {
    ops.push({ rule: '-' }, { text: 'Prices include taxes:' },
      { pair: ['Value before tax', money(sale.tax.net)] },
      { pair: [`VAT ${percentLabel(sale.tax.vatBp)}`, money(sale.tax.vat)] },
      { pair: [`NHIL ${percentLabel(sale.tax.nhilBp)}`, money(sale.tax.nhil)] },
      { pair: [`GETFund ${percentLabel(sale.tax.getfundBp)}`, money(sale.tax.getfund)] })
  }
  ops.push({ rule: '-' })
  if (shop?.returnDays) ops.push({ text: `Keep this receipt. Unopened items can be returned within ${shop.returnDays} days.`, align: 'center' })
  ops.push({ text: 'Thank you for shopping with us.', align: 'center' })
  return ops
}

// "No sale" slip: who opened the drawer, when and why. Printed so the drawer opening leaves a paper trail too.
export function noSaleOps({ shop, by, reason, at }) {
  return [
    ...shopHeader(shop),
    { rule: '-' },
    { text: 'NO SALE', align: 'center', bold: true, big: true },
    { pair: ['Date', fmtStamp(at)] },
    { pair: ['Opened by', by] },
    { text: `Reason: ${reason}` },
  ]
}

// X reading (drawer still open) or the drawer's closing slip.
// shift: the shifts/{id} document. showExpected: staff do a blind count, so their slip leaves the expected cash off.
export function drawerReportOps({ shop, shift, title, at, showExpected, totals }) {
  const moves = shift.moves || []
  const cashIn = moves.filter((move) => move.kind === 'in').reduce((sum, move) => sum + move.amount, 0)
  const cashOut = moves.filter((move) => move.kind === 'out').reduce((sum, move) => sum + move.amount, 0)
  const expected = (shift.float || 0) + (shift.cashSales || 0) - (shift.cashRefunds || 0) + cashIn - cashOut
  const ops = [
    ...shopHeader(shop),
    { rule: '=' },
    { text: title, align: 'center', bold: true, big: true },
    { pair: ['Printed', fmtStamp(at)] },
    { pair: ['Cashier', shift.cashier?.name || ''] },
    { pair: ['Drawer opened', fmtStamp(shift.openedAt)] },
    shift.closedAt ? { pair: ['Drawer closed', fmtStamp(shift.closedAt)] } : null,
    { rule: '-' },
    { pair: ['Float', money(shift.float || 0)] },
    { pair: [`Cash sales (${shift.sales || 0})`, money(shift.cashSales || 0)] },
    shift.cashRefunds ? { pair: ['Cash refunds', `-${money(shift.cashRefunds)}`] } : null,
    cashIn ? { pair: ['Cash in', money(cashIn)] } : null,
    cashOut ? { pair: ['Cash out', `-${money(cashOut)}`] } : null,
    shift.noSales ? { pair: ['Drawer opened without a sale', String(shift.noSales)] } : null,
  ].filter(Boolean)
  for (const move of moves) ops.push({ text: `  ${move.kind === 'out' ? 'Out' : 'In'} ${money(move.amount)}: ${move.reason}` })
  if (showExpected || shift.status === 'closed') ops.push({ pair: ['Cash expected', money(shift.expected ?? expected)], bold: true })
  if (shift.status === 'closed') {
    ops.push({ pair: ['Cash counted', money(shift.counted)], bold: true })
    ops.push({ pair: [shift.difference === 0 ? 'Matches' : shift.difference > 0 ? 'Over' : 'Short', money(shift.difference)], bold: true })
    if (shift.note) ops.push({ text: `Note: ${shift.note}` })
  }
  if (totals) {
    ops.push({ rule: '-' }, { text: 'All my sales on this drawer', bold: true })
    for (const [method, value] of Object.entries(totals)) ops.push({ pair: [PAID_BY[method] || method, money(value)] })
  }
  ops.push({ rule: '-' }, { feed: 1 }, { text: 'Signed: ____________________' })
  return ops
}

// Z report: the day's closing record for the whole shop (see functions/src/zreport.js).
export function zReportOps({ shop, report, at }) {
  const ops = [
    ...shopHeader(shop),
    { rule: '=' },
    { text: `Z REPORT ${report.number}`, align: 'center', bold: true, big: true },
    { pair: ['Business day', report.day] },
    { pair: ['Closed by', report.closedBy?.name || ''] },
    { pair: ['Closed at', fmtStamp(report.closedAt)] },
    { pair: ['Printed', fmtStamp(at)] },
    report.firstSale ? { pair: ['Receipts', `${report.firstSale} to ${report.lastSale}`] } : { text: 'No sales this day.' },
    { rule: '-' },
    { pair: [`Sales (${report.count})`, money(report.gross)] },
    report.discounts ? { pair: ['Discounts given', `-${money(report.discounts)}`] } : null,
    report.voided ? { pair: [`Cancelled (${report.voidedCount})`, money(report.voided)] } : null,
    report.refunds ? { pair: ['Refunds', `-${money(report.refunds)}`] } : null,
    { pair: ['NET TAKINGS', money(report.net)], bold: true },
    { rule: '-' },
    { text: 'By payment (after refunds)', bold: true },
  ].filter(Boolean)
  for (const [method, value] of Object.entries(report.byMethod || {})) ops.push({ pair: [PAID_BY[method] || method, money(value)] })
  if (report.tax?.vat || report.tax?.nhil || report.tax?.getfund) {
    ops.push({ rule: '-' }, { text: 'Taxes in the takings', bold: true },
      { pair: ['Value before tax', money(report.tax.net)] },
      { pair: ['VAT', money(report.tax.vat)] },
      { pair: ['NHIL', money(report.tax.nhil)] },
      { pair: ['GETFund', money(report.tax.getfund)] })
  }
  ops.push({ rule: '-' }, { text: 'Cash drawers', bold: true })
  for (const drawer of report.drawers || []) {
    ops.push({ text: `${drawer.cashier} ${drawer.status === 'open' ? '(still open)' : ''}` })
    ops.push({ pair: ['  Expected', money(drawer.expected)] })
    if (drawer.status === 'closed') ops.push({ pair: ['  Counted', money(drawer.counted)] }, { pair: ['  Difference', money(drawer.difference)] })
  }
  if (!(report.drawers || []).length) ops.push({ text: 'No drawers were opened.' })
  if (report.note) ops.push({ rule: '-' }, { text: `Note: ${report.note}` })
  ops.push({ rule: '-' }, { feed: 1 }, { text: 'Signed: ____________________' })
  return ops
}

// The printer test page (Till setup → Test the receipt printer). Like a printer's own self-test: it shows
// whether the paper width is right (the ruler fills one line exactly), that bold, large and centred text work,
// and how a real receipt will look, then cuts the paper.
export function printerTestOps({ shop, printer, paper, by, at }) {
  const width = PAPER_WIDTH[paper] || 48
  const ruler = Array.from({ length: width }, (_, index) => String((index + 1) % 10)).join('')
  return [
    { text: shop?.legalName || 'SkinMatrix', align: 'center', bold: true, big: true },
    { text: 'RECEIPT PRINTER TEST', align: 'center', bold: true },
    { rule: '=' },
    { pair: ['Printed', fmtStamp(at)] },
    { pair: ['By', by || ''] },
    { pair: ['Printer', printer || ''] },
    { pair: ['Paper', `${paper} mm (${width} letters a line)`] },
    { rule: '-' },
    { text: '1. Paper width: the numbers below must fill ONE line.' },
    { text: ruler },
    { text: '2. Text styles:' },
    { text: 'Left' },
    { text: 'Centre', align: 'center' },
    { text: 'Right', align: 'right' },
    { text: 'Bold text', bold: true },
    { text: 'BIG', big: true },
    { rule: '-' },
    { text: '3. Sample receipt:' },
    { pair: ['2 x Moisturizing Cream', 'GHS 600.00'] },
    { pair: ['1 x Vitamin C Serum', 'GHS 245.00'] },
    { rule: '-' },
    { pair: ['TOTAL', 'GHS 845.00'], bold: true },
    { pair: ['Cash', 'GHS 900.00'] },
    { pair: ['Change', 'GHS 55.00'] },
    { rule: '-' },
    { text: 'If every line above is clear and the paper was cut below, the printer is ready.', align: 'center' },
  ]
}
