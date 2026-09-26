# SkinMatrix — Agent Handover

Last updated: 2026-09-26. Read this first, then `CLAUDE_HANDOVER.md` (original brief) and `docs/ADMIN_IMPLEMENTATION_NOTE.md` (admin design detail).

## The business
- **One shop** (single branch) in Ghana selling skincare and supplements. Prices in GHS. Stock lives at the shop only; there is no warehouse.
- Two surfaces:
  1. **Public storefront** — `index.html` → `src/main.jsx` → `src/App.jsx` (+ `styles.css`, `overrides.css`, `shop-panel.css`, `brand-products.css`, `MatrixScene.jsx`).
  2. **Staff operations prototype** — `/admin` → `admin/index.html` → `src/admin/**`. Isolated: it never imports public code or CSS.

## Working-tree warnings (read before touching anything)
- **Another agent edits the public site in this same folder.** `src/App.jsx`, `src/main.jsx`, the public CSS files, `public/assets/products/` and `work/*.png` have uncommitted changes that are not from the admin work. Don't revert, stash or overwrite them. Coordinate before editing public files.
- Git: one local commit, `e134930 Baseline: public storefront before admin prototype`. **Everything since is uncommitted.** The GitHub repo `https://github.com/johnsedofiadakey-hue/skinmatrix` is **empty** and has no remote configured here. Nothing has been pushed or deployed. Ask the owner before committing or pushing, and keep admin and public changes in separate commits.
- Firebase: the owner shared the web config for project `skinmatrixgh` in chat. It has **not** been added to the code. Web API keys are public by design, but don't wire Firebase, Auth, Firestore or payments until the backend contracts (Phase 2 in `docs/OPERATIONS_IMPLEMENTATION_PLAN.md`) are built. Never commit service-account keys or secrets.
- Lollarod (`/Users/truth/Developer/lollarod Project/lollarod`) is a **read-only** reference. Never edit it or read its `.env`/credentials.

