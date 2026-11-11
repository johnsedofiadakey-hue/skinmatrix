// Barcode stickers: printed on the receipt printer (one sticker per cut) and stuck on products that came without a
// barcode, so they scan at the till like everything else. With the desktop till app the printer draws the barcode
// itself; in a browser the stickers go through the print window, drawn here as SVG.
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { useOps } from '../hooks.js'
import { PrintArea, printNow } from '../components/receipt.jsx'
import { Icon } from '../components/ui.jsx'
import { formatMoney } from '../lib/money.js'
import { printerProblem, printOps } from '../till/device.js'
import { ean13Bars, isEan13, stickerOps } from './labels.js'

export function BarcodeSvg({ code, height = 46 }) {
  const bars = ean13Bars(code)
  const quiet = 9
  const width = bars.length + quiet * 2
  const guards = new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94])
  return (
    <svg className="sticker-barcode" viewBox={`0 0 ${width} ${height + 10}`} role="img" aria-label={`Barcode ${code}`} shapeRendering="crispEdges">
      <rect width={width} height={height + 10} fill="#fff" />
      {[...bars].map((bit, index) => (bit === '1'
        ? <rect key={index} x={quiet + index} y={0} width={1} height={guards.has(index) ? height + 5 : height} fill="#000" /> : null))}
      <text x={quiet - 2} y={height + 9} fontSize="9" textAnchor="end" fontFamily="monospace">{code[0]}</text>
      <text x={quiet + 24} y={height + 9} fontSize="9" textAnchor="middle" fontFamily="monospace">{code.slice(1, 7)}</text>
      <text x={quiet + 71} y={height + 9} fontSize="9" textAnchor="middle" fontFamily="monospace">{code.slice(7)}</text>
    </svg>
  )
}

export function Sticker({ product, barcode, shop }) {
  return (
    <div className="sticker">
      <b className="sticker-shop">{shop?.legalName || 'SkinMatrix'}</b>
      <span className="sticker-name">{product.name}</span>
      {[product.brand, product.size].filter(Boolean).length ? <small>{[product.brand, product.size].filter(Boolean).join(' · ')}</small> : null}
      {product.price ? <b className="sticker-price">{formatMoney(product.price)}</b> : null}
      <BarcodeSvg code={barcode} />
    </div>
  )
}

// "Print stickers" with a copy count. product: { name, brand, size, price }, barcode: a saved EAN-13.
export function StickerPrinter({ product, barcode, defaultCopies = 1 }) {
  const { shop, toast } = useOps()
  const [copies, setCopies] = useState(String(defaultCopies || 1))
  const [sheet, setSheet] = useState(null)
  const [busy, setBusy] = useState(false)
  if (!isEan13(barcode)) return null
  const count = Math.max(1, Math.min(100, Number.parseInt(copies, 10) || 1))
  const print = async () => {
    setBusy(true)
    try {
      const via = await printOps(stickerOps({ product, barcode, shop, copies: count }))
      if (via === 'browser') { flushSync(() => setSheet({ count })); printNow() }
      toast(`${count} sticker${count === 1 ? '' : 's'} sent to the printer.`)
    } catch (error) {
      toast(`Stickers not printed: ${printerProblem(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="sticker-printer row wrap">
      <label className="field"><span>Stickers</span>
        <input inputMode="numeric" value={copies} onChange={(event) => setCopies(event.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="How many stickers" />
      </label>
      <button type="button" className="btn secondary" disabled={busy} onClick={print}><Icon name="printer" size={16} /> {busy ? 'Printing…' : 'Print stickers'}</button>
      {sheet ? <PrintArea>{Array.from({ length: sheet.count }, (_, index) => <Sticker key={index} product={product} barcode={barcode} shop={shop} />)}</PrintArea> : null}
    </div>
  )
}
