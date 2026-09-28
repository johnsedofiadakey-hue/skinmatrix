# SkinMatrix — Agent Handover

Last updated: 2026-09-28 (server-priced web orders, Paystack verification, cash drawers, offline till, VAT receipts, SMS). Read this first, then `CLAUDE_HANDOVER.md` (original brief).

## The business
- **One shop** (single branch) in Ghana selling skincare and supplements. Prices in GHS. Stock lives at the shop only; there is no warehouse.
- Two surfaces:
  1. **Public storefront** — `index.html` → `src/main.jsx` → `src/App.jsx` (+ public CSS, `MatrixScene.jsx`).
  2. **Shop system (staff admin)** — `/admin` → `admin/index.html` → `src/admin/**`. Real Firebase: staff sign in with their own email and password, and every change goes through Cloud Functions. It never imports public CSS.

## Working-tree warnings (read before touching anything)
- **Another agent edits the public site in this same folder.** `src/App.jsx`, `src/ShopPage.jsx`, `src/storefront.jsx`, the public CSS files, `public/assets/**` and `work/*.png` may have uncommitted changes that are not from the admin work. Don't revert, stash or overwrite them.
- Git: `origin` = https://github.com/johnsedofiadakey-hue/skinmatrix (**public repo**), branch `main`. Never commit service-account keys or `.env` files with secrets (`.env.emulators` only holds `VITE_USE_EMULATORS=1`).
- Firebase project `skinmatrixgh`: Hosting at https://skinmatrixgh.web.app (+ `/admin/`), Auth email/password, Firestore in `europe-west2`, Functions in `europe-west2` (Node 22, **needs the Blaze plan**).
- **Deploying Functions or Firestore rules changes the live shop. Ask the user first.**
- Lollarod (`/Users/truth/Developer/lollarod Project/lollarod`) is a **read-only** reference. Never edit it or read its `.env`/credentials.

## Run and verify
```bash
npm install && (cd functions && npm install)
npm test                 # Vitest: storefront/cloud unit tests
npm run test:functions   # 30 server tests on the Firestore + Auth emulators (needs JDK 21, see below)
npm run build            # both entries
```
The emulators need Java 21: `export JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH`.

**Try the admin locally without touching live data:**
1. `npm run dev:emulators` (Auth, Firestore, Functions on project `demo-skinmatrix`).
2. `npm run dev:local` (Vite in `--mode emulators`; `.claude/launch.json` → `skinmatrix-emulated`, port 5182). In this mode `src/cloud/firebase.js` switches to project `demo-skinmatrix` and both Firestore SDKs, Auth and Functions connect to the emulators.
3. Seed: create a user in the Auth emulator, add `admins/{uid}`, and write `site/catalog` `{ products: [{ id, name, brand, size, price (pesewas), visible }] }`. Sign in at `/admin/` and press "Set up the shop as owner".

## Shop system (admin): how it works
**Server** — `functions/` (ESM). `index.js` wraps each handler in `onCall` and turns `RuleError(code, message)` into an `HttpsError` with `details.code`. `src/handlers.js` holds every command. Each command:
- looks up the caller in `staff/{uid}` and checks the role (`src/core/rules.js`);
- runs in one Firestore transaction (all reads before writes);
- prices from `site/catalog` only;
- sells soonest-expiry batches first (`src/core/stock.js`);
- is idempotent via `requests/{uid}_{requestId}`;
- writes `audit` and `movements` in the same transaction.

Pure rules: `src/core/{rules,sale,stock,time}.js`. The client imports these too (single source of truth).

Other server modules: `src/web.js` (website checkout, no sign-in), `src/shifts.js` (cash drawers), `src/settings.js` (owner settings), `src/sms.js` (mNotify), `src/shared.js` (helpers every command uses). Pure rules also in `src/core/{order,shift,tax}.js`.

**Commands:** `placeWebOrder`, `verifyWebPayment` (public), `paystackWebhook` (HTTP), `openShift`, `cashMovement`, `closeShift`, `saveShopSettings`, `completeSale`, `voidSale`, `returnItems`, `updateWebOrder` (confirm takes stock; cancel puts it back), `receiveDelivery`, `adjustStock`, `writeOffExpired`, `submitStockCount` (refused with `details.stale` if stock moved mid-count), `saveProductSetup`, `saveSupplier`, `claimOwner`, `createStaff` (returns a one-time 12-character password), `updateStaff` (turning someone off disables Auth and revokes tokens; there is always one active owner), `setMyPin`, `recordSignIn`.