## Run and verify
```bash
npm install
npm run dev -- --port 5181   # public: /   admin: /admin (redirects to /admin/)
npm test                      # Vitest: 52 tests over src/admin/**/*.test.js
npm run build                 # both entries
```
`.claude/launch.json` defines `skinmatrix-dev` on port 5181 (5173 is often taken by the other agent's server).

Demo sign-in PINs (demo only, shown on the sign-in screen): Owner 9000 · Manager (Kwame O.) 5000 · Staff (Akosua M.) 1111 · Staff (Yaw B.) 2222. Kofi T. is a deactivated account. Demo data lives in the browser's `localStorage` (`skinmatrix-ops-demo`). "Reset demo data" in the banner reseeds it. Bump `SEED_VERSION` in `src/admin/demo/seed.js` whenever the data shape changes.

## Admin: what exists (all demo data, no live services)
Architecture: `src/admin/demo/opsStore.js` **simulates the future trusted server**. One method per server command; it re-checks role and PIN approvals, re-prices from the catalog, runs each command as all-or-nothing on a copy, and writes the audit and stock movement logs. Views only call these methods. Phase 3 replaces this file with a client for real Firebase functions that have the same names. Pure business rules live in `src/admin/lib/*` and are unit-tested.

- **Roles** (`lib/permissions.js`):
  - Staff: POS, orders, read-only stock lookup; discounts up to 10%.
  - Manager: plus voids and corrections on the same day, returns, stock work, deliveries, reports, audit. Approves staff with their PIN.
  - Owner: everything, including products and prices, the Staff page, and voids or returns on any day.
  - When a staff member lacks a permission, the server answers `approval_required`. `OpsContext.run()` then opens the manager-PIN dialog and retries the command with `approval: { approverId, pin }`, which the server verifies. Both names are recorded.
- **Staff page:** add staff, change role, deactivate (accounts are never deleted), reset PIN; "Switch user" and "My PIN" in the sidebar. The owner can't lock themselves out, and there is always an active owner.
- **POS:** cash; MoMo paid to the shop number (transaction ID can only be recorded once); live MoMo prompt (stock reserved, then settled or released exactly once, and unmatched payments become exceptions); cart discount with reason and the staff limit; barcode scanning (exact barcode or SKU on Enter; stray digits go to search); keyboard shortcuts; 72 mm receipt.
- **Orders:** queue and filters; fixed record of what was ordered; history; notes; delivery flow with rider details; void/cancel with a reason (manager PIN for staff); same-day correction; **returns** (partial or full, resaleable units go back to their batch, damaged units stay off the shelf, refund is the paid share after discount, a MoMo refund needs a reference, a 30-day window after which only the owner can accept).
- **Stock:** batches with lot and expiry, soonest expiry sold first, expired stock can't be sold and is written off in one step, stock take (blind count, refused if stock moved during the count), stock value.
- **Products (owner):** create and edit products and sizes, SKU, EAN-13 barcode, price, cost, website visibility, archive (sizes are never deleted); price history; walk-in spreadsheet import (a cost column is never used as the price).
- **Deliveries (manager/owner):** suppliers; receive a delivery where each line creates a batch with its **unit cost**, which is what margin uses.
- **Sales:** net sales = collected − returns; discounts; gross margin from the cost of the batches actually sold; products & margin table; sales by staff; CSV export.
- Also: customers (keyed by phone, WhatsApp/call links), payments (MoMo reconciliation, exceptions), overview, audit log.

## Verified vs not verified (as of this handover)
- ✅ `npm test` 52/52, `npm run build` passes. Every admin page renders for owner and staff with no console errors, and staff are blocked from owner/manager pages.
- ✅ **Manual UI pass done 2026-09-26** (staff Akosua + owner): SKU/barcode scan, over-limit discount → manager-PIN dialog (wrong PIN refused, no order written; both names on order + audit), partial return with discount-adjusted refund, product editor (duplicate SKU and bad EAN-13 refused), receive delivery (batch with lot/expiry/unit cost; past expiry blocked), Staff page (add, role change, PIN reset, deactivate; owner row has no self-actions). Approval dialog checked at 768 px.
- Fixed in that pass: a wrong approver PIN now re-asks instead of dropping the sale (`OpsContext.run`); approval wording ("A manager or the owner can approve…"); double full stops after names ending in "." in two messages.
- Note: the in-app browser pane can mis-map click coordinates; driving the page with DOM events via javascript_tool was reliable.

## Open work, in priority order
1. **Public-site font** (requested 2026-09-26, **blocked on the owner**):
   - Identified as **Crox™ 2.0 by NumidiaType** (designer Yassine Abdi): a paid geometric sans with 10 weights plus italics, 20 styles in all. It's sold on MyFonts (https://www.myfonts.com/collections/crox-font-numidiatype) and Fontspring. Webfont licence: about $25 per style, $84 for the 6-style Basic Pack, $170 for the family. There are no free styles. A separate **Crox Rounded** family also exists.
   - **Waiting on the owner for:** (a) buying a webfont licence and putting the `.woff2` files in `public/fonts/` (at least regular, medium and bold); (b) confirming Crox or Crox Rounded (the specimen looked slightly rounded); (c) confirming whether this agent may edit the public-site files, which the original brief assigned to another agent who still has uncommitted changes there.
   - **Never** use the free-download copies on sites like befonts: they're unlicensed.
   - **When unblocked:** self-host with `@font-face` (`font-display: swap`) and replace DM Sans in the public CSS (`src/styles.css` loads DM Sans, DM Mono and Playfair Display via a Google Fonts `@import`). Keep Playfair and DM Mono unless the owner says otherwise. Check `npm run build`, and check the homepage on desktop and mobile.
2. **Shift and cash-up** (recommended to the owner, not built yet): opening float, cash paid out, counted vs expected cash at close, difference recorded per cashier, end-of-day report. Recorded MoMo, cash refunds and cash change all feed the expected cash.
3. SMS to customers (order ready / out for delivery); VAT/NHIL/GETFund on receipts if the business is VAT-registered (confirm with the accountant); an offline-selling decision.
4. Phase 2/3 backend: Firestore model and rules, callable functions matching `opsStore.js`, Firebase Auth with role claims, PIN verification with a proper slow hash and lockout (`lib/demoPin.js` is **demo only**).

## Other open questions for the owner
- Commit and push? Suggested: commit the admin work on its own branch (for example `admin-prototype`), kept separate from the public-site agent's changes, then push to the empty GitHub repo. Not done yet; wait for a yes.

## Conventions
- Money is always integer pesewas; format with `lib/money.js` only for display.
- Business day = Ghana/UTC date (`lib/time.js`).
- Every new rule gets a pure function in `lib/` or a store method plus a Vitest test.
- Admin styling: `src/admin/admin.css` only, Inter for UI and Satoshi for headings (fonts loaded in `admin/index.html`).
