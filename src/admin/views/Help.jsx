import { useOps } from '../hooks.js'

const TOPICS = [
  {
    id: 'sale', title: 'Making a sale', steps: [
      'Open Sell. Scan the barcode, or type the product name and tap it.',
      'Use − and + to change how many. Add a discount or the customer’s name only if needed.',
      'Choose Cash, MoMo or Card. For cash, tap the amount given; the change is shown in large numbers.',
      'For MoMo, check the payment arrived on the shop phone first, then type its transaction ID.',
      'Press Complete sale. Print the receipt or send it on WhatsApp.',
    ],
  },
  {
    id: 'refund', title: 'Refunds and mistakes', steps: [
      'Open Sales, find the sale and tap it.',
      'Customer bringing items back: press Return items, choose what came back and how the money goes back.',
      'Wrong sale made today: press Cancel sale. Everything goes back into stock.',
      'Staff: a manager chooses their name and types their PIN on your screen to approve.',
    ],
  },
  {
    id: 'scanner', title: 'Barcode scanner', steps: [
      'USB scanner: plug it into the computer. It works straight away, like a keyboard.',
      'Bluetooth scanner: pair it with the phone, tablet or computer in its Bluetooth settings (keyboard mode, “HID”).',
      'Test: open Sell and scan any product. You hear a short beep and it goes into the basket.',
      'If nothing happens, click on an empty part of the page first, then scan again.',
      'No scanner? Press Scan on the Sell page to use the phone or tablet camera. Allow camera access when asked.',
      'A product that does not scan needs its barcode saved once: Products → tap it → scan.',
    ],
  },
  {
    id: 'printer', title: 'Receipt printer (80 mm)', steps: [
      'Install the printer’s driver on the till computer, then set the paper size to 80 mm (72 mm printable) in the printer settings.',
      'Make a test sale and press Print. In the print window choose the receipt printer, set margins to None and turn off headers and footers. Chrome remembers this.',
      'To print without the print window: create a Chrome shortcut with --kiosk-printing added to the target, and make the receipt printer the default printer.',
      'To print automatically after every sale, tick the option on the receipt screen (or in Account).',
      'On a phone or tablet, send the receipt by WhatsApp instead.',
    ],
  },
  {
    id: 'orders', title: 'Website orders', steps: [
      'New orders appear in Orders and on Home.',
      'Call the customer, then press Confirm. This takes the items out of stock.',
      'Pack it, then press Ready for pickup or Sent out for delivery, and Complete once they have it.',
      'Paid online? Check the reference in Paystack before sending the order.',
    ],
  },
  {
    id: 'stock', title: 'Stock, deliveries and expiry', manager: true, steps: [
      'Day one: record the stock you already have with Stock → Receive delivery (no supplier), with batch numbers and expiry dates.',
      'Every delivery: Stock → Receive delivery. Scan each product and type batch, expiry, quantity and cost of one.',
      'The till always sells the batch that expires soonest first.',
      'Expired items cannot be sold. Take them off the shelf and press Write off expired.',
      'Once a month, do a Stock take so the numbers match the shelves.',
    ],
  },
  {
    id: 'closing', title: 'Closing the day', manager: true, steps: [
      'Open Reports → Today. Count the cash drawer; it should match “Cash in the drawer”.',
      'Check the MoMo total against the shop MoMo statement.',
      'Print the day summary and file it.',
    ],
  },
  {
    id: 'owner', title: 'Owner: products, team and website', owner: true, steps: [
      'New product: add it in Website → Products (name, price, photo). Untick “Show on website” for shop-only items.',
      'Then open Products, tap it, scan its barcode and type what it costs you.',
      'New staff: Team → Add a person. Give them the temporary password.',
      'Someone leaves: Team → tap them → Turn off this account.',
      'Managers must set an approval PIN in Account.',
    ],
  },
  {
    id: 'trouble', title: 'If something goes wrong', steps: [
      '“No internet”: nothing was saved. Check the connection and press the button again. Doing it twice never charges twice.',
      'Camera will not open: the site must be opened with https:// and camera access allowed in the browser settings.',
      'Forgot password: press “Forgot password?” on the sign-in page.',
      'Wrong PIN five times: that manager is locked for 15 minutes. Ask another manager or the owner.',
    ],
  },
]

export default function Help() {
  const { can } = useOps()
  const topics = TOPICS.filter((topic) => (!topic.manager || can('stock')) && (!topic.owner || can('staff')))
  return <div className="stack narrow">
    <p className="muted">Short how-tos for everything in the shop system. Each page also has its own guide at the top.</p>
    {topics.map((topic, index) => <details key={topic.id} className="help-topic" open={index === 0}>
      <summary>{topic.title}</summary>
      <ol>{topic.steps.map((step) => <li key={step}>{step}</li>)}</ol>
    </details>)}
  </div>
}
