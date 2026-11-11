import { useOps } from '../hooks.js'

const TOPICS = [
  {
    id: 'sale', title: 'Making a sale', steps: [
      'Open Sell. Scan the barcode, or tap the product tile. Tap the type or brand chips at the top to narrow the list.',
      'The sale builds up on the right. Use − and + to change how many (− on the last one removes it). Discount and Customer are only if needed.',
      'Press Pay. Choose Cash, MoMo or Card. For cash, tap a note or type the amount on the keypad; the change is shown in large numbers.',
      'MoMo with a prompt: choose MoMo → Prompt on their phone, type the customer’s number and press Send prompt. They approve with their MoMo PIN and the sale finishes by itself. No prompt? Press Send again, or (MTN) they dial *170# → My Wallet → My Approvals.',
      'MoMo sent to the shop number: check the payment arrived on the shop phone first, then type its transaction ID on the keypad.',
      'Press Complete sale. Print the receipt or send it on WhatsApp, then New sale (or just scan the next item).',
      'Customer went to fetch money? Press Hold. Serve the next person, then press Held and Resume.',
      'Dark or light screen: tap the sun or moon button at the top of Sell. Each person can also choose in Account.',
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
    id: 'drawer', title: 'Cash drawer (start and end of shift)', steps: [
      'Start of shift: open Cash drawer, count the cash in the drawer and press Open drawer. You cannot take cash until your drawer is open.',
      'Cash in or out that is not a sale (change from the bank, paying a rider): record it in Cash drawer with the reason. Cash out needs a manager.',
      'End of shift: count all the cash and press Close drawer. If it does not match, write what happened. The owner sees every count in Reports → Drawers.',
      'Forgot to close? A manager can count and close it for you in Cash drawer.',
    ],
  },
  {
    id: 'offline', title: 'No internet', steps: [
      'You can keep selling. Sales are kept on this till and sent by themselves when the internet is back. The receipt says OFFLINE SALE.',
      'The till keeps working if it is restarted without internet, once it has been opened online at least once. Do not clear the browser data while sales are waiting.',
      'The customer screen, receipt printer and cash drawer all work without internet.',
      'Discounts that need a manager’s PIN, returns, cancellations and stock changes must wait for the internet.',
      'If the server refuses an offline sale (for example the stock ran out), it shows on the POS page. Fix the reason and press Try again.',
      'The SkinMatrix Till app (1.4.0 or newer) also saves every offline sale in Documents → SkinMatrix Till Backups on the computer. If the app’s own copy is ever lost, the sales come back by themselves and are sent. A spreadsheet there (offline-sales-YEAR-MONTH.csv) lists every offline sale: made, sent, refused, removed.',
      'For extra safety add a second backup folder (a USB stick, or a OneDrive folder) in Till setup → Backup on this computer.',
      'The till app (1.5.0 or newer) opens by itself when the computer starts, wakes from sleep or hibernate (power button), or is unlocked. If it was already open it comes to the front with the customer screen back in place. Till setup says whether this is on.',
      'Connect the till to the internet at least once a week: offline sales older than 7 days cannot be sent by themselves. The POS warns from day 2.',
      'Offline sales belong to the person who made them and only send while that person is signed in on this till. Do not switch user until the list of sales to send is empty.',
      'If the POS says the computer clock is wrong, fix it in Windows: Settings → Time & language → Date & time → Set time automatically, then Sync now.',
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
    id: 'till', title: 'Till hardware: printer, cash drawer, customer screen', steps: [
      'Best set-up for the counter: install the SkinMatrix Till app on the till computer. It opens the shop system full screen, prints receipts straight to the printer with no print window, and opens the cash drawer.',
      'Plug the cash drawer cable into the back of the receipt printer (port marked DK or CASH DRAWER). The drawer opens through the printer.',
      'Open Till setup and follow the three steps: 1 Receipt printer, 2 Cash drawer, 3 Customer screen. Each step has a test and asks whether it worked. Answer honestly: a wrong answer shows the fix.',
      'Printer test: the page has a row of numbers that must fill exactly one line, the text styles, a sample receipt and a paper cut. Cut off or wrapped numbers = wrong paper width. Strange symbols = the printer is not in ESC/POS mode. Nothing = check power, paper, cable or IP address.',
      'Customer screen: plug it in as a second monitor and set Windows to Extend (Windows key + P → Extend). The till app puts the sale on the touch screen and the customer view on the other one by itself. If it guesses wrong, open Till setup → Customer screen, press Show numbers and choose the right screen.',
      'The customer screen fills its monitor completely, with no buttons and no Windows taskbar (till app 1.7.0 or newer). On the wrong monitor? Press Swap screens on the POS (or Ctrl+Shift+S): it is remembered. Ctrl+Shift+D hides or shows it.',
      'The customer sees only what is being sold to them and the amount to pay. When nobody is buying, it shows a slideshow of products in stock.',
      'The drawer opens by itself after a cash sale or cash refund. To open it without a sale, press Open drawer on the POS page and give the reason. Every opening is recorded.',
      'No till app? Receipts print through the print window: choose the printer, paper 80 mm, margins None, no headers and footers. The drawer then opens with its key.',
      'On a phone or tablet, send the receipt by WhatsApp instead.',
    ],
  },
  {
    id: 'register', title: 'Cash register: X reading and Z report', steps: [
      'X reading: Cash drawer → Print X reading. It prints your drawer so far without closing it.',
      'End of shift: count the cash and press Close drawer, then Print closing slip.',
      'End of day (manager): Reports → Close the day. Check every drawer is closed, then press Close the day and print Z report. Each day gets a number (Z0001, Z0002…) and cannot be changed. Reprint old ones from the same page.',
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
      'Every delivery: Products → Receive stock is the quick way (scan, how many, expiry month). Need batch numbers, a supplier or an invoice? Use Stock → Receive delivery.',
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
      'New product: Products → Add a product. One form: photo, name, price, cost, barcode (scan it) and how many you have now. Turn off “Show on website” for shop-only items.',
      'New stock arriving: Products → Receive stock. Scan each box (each scan adds one), choose the expiry month, then Add to stock.',
      'New staff: Team → Add a person. Choose their username (for example ama) and a password, and tell them both. They sign in with just those.',
      'Staff forgot their password: Team → tap them → set a new password.',
      'Someone leaves: Team → tap them → Turn off this account.',
      'Managers must set an approval PIN in Account.',
    ],
  },
  {
    id: 'trouble', title: 'If something goes wrong', steps: [
      '“No internet”: nothing was saved. Check the connection and press the button again. Doing it twice never charges twice.',
      'Camera will not open: the site must be opened with https:// and camera access allowed in the browser settings.',
      'Staff forgot their password: the owner sets a new one in Team. The owner can use “Forgot password?” on the sign-in page.',
      'Receipt printer or cash drawer stopped working: open Till setup and run the test again. It shows what to check.',
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
