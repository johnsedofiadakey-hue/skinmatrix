# Admin Prototype — Implementation Note

Companion to [`OPERATIONS_IMPLEMENTATION_PLAN.md`](OPERATIONS_IMPLEMENTATION_PLAN.md). Describes how the Phase 1 `/admin` prototype is built and where it stops.

## Isolation from the public storefront

- `/admin` is a **separate Vite HTML entry** (`admin/index.html` → `src/admin/main.jsx`). It never imports public code or CSS, and the public bundle never loads admin code.
- Public files (`index.html`, `src/main.jsx`, `src/App.jsx`, `src/MatrixScene.jsx`, public CSS) are **not modified**.
- Shared config touched: `vite.config.js` (second build input, a dev/preview redirect from `/admin` to `/admin/`, Vitest config), `firebase.json` (`/admin` rewrites placed before the `**` catch-all; not deployed), `package.json` (`test` script, `vitest` dev dependency).
- Admin styles live in `src/admin/admin.css`, loaded only by the admin entry, with their own tokens and fonts (Satoshi for figures/headings, Inter for UI). Verified: the public bundle contains no admin CSS or JS.

## Structure

```
admin/index.html                 second entry (noindex)
src/admin/
  main.jsx, AdminApp.jsx         shell: sign-in gate, nav, role/branch context, DEMO banner
  OpsContext.jsx, hooks.js       provider (store, session, toasts) and the hooks views use
  components/                    shared UI (pills, dialogs, ServerNote) and display formatting
  admin.css
  lib/money.js                   integer pesewas; formatting only at the UI edge
  lib/permissions.js             role capabilities + branch scope
  lib/orderStates.js             state model and permitted transitions
  lib/stock.js                   stock deltas, availability status
  lib/ledger.js, lib/time.js     business-day keys (Ghana, UTC+0), ledger totals
  lib/attention.js               why an order needs a person now
  lib/customers.js               phone normalisation (233…), WhatsApp/call links, customer records from orders
  lib/routing.js                 which branch fulfils a paid web order
  lib/walkInImport.js            spreadsheet parsing and validation for walk-in items
  demo/seed.js                   deterministic demo branches, staff, catalog, orders
  demo/opsStore.js               in-browser SIMULATION of the future trusted server
  views/*                        Overview, POS, Orders, OrderDetail, Customers, Inventory (Stock / Expiry /
                                 Stock take / Value), Products, Payments, Ledger, Audit
```

## The demo server boundary

`demo/opsStore.js` exposes one async method per future server command (`completeCashSale`, `startMomoSale`, `settleMomoPayment`, `releaseMomoHold`, `setOrderStatus`, `correctPosSale`, `adjustStock`, `resolveException`, …). Each method:

- receives the acting staff member and re-checks role and branch scope itself,
- receives only `variantId + quantity` from the UI and re-prices from the catalog,
- runs against a cloned state and commits all-or-nothing (models a transaction),
- appends to the audit log and stock-movement history.

Views never mutate state directly; they call these methods. In Phase 3 the file is replaced by a thin client over authenticated callable functions with the same signatures. **It is a simulation: nothing it does is enforced by a real server, and the UI says so.**

Demo state persists in `localStorage` for convenience and can be reset from the UI.

## Rules the simulation follows (from the plan)

| Rule | Where |
| --- | --- |
| Money in integer pesewas | `lib/money.js`, all seed and store values |
| Order snapshot + immutable `statusHistory` | `opsStore.js` order creation / `setOrderStatus` |
| Branch-scoped access | `lib/permissions.js`, re-checked in every store method |
| Cash sale = one atomic step | `completeCashSale` |
| MoMo reserve → settle once / release once, exceptions for unmatched payments | `startMomoSale`, `settleMomoPayment`, `releaseMomoHold`, `sweepExpiredHolds` |
| Cancel/void needs a reason, restocks recorded deductions exactly once | `setOrderStatus` |
| POS correction: role/day bound, reasoned, stock deltas, live MoMo total locked | `correctPosSale` |
| Stock adjustment needs a reason and writes an audit entry | `adjustStock` |

