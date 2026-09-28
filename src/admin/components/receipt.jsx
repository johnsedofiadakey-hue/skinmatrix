import { createPortal } from 'react-dom'
import { formatMoney } from '../lib/money.js'
import { fmtFull } from './format.js'
import { refundedAmount } from '../../../functions/src/core/sale.js'
import { percentLabel } from '../../../functions/src/core/tax.js'

const PAID_BY = { cash: 'Cash', momo: 'Mobile money', card: 'Card' }
const AUTO_PRINT_KEY = 'skinmatrix-auto-print'

export const autoPrintEnabled = () => { try { return localStorage.getItem(AUTO_PRINT_KEY) === 'on' } catch { return false } }
export const setAutoPrint = (on) => { try { localStorage.setItem(AUTO_PRINT_KEY, on ? 'on' : 'off') } catch { /* private mode */ } }

// The receipt, sized for 80 mm thermal paper. It is also what WhatsApp and printing send.
export function Receipt({ sale, shop, productName }) {
  const refunded = refundedAmount(sale)
  return <div className="receipt" aria-label={`Receipt ${sale.number}`}>
    <div className="receipt-head">
      <b className="receipt-shop">{shop?.legalName || 'SkinMatrix'}</b>
      {shop?.address ? <span>{shop.address}</span> : null}
      {shop?.phone ? <span>Tel {shop.phone}</span> : null}
      {sale.tax ? <span>TIN {sale.tax.tin}</span> : null}
    </div>
    {sale.status === 'voided' ? <p className="receipt-void">CANCELLED</p> : null}
    {sale.provisional ? <p className="receipt-void">OFFLINE SALE<small className="block">Saved on this till. It gets its final number when the internet is back.</small></p> : null}
    <div className="receipt-meta">
      <span>{sale.provisional ? 'Offline no.' : 'Receipt no.'} {sale.number}</span>
      <span>{fmtFull(sale.at)}</span>
      <span>Served by {sale.cashier?.name}</span>
      {sale.customer?.name ? <span>Customer: {sale.customer.name}</span> : null}
    </div>
    <table className="receipt-lines"><tbody>
      {sale.items.map((item) => <tr key={item.productId}>
        <td>{item.quantity} × {productName ? productName(item) : item.name}{item.size ? <small> {item.size}</small> : null}{item.quantity > 1 ? <small className="block">@ {formatMoney(item.unitPrice)}</small> : null}</td>
        <td className="num">{formatMoney(item.lineTotal)}</td>
      </tr>)}
    </tbody></table>
    <div className="receipt-totals">
      {sale.discount || sale.offline?.adjustment ? <div><span>Subtotal</span><span>{formatMoney(sale.subtotal)}</span></div> : null}
      {sale.discount ? <div><span>Discount</span><span>−{formatMoney(sale.discount.amount)}</span></div> : null}
      {sale.offline?.adjustment ? <div><span>Price at time of sale</span><span>{sale.offline.adjustment > 0 ? '−' : '+'}{formatMoney(Math.abs(sale.offline.adjustment))}</span></div> : null}
      <div className="receipt-total"><span>TOTAL</span><span>{formatMoney(sale.total)}</span></div>
      <div><span>Paid by {PAID_BY[sale.payment.method]}{sale.payment.network ? ` (${sale.payment.network})` : ''}</span><span>{formatMoney(sale.payment.received)}</span></div>
      {sale.payment.change ? <div><span>Change</span><span>{formatMoney(sale.payment.change)}</span></div> : null}
      {sale.payment.reference ? <div><span>Ref</span><span>{sale.payment.reference}</span></div> : null}
      {refunded ? <div><span>Refunded</span><span>−{formatMoney(refunded)}</span></div> : null}
    </div>
    {sale.tax ? <div className="receipt-totals receipt-tax">
      <div><span>Prices include taxes:</span><span /></div>
      <div><span>Value before tax</span><span>{formatMoney(sale.tax.net)}</span></div>
      <div><span>VAT {percentLabel(sale.tax.vatBp)}</span><span>{formatMoney(sale.tax.vat)}</span></div>
      <div><span>NHIL {percentLabel(sale.tax.nhilBp)}</span><span>{formatMoney(sale.tax.nhil)}</span></div>
      <div><span>GETFund {percentLabel(sale.tax.getfundBp)}</span><span>{formatMoney(sale.tax.getfund)}</span></div>
    </div> : null}
    <p className="receipt-foot">
      {shop?.returnDays ? <>Keep this receipt. Unopened items can be returned within {shop.returnDays} days.<br /></> : null}
      Thank you for shopping with us.
    </p>
  </div>
}

// Plain-text version for WhatsApp.
export function receiptText(sale, shop) {
  const lines = [
    `*${shop?.legalName || 'SkinMatrix'}* — Receipt ${sale.number}`,
    fmtFull(sale.at),
    sale.tax ? `TIN ${sale.tax.tin}` : null,
    '',
    ...sale.items.map((item) => `${item.quantity} × ${item.name}${item.size ? ` ${item.size}` : ''}  ${formatMoney(item.lineTotal)}`),
    '',
    sale.discount ? `Discount: −${formatMoney(sale.discount.amount)}` : null,
    `*Total: ${formatMoney(sale.total)}*`,
    sale.tax ? `Includes VAT ${formatMoney(sale.tax.vat)}, NHIL ${formatMoney(sale.tax.nhil)}, GETFund ${formatMoney(sale.tax.getfund)}` : null,
    `Paid by ${PAID_BY[sale.payment.method]}`,
    '',
    'Thank you for shopping with SkinMatrix.',
  ]
  return lines.filter((line) => line !== null).join('\n')
}

export function whatsappReceiptLink(sale, shop) {
  const phone = sale.customer?.phone ? `233${sale.customer.phone.replace(/\D/g, '').slice(1)}` : ''
  return `https://wa.me/${phone}?text=${encodeURIComponent(receiptText(sale, shop))}`
}

// Print just the receipt (see the @media print rules in admin.css). The PrintArea must be on the page.
// Rendered straight into <body> so printing can hide everything else, even when the receipt is inside a dialog.
export function PrintArea({ children }) {
  return createPortal(<div className="print-area" aria-hidden="true">{children}</div>, document.body)
}
export const printNow = () => setTimeout(() => window.print(), 50)