**Website orders:** the checkout sends only product ids, quantities and details to `placeWebOrder`, which prices from `site/catalog` + `site/content.checkout.deliveryFee`, refuses hidden/unpriced/out-of-stock (`site/availability`) items, limits 5 waiting orders per phone, generates the ref and saves the order. Clients can no longer write `orders` at all. Paystack: the order is saved first with `payment.status: 'pending'`, the popup charges the server's total with reference `SM-XXXXXX-ABCD` (new suffix per attempt), then `verifyWebPayment` asks Paystack's verify API; the signed webhook (`charge.success`, HMAC-SHA512) does the same if the browser closes. Result: `paid` (amount and GHS match), or `mismatch` (a manager can accept after checking). Staff cannot confirm a `pending` order. Without the `PAYSTACK_SECRET_KEY` secret, verify falls back to the old `reported` + manual check.

**Cash drawers (shifts):** `shifts/{id}`, and `staff/{uid}.openShiftId`. Cash sales need an open drawer (MoMo and card don't). Cash refunds (void or return) come out of the refunder's drawer. Cash out needs `cashOut` (manager/owner) or an approval PIN. Closing records counted, expected and difference, and needs a note when they differ. Managers can close someone else's. Reports → Drawers lists them. The staff drawer page is a blind count (expected is shown only to managers).

**Offline till:** admin Firestore uses persistent cache. If the device is offline or `completeSale` fails with a connection error, the sale is queued in localStorage (`skinmatrix-offline-sales-{uid}`, `live/offlineSales.js`) with the *same* requestId, and a provisional receipt prints. `LiveProvider` retries every 30 s and when back online, sending `offline: { at, shiftId, clientTotal }`. The server keeps the real sale time, charges what the customer paid (the difference from today's price goes in `sale.offline.adjustment` and the audit log), puts cash on the original drawer (`lateCash` if already closed), and refuses anything older than 7 days. Refused sales show on POS for retry, or a manager can remove them from that device. Discounts needing a PIN can't be done offline. Not solved: reloading the page while offline (no service worker).

**Settings (owner):** `settings/shop`: `tax { registered, tin, vatBp, nhilBp, getfundBp }` (defaults 15/2.5/2.5% on the same base; **confirm with the accountant**) and `sms { enabled, senderId, orderPlaced, orderUpdates, saleReceipt }`. Sales store `tax` (a breakdown of the tax-inclusive total) and receipts print it with the TIN. SMS goes through mNotify (`MNOTIFY_API_KEY` secret) after the transaction and never fails the order or sale. Every attempt is logged in `smsLog`.

**Secrets:** `firebase functions:secrets:set PAYSTACK_SECRET_KEY` and `MNOTIFY_API_KEY` before deploying (deploy asks for them if missing; use any placeholder for SMS until there's an mNotify account). The local emulator reads `functions/.secret.local` (gitignored). Paystack dashboard → Webhook URL: `https://europe-west2-skinmatrixgh.cloudfunctions.net/paystackWebhook`.

**Approvals:** staff actions above their limit get `approval_required`. `LiveProvider.call()` opens `ApprovalDialog`: a manager or the owner picks their name and types their PIN on the cashier's screen, and the call is retried with `approval: {approverId, pin}`. PINs are scrypt-hashed in `staffSecrets/{uid}`; 5 wrong tries lock that approver for 15 minutes.

**Roles:**
- Staff: sell, sales list and reprint, website orders, stock lookup; discounts up to 10%.
- Manager: plus approve, void (same day), returns (30 days), stock, deliveries, reports, costs.
- Owner: plus products setup, team, website editor, void any day, returns after 30 days.

**Data (Firestore):**
- Any active staff can read: `site/catalog` (the one catalogue for website and till; `visible:false` = shop only), `catalogOps/{productId}` (sku, barcode, reorderPoint, tracksExpiry), `stock/{productId}` (summary without costs), `sales`, `orders`, `staff`.
- Managers and owner only: `catalogCosts`, `saleCosts`, `batches` (unit cost), `movements`, `audit`, `suppliers`, `deliveries`, `stockCounts`.
- No client access: `counters`, `requests`, `staffSecrets`. Clients can't write any operations collection; only functions can.
- `site/availability` is public and written by functions (stock per product for the storefront).

**Client** — `src/admin/`:
- `AdminApp.jsx`: sign-in states (loading / signed out / first setup / not on team / turned off), role-based navigation (sidebar ≥ 900 px; bottom tab bar + "More" sheet on phones).
- `LiveProvider.jsx`: live listeners plus `call()`.
- `live/firebase.js`: SDK wiring and error reading.
- Pages other than Home, POS and Website orders are lazy-loaded (`React.lazy`). The admin JS is still about 800 kB, and most of that is the Firebase SDK (full Firestore + Auth).
- Views: `Home`, `Sell` (POS; offline queue in `components/offline.jsx`), `Drawer` (cash drawer + `DrawerReport`), `Settings` (owner: VAT, SMS, SMS log), `Sales` (reprint, WhatsApp, return, cancel), `WebsiteOrders`, `Stock` (list, batches, adjust, receive delivery, stock take, write-off), `Reports` (money, cash in drawer, profit, by staff, best sellers, activity log, printable day summary, CSV), `Setup` (products: barcode, SKU, cost, low-stock level, expiry), `Team`, `Website` (other agent's editor, owner only), `Account` (password, approval PIN, auto-print), `Help`.
- Every page has a `Guide` (how-to box that can be folded away; remembered per device).
- **Receipts:** `components/receipt.jsx`. `PrintArea` is portalled into `<body>`; `@media print` in `admin.css` prints only it at 80 mm (`@page size 80mm`). Auto-print is a per-device option. WhatsApp receipts use `wa.me`.
- **Scanners:** `components/scanner.jsx`. USB/Bluetooth scanners are detected as fast keystrokes + Enter when no text box has focus (keys ≤ 120 ms apart, Enter within 400 ms). Camera: native `BarcodeDetector`, else lazy-loaded `@zxing/browser`. Needs HTTPS.

## Verified (2026-09-26)
- `npm test` 12/12, `npm run test:functions` 17/17, `npm run build` passes.
- Browser pass on the emulators, desktop and 375 px phone:
  - first-owner setup; product setup with barcode and cost;
  - receive delivery via a simulated scanner (2 lines, cost prefilled);
  - cash sale with change and receipt; approval PIN;
  - add staff (one-time password); staff sign-in and role-limited menu;
  - staff cancels a sale → approval dialog → wrong PIN refused → right PIN accepted, with both names recorded;
  - stock take with one difference; reports and activity log; website editor loads.
- **Not verified:** a real 80 mm printer (the print CSS is untested on hardware), a physical scanner, the phone camera (needs HTTPS, so test on the deployed site), and a deploy of Functions/rules.

## Going live (ask the user before each step)
1. Blaze plan on `skinmatrixgh` (Functions need it).
2. `npm run build && firebase deploy --only functions,firestore:rules,hosting`.
3. The owner signs in at `/admin/` with the account in `admins/{uid}` and presses "Set up the shop as owner". Then: Account → set PIN; Products → barcodes and costs; Stock → Receive delivery for the opening stock; Team → add staff.
4. On the till PC: Help → Receipt printer (80 mm paper, margins None, optional `--kiosk-printing`).

## Verified (2026-09-28)
- `npm test` 17/17, `npm run test:functions` 30/30, `npm run build` passes (storefront still preloads only the same 240 kB chunk as before).
- Browser pass on the emulators:
  - open drawer; cash sale with VAT/NHIL/GETFund receipt;
  - offline sale (simulated) with a provisional receipt, auto-synced as sale 2;
  - close drawer short by GHS 10 with a note;
  - storefront pay-later order placed through `placeWebOrder` and shown in Website orders;
  - Settings page; drawer page at 375 px.
- **Not verified:** real Paystack (test keys) end to end with the webhook, a real mNotify SMS, deploy.

## Open work, in priority order
1. Deploy (ask first): set both secrets, `npm run build && firebase deploy --only functions,firestore:rules,hosting`, add the Paystack webhook URL. Then place a Paystack **test-mode** order to check verify + webhook.
2. Confirm the tax rates and the TIN format with the accountant before turning VAT on.
3. Offline: a service worker so the admin page can also be *reloaded* while offline. Consider App Check on `placeWebOrder` if spam orders appear.
4. The editor's own `inStock` flag still exists; `site/availability` overrides it once a product has stock records.

## Conventions
- Money is always integer pesewas (`src/admin/lib/money.js` for display and parsing).
- Business day = UTC date (= Ghana).
- New business rules go in `functions/src/core/*` or a handler, with a test in `functions/test/handlers.test.js`.
- Admin styling: `src/admin/admin.css` only, mobile first, Inter for UI and Satoshi for headings.