## Operations features adopted from the Lollarod reference (pass 2)

Patterns studied read-only in the Lollarod project and rebuilt for SkinMatrix (no code or data copied):

| Feature | Behaviour |
| --- | --- |
| MoMo paid to the shop number | Default counter MoMo flow: the cashier records network, transaction ID and amount received. One atomic sale like cash. A transaction ID can only be recorded once. Editable in a correction like cash. |
| MoMo prompt (live charge) | Kept from pass 1: reserve → settle once / release once; exceptions for unmatched payments. Its total stays locked. |
| Keyboard-first POS | `/` or F2 search, Enter adds first match, F8 pay, C / M / R payment method, N new sale, P print; grid/list view remembered per device; 72 mm receipt printing. |
| Stock take | Blind count per batch, note required when lines differ, refused as a whole if stock moved mid-count (stale lines refreshed for recount), kept as a record. |
| Delivery flow | `Ready → Out for delivery → Fulfilled` for deliveries (pickups go `Ready → Fulfilled`); a rider (name, phone, vehicle, plate) is required before dispatch. |
| Web order routing | A paid web order goes to a branch that can supply every line (most units wins). If none can, it waits with no stock taken until an operations manager picks a branch; stock is taken in that same step. |
| Customer records | Keyed by normalised phone; lifetime spend counts only collected, un-reversed sales; returning-customer hint at the till; WhatsApp and call links. |
| Branch sales report | Days × branches with presets (today, yesterday, 7 days, this month, all), best day, per-branch payment breakdown, CSV. |
| MoMo reconciliation | Today's recorded MoMo payments with transaction IDs, to tick off against each branch statement. |
| Walk-in-only items + import | Counter-only products; paste/upload a sheet; new SKUs only; a cost column is never used as the price; opening stock recorded as batches. |
| Stock value | Units × selling price by branch and category; expiring and expired value shown separately. |

Deliberately **not** adopted yet: GPS geofencing / attendance (needs an owner decision on staff location tracking), stock transfers (branches only, no warehouse), shared inventory pools (not needed for this catalogue).

## Batch and expiry tracking (SkinMatrix-specific)

Stock is held in batches (`lot`, `expiresOn`, `quantity`) per variant per branch, with explicit branch listings. Sales take the soonest-expiring batch first; a batch stops being sellable the day after its expiry date. Every order, hold and movement records the batch it touched, so cancellations and corrections return units to the exact batch and a recall can trace which orders received a lot. Deliveries arrive as new batches with lot and expiry; expired stock is written off in one audited step.

## Tests

`npm test` runs Vitest over `src/admin/**/*.test.js`: money, permissions, transitions, stock deltas and ledger totals, plus the store's contracts (idempotent cash sale, atomic failure, MoMo reserve → settle once / release once / expiry / late payment and wrong-amount exceptions, void restocks once, same-day void rule, POS correction deltas, live-MoMo total lock, stock adjustment rules, exception resolution without a sale).

## Found while building (carry into Phase 2/3)

- **Idempotency keys belong to an attempt, not a cart.** After a MoMo hold is declined or cancelled, retrying the same cart must mint a new key; replaying the old key correctly returns the closed hold. The POS does this. A real client must do the same.
- **Branch reassignment after stock is taken needs a server-side stock transfer.** The prototype only allows moving an order before any stock is deducted.
- **Changing a sale's payment method after completion is not supported.** Corrections change quantities only; a live MoMo sale's total is locked. A controlled refund flow is still needed.
- **Lot codes are only unique per product.** Two sizes of one product can share a lot number, so every screen and label that names a batch also names the product, size and SKU.
- **Refunds are flagged, not executed.** Cancelling a paid MoMo/card order marks `refund_due`; cash voids are recorded as refunded at the counter.

## Out of scope for this pass

Real authentication, Firestore, Paystack, SMS, receipt printing hardware, catalog editing, deployment.
