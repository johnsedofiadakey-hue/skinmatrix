import { useCallback, useState } from 'react'
import { flushSync } from 'react-dom'
import { useOps } from '../hooks.js'
import { PrintArea, printNow } from '../components/receipt.jsx'
import { PAPER_WIDTH, toText } from './escpos.js'
import { getTill, kickForCash, openDrawer, printerProblem, printOps, printSale } from './device.js'

// A slip (X/Z report, No sale) as plain monospaced text, for printing through the browser's print window.
export function TextSlip({ ops }) {
  return <pre className="text-slip">{toText(ops, PAPER_WIDTH[getTill().paper] || 48)}</pre>
}

// Prints slips described as ESC/POS ops: straight to the printer with the desktop app, otherwise through the
// print window. Render `area` somewhere on the page.
export function useSlipPrinter() {
  const { toast } = useOps()
  const [slip, setSlip] = useState(null)
  const print = useCallback(async (ops, { kick = false } = {}) => {
    try {
      const via = await printOps(ops, { kick })
      if (via === 'browser') { flushSync(() => setSlip(ops)); printNow() }
      return true
    } catch (error) {
      toast(printerProblem(error), 'error')
      return false
    }
  }, [toast])
  return { print, area: slip ? <PrintArea><TextSlip ops={slip} /></PrintArea> : null }
}

// The sale receipt: direct to the printer when possible (opening the drawer for cash if set up), else the print
// window with the <PrintArea><Receipt/></PrintArea> the page already shows.
export function useReceiptPrinter() {
  const { toast } = useOps()
  return useCallback(async (sale, shop, { reprint = false, kick = false } = {}) => {
    try {
      const via = await printSale(sale, shop, { reprint, kick: kick && kickForCash(sale.payment?.method) })
      if (via === 'browser') printNow()
      return true
    } catch (error) {
      toast(`Receipt not printed: ${printerProblem(error)}`, 'error')
      return false
    }
  }, [toast])
}

// Opens the drawer for a cash payment or refund when the receipt is not being printed (it opens with the receipt otherwise).
export async function kickDrawerForCash(method, toast) {
  if (!kickForCash(method)) return
  try { await openDrawer() } catch (error) { toast?.(`Cash drawer did not open: ${printerProblem(error)}`, 'error') }
}
