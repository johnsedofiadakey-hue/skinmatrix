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

**Commands:** `placeWebOrder`, `verifyWebPayment` (public), `paystackWebhook` (HTTP), `openShift`, `cashMovement`, `closeShift`, `saveShopSettings`, `completeSale`, `voidSale`, `returnItems`, `updateWebOrder` (confirm takes stock; cancel puts it back), `receiveDelivery`, `adjustStock`, `writeOffExpired`, `submitStockCount` (refused with `details.stale` if stock moved mid-count), `saveProductSetup`, `saveProduct` (`src/products.js`: one form writes catalog + catalogOps + catalogCosts + opening batch in one transaction), `saveSupplier`, `claimOwner`, `createStaff` (name + username + optional password; generates one if blank), `setStaffLogin` (owner changes a staff username/password; revokes tokens), `updateStaff` (turning someone off disables Auth and revokes tokens; there is always one active owner), `setMyPin`, `recordSignIn`.

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
- Views: `Home`, `Sell` (POS; offline queue in `components/offline.jsx`), `Drawer` (cash drawer + `DrawerReport`), `Settings` (owner: VAT, SMS, SMS log), `Sales` (reprint, WhatsApp, return, cancel), `WebsiteOrders`, `Stock` (list, batches, adjust, receive delivery, stock take, write-off), `Reports` (money, cash in drawer, profit, by staff, best sellers, activity log, printable day summary, CSV), `Products` (route `#/setup`: list with filters, one product form, `pos/ReceiveStock.jsx` quick receive), `Team`, `Website` (other agent's editor, owner only), `Account` (password, approval PIN, auto-print), `Help`.
- Every page has a `Guide` (how-to box that can be folded away; remembered per device).
- **Receipts:** `components/receipt.jsx`. `PrintArea` is portalled into `<body>`; `@media print` in `admin.css` prints only it at 80 mm (`@page size 80mm`). Auto-print is a per-device option. WhatsApp receipts use `wa.me`.
- **Scanners:** `components/scanner.jsx`. USB/Bluetooth scanners are detected as fast keystrokes + Enter when no text box has focus (keys ≤ 120 ms apart, Enter within 400 ms). Camera: native `BarcodeDetector`, else lazy-loaded `@zxing/browser`. Needs HTTPS.

**Till hardware and cash register (added 2026-11-10):**
- **Per-device settings.** `src/admin/till/device.js` holds them in localStorage `skinmatrix-till`: printer mode, drawer, customer screen, MoMo number to show. They are edited in the **Till setup** page (`#/till`, `views/Till.jsx`).
- **Printing.** `till/escpos.js` is the pure ESC/POS encoder for the sale receipt, No sale, X reading, drawer slip and Z report, with tests in `escpos.test.js`.
  - With the desktop app (`window.skinmatrixTill`), slips print raw, and cash sales and cash refunds kick the drawer.
  - Otherwise slips use the browser print window (`till/printing.jsx`).
- **Customer screen.** `/admin/display.html` (`src/display/`) has no Firebase and no sign-in. The till publishes basket, payment and thank-you state over the BroadcastChannel `skinmatrix-customer-display` (`till/display.js`). The browser places it with the Window Management API.
- **Cash register (server, `functions/src/register.js`):**
  - `recordNoSale` logs a drawer opening (audit type `drawer`, increments `shifts.noSales`). It is idempotent, and the till can queue it offline through `LiveProvider.queueCall`.
  - `closeDay` writes `zReports/{day}`, numbered Z0001 and up via `counters/zReports`. It runs once per day and refuses with `drawers_open` unless `allowOpenDrawers` is set. Pure summary: `core/zreport.js`.
  - UI: Reports → Close the day; Cash drawer → Print X reading and closing slip.
  - Rules: `zReports` is readable by managers.
- **Offline start-up.** `/admin/sw.js` is built by the `adminServiceWorker` plugin in `vite.config.js` from `src/admin/sw-template.js`. It precaches every admin and display chunk.
- **Desktop app.** `desktop/` (Electron 45) is described in `desktop/README.md`. It has a sandboxed preload with 5 calls; IPC accepts the app origin only. Raw printing uses the Windows spooler through a persistent PowerShell worker, CUPS `lp -o raw` on Mac, or TCP 9100 to private IPs only. The customer window is not focusable on the second monitor. Its default URL is `skinmatrixgh.web.app` (MTN DNS blocks the .com).
- **Verified on emulators:** the customer screen live through basket, change and thank-you; No sale; Z report close and print; Electron cash sale printing a receipt plus drawer kick to a fake TCP printer.
- **Not verified:** a real printer or drawer, Windows (spooler path), a real second monitor, the installer build.

**POS and till upgrade (2026-11-10, second pass):**
- **Usernames.** Staff sign in with username + password. Username `ama` is Firebase Auth email `ama@staff.skinmatrixgh.com` (`core/rules.js`: `usernameEmail`, `signInEmail`, `usernameOf`). Typing a full email still works (owner). Existing staff keep their email until the owner gives them a username in Team (`setStaffLogin`).
- **POS** (`views/Sell.jsx`, `pos.css`): full-screen, touch first (tiles, chips, 56 px+ targets), ticket panel, Pay screen with keypad (`pos/Keypad.jsx`, also takes the physical keyboard), done screen, Hold/Resume (`pos/held.js`, localStorage `skinmatrix-held-sales`, per device). The admin menu opens as a sheet from the POS header.
- **Theme** (`src/admin/theme.js`): `data-theme` on `<html>`, set before paint in `admin/index.html`; choice in localStorage `skinmatrix-theme` (system/light/dark). Dark tokens in `admin.css`; receipts always print on white.
- **Customer screen:** shows only the current sale and the amount to pay; idle = slideshow of in-stock products with photos (`src/display/`).
- **Screen placement (desktop app):** `desktop/lib/screens.js` `pickScreens`: saved choice (config `tillScreen`/`customerScreen`) wins; otherwise the automatic choice is REVERSED for the shop's terminal (customer view on the touch-reporting screen, else on the main display). **Swap screens** (POS header, Till setup, Ctrl+Shift+S; `till/display.js` `swapScreens`, works with app 1.1.0+) saves the opposite. App 1.3.0: the saved choice also stores each monitor's place and name/size (`fingerprint`), because Windows can change display ids after a restart (that lost the choice every restart). The customer window is a normal window (minimise/maximise/close), opened maximised; dragging it (or the till, or Win+Shift+arrow) to the other monitor saves that as the choice and moves the other window across (`rememberPlacement`). Keyboard focus returns to the till after the customer window is used, so scans are not lost. It never opens the customer window on the till screen; with one screen it opens nothing unless a preview is asked for (Ctrl+Shift+D). IPC: `listScreens`, `chooseCustomerScreen`, `identifyScreens`.
- **Till setup** (`views/Till.jsx`): 3 steps (printer, drawer, customer screen), each with a test and a "Did it work?" question that shows fixes. The printer test page (`escpos.js` `printerTestOps`) has a width ruler, styles, a sample receipt and a cut. Passed checks are stored per device in `till.checks`, tied to the printer settings.
- **Verified locally:** POS in light and dark, MoMo sale, customer display basket + idle slideshow, username sign-in, add product with opening stock, receive stock; Electron: one screen → no customer window, preview on request, printer test page + cut received by a fake TCP printer. `npm run test:functions` 34/34, desktop tests 10/10.
- **Not verified:** a real printer/drawer/second monitor, the Windows build of this version (rebuild the installer: `cd desktop && npm run dist:win`).
- **Not deployed:** the live functions predate commit d93e51d. Deploy needs both secrets set first.

**MoMo prompts at the till (2026-11-11):** `functions/src/momo.js` + `core/momo.js`; till side `src/admin/pos/momoPrompt.jsx`.
- Pay → MoMo → "Prompt on their phone": the cashier types the number (network from the prefix), `startMomoPrompt` prices the sale on the server, checks stock and discount approval, saves `momoCharges/{POS-…}` (no client access) and calls Paystack `POST /charge` (mobile_money). The till polls `checkMomoPrompt` every 4 s (server calls `/transaction/verify`); the webhook (`charge.success`, reference `POS-…`) does the same. Success → `completeSale(ctx, sale, { prompt })` saves the sale once (payment `{ method: 'momo', prompt: true, reference, phone masked }`).
- Edge cases are recorded in `audit` (type `momo_prompt`) for a manager to refund in Paystack: approved after Cancel (`paid_after_cancel`), two approved prompts for one sale (`duplicate`), stock gone by approval time (`paid_not_sold`), wrong amount (`mismatch`). OTP networks: `submitMomoOtp`.
- Off until a real `sk_test_`/`sk_live_` key is set (`momoPromptReady`); the old "customer sends to shop number" stays. Test mode shows a banner on the Pay screen. Local testing: start emulators with `PAYSTACK_TEST_BASE=http://127.0.0.1:9500` (emulator only) and a pretend Paystack.
- **Not verified:** real Paystack (test or live) — especially Telecel's flow and the exact `abandoned` timing.

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
4. On the till PC: install the desktop app, sign in, then Till setup → run all three checks.

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

## Offline-sale disk backup and failure guards (desktop 1.4.0, 2026-11-11)
- `desktop/lib/backup.js`: every change to the offline queue is mirrored to `Documents\SkinMatrix Till Backups\unsent-<uid>.json` (temp file + fsync + rename) and every offline event (made/sent/problem/removed/restored) is appended to `offline-sales-YYYY-MM.csv` (UTF-8 BOM, formula-safe cells). Optional second folder (`backupFolder` in till-config.json, set from Till setup). One folder failing is reported, all failing throws.
- IPC: `till:backupUnsent`, `till:readUnsent`, `till:logOffline`, `till:backupInfo`, `till:openBackupFolder`, `till:chooseBackupFolder`. Dev-only override `SKINMATRIX_TILL_BACKUP_DIR`.
- `LiveProvider`: on start, restores sales present on disk but missing from localStorage (safe: `completeSale` is idempotent per `requests/{uid}_{requestId}`), then mirrors. Writes run one at a time on `backupChain`.
- Main process reloads the page on `render-process-gone`.
- `src/admin/live/risks.js` (`tillWarnings`): clock off by more than 5 min (Date header of a HEAD to /admin/index.html), unsent sales 2+ days old while offline (urgent at 5, 7-day server limit), backup failures. Shown as banners on the POS.
- Switch user / Sign out need a second tap when this person has unsent offline sales.
- Verified locally in Electron with emulators: offline sale → disk files; localStorage wiped + reload → restored and sent once (no duplicate on the server).

## Open on wake (desktop 1.5.0, 2026-11-11)
- The shop's power button is set to hibernate. Login items don't run on resume, so `desktop/lib/autostart.js` registers a per-user Windows scheduled task "SkinMatrix Till (open on wake)" (UTF-16 XML through schtasks /Create /XML): triggers are sign-in, SessionUnlock, ConsoleConnect, and the Power-Troubleshooter event 1 (resume). If event triggers are refused it falls back to sign-in and unlock only. Created once per exe path and version (`autoStartTask` in till-config.json); removed when `startOnLogin` is false and by the uninstaller (`build/installer.nsh`).
- `powerMonitor` resume and unlock-screen events, and second-instance launches, call `wakeUp()`: reload if the page crashed, restore and show the till, `relayout()` both screens.
- Till setup shows the status from `till:info().autoStart`.
- Not verified on Windows (built on a Mac); the schtasks call is unit-tested with a fake schtasks.

## Automatic till app updates (desktop 1.6.0, 2026-11-11)
- `desktop/lib/updates.js` uses electron-updater (generic provider) with `https://skinmatrixgh.web.app/till-updates/`. It checks 1 minute after start, then every 4 h, and downloads in the background. It installs (silently, then reopens) only on wake from sleep/hibernate when no sale is on screen (`till:setBusy` from Sell), on app quit, or from Till setup → "Restart and update now".
- **To release a new till app version:** bump `desktop/package.json` version → `cd desktop && npm run release` (builds and copies into `public/till-updates/`, which is gitignored) → `cd .. && npm run build && firebase deploy --only hosting`.
- **Warning:** any hosting deploy from a checkout without `public/till-updates/` removes the update files from the site. Installed tills then just find no update; run `npm run release` again to restore them.
- Firestore backup schedules (gcloud): daily, kept 7 days; weekly on Sunday, kept 14 weeks.
- Installer filename is now `SkinMatrix-Till-Setup-<version>.exe` (no spaces). It can also be downloaded on the till from the URL above.

## Photos, barcode stickers, customers, day-summary SMS (2026-11-11)
- **Product photos:** `src/admin/pos/photo.js` shrinks in the browser (≤1000 px, WebP 0.82 / JPEG fallback, ≤650 KB). `uploadProductPhoto` (functions/src/photos.js) sniffs the bytes (jpg/png/webp), max 700 KB, stores `photos/<24hex>.<ext>` in Firestore as Bytes (no client rule, so denied to browsers). `productPhoto` (HTTP, public) serves `/photos/**` through a hosting rewrite with a one-year immutable cache. Firestore was used because Cloud Storage is not enabled and the functions service account has no storage role (IAM is the user's call). The `/photos/` URL only works behind hosting (not on the Vite dev server).
- **Barcode stickers:** `src/admin/pos/labels.js` makes in-store EAN-13 numbers `20` + 10 random digits + check digit (GS1 prefix 2 = in-store, never a manufacturer's). ESC/POS ops gained `{ barcode }` (GS k 67 EAN-13 with 12 digits, CODE128 otherwise; HRI below) and `{ cut: true }`. `Stickers.jsx`: direct print via `printOps`, or the browser print window with SVG stickers (one per page). ProductForm: "Make a barcode" when empty; "Print stickers" once the barcode is saved.
- **Customers:** `customers/{2332XXXXXXXX}` {name, phone, visits, totalSpent, firstVisit, lastVisit, lastSaleId}, written only inside the completeSale / voidSale / returnItems transactions (functions/src/customers.js). Rule: staff read, no client writes. Page `#/customers` (viewSales). POS customer dialog reads the record to fill in the name.
- **Day summary SMS:** settings `sms.daySummary` + `sms.ownerPhone`. After `closeDay` commits, `textDaySummary` texts takings by method, refunds, cancels, drawer differences and low stock (catalogOps.reorderPoint vs stock) via mNotify. Never fails the close. Needs MNOTIFY_API_KEY and SMS turned on.
