# SkinMatrix Operations Implementation Plan

## Purpose

Build the staff-facing operations system separately from the public SkinMatrix experience. The public site remains an editorial, customer-facing beauty and wellness storefront. The operations system serves staff who manage catalog, inventory, customer orders, walk-in sales, fulfilment, and reporting.

This plan describes the intended production system. It does **not** mean live authentication, payments, inventory, or order writes are implemented yet.

## Product boundary

| Public storefront | Staff operations |
| --- | --- |
| Discovery, products, routines, customer bag and checkout | Protected staff workflows only |
| Premium editorial and motion-led visual system | Fast, calm, information-dense operational interface |
| Customer product and wellness language | Exact orders, payments, stock, branches and audit history |
| Customer-facing routes | Isolated `/admin` route and future staff-only APIs |

Do not let an operational dashboard dilute or alter the public homepage.

## Phase 1 — Admin frontend prototype

Create a responsive `/admin` surface using explicitly labelled local demo data. It must be navigable and demonstrate the complete staff workflow, but must not pretend to process live payments or write to production data.

### Core areas

1. **Staff access gate**
   - A sign-in UI and role/branch context display only.
   - No fake authentication claims; document the future Firebase Auth/custom-claims contract.

2. **Operations overview**
   - Today's retail sales, paid orders, orders needing attention, low-stock lines and outstanding mobile-money holds.
   - Branch selector shown only when the staff role allows cross-branch access.

3. **Order management**
   - Search and filter by order number, customer, date, status, payment state, sales channel and branch.
   - Detail view with an immutable order snapshot, item lines, totals, fulfilment assignment, status history and staff activity.
   - Safe action UI for permitted status transitions, cancellation/voiding with required reason, and staff note entry.

4. **POS / walk-in orders**
   - Fast product search, cart, quantity changes, branch-bound availability, and optional customer details.
   - Separate cash and mobile-money flows.
   - Receipt/transaction record after a completed demo sale.
   - POS activity must be visually and semantically distinct from web orders.

5. **Inventory and branch availability**
   - Product-level and variant-level stock display by branch.
   - Low-stock state and stock-movement history UI.
   - A future stock adjustment must always require a reason and create an immutable audit entry.

6. **Sales ledger and audit log**
   - Daily branch sales, payment-method totals, refund/void counts, and staff activity.
   - Auditable records for status change, sale creation, void, POS correction, inventory adjustment and payment exception.

## Phase 2 — Backend and security contracts

Do not wire the frontend directly to mutable order or inventory documents. Implement these backend contracts before any live operations launch.

### Roles and branch scope

- Use Firebase Auth with custom claims and a staff profile.
- Typical roles: `cashier`, `branch_manager`, `inventory`, `operations_manager`, `superadmin`.
- Every action receives the verified staff identity and branch scope server-side.
- A branch employee can read and act only on their assigned branch. Cross-branch visibility is explicit and role-gated.

### Money and snapshots

- Store all monetary totals as integer pesewas. Format only at the UI edge.
- Recalculate catalog price, discount, tax and availability server-side. Never trust browser totals.
- Persist the product/title/price/variant/tax/discount snapshot that was actually ordered.
- Each external payment reference and operational command needs an idempotency key.

### Inventory

- Inventory decrement, restore, reservation and adjustment occur only in a trusted server transaction.
- Stock belongs to a specific branch and product/variant stock pool; a missing branch value means unavailable, not fallback global stock.
- Record the exact deductions on each finalized order so that a cancellation can restore stock once and only once.
- Do not decrement inventory in client code.

### Order state model

Recommended starting states:

`Draft → Awaiting payment → Paid → Processing → Ready → Fulfilled`

`Cancelled` is terminal after a restock. Each transition must validate actor permission, current state and reason where required. Append each accepted transition to immutable `statusHistory` and an operations activity log.

### POS payment model

| Payment method | Required production behavior |
| --- | --- |
| Cash | One server transaction: validate live price and branch stock, create completed POS sale, decrement recorded stock, append audit event. |
| Mobile money | Create a short-lived branch-stock reservation before initiating charge. Settle the payment idempotently only after verified success; release the exact reservation on decline, cancellation or expiry. |
| Exception | A late/incorrect/unmatched payment becomes a visible exception record. Do not silently create a sale or alter stock. |

### Corrections, voids and refunds

- A completed POS sale may only be edited within a defined role- and time-bound policy.
- Any correction must include an operator, reason, before/after values and calculated inventory delta.
- A void/cancellation restores only the stock deductions recorded for that order, in the same trusted transaction, and only once.
- A live paid amount must never be silently changed. Use a controlled refund/adjustment flow.

## Phase 3 — Integration and operational testing

1. Define Firestore data model, indexes and security rules before writing production data.
2. Implement callable/HTTP service functions for order transitions, POS cash finalization, mobile-money reservation/settlement/release, stock adjustment and correction.
3. Add server tests for idempotency, authorization, stock contention, duplicate webhooks, payment expiry, void/restock and cross-branch denial.
4. Connect the isolated admin UI to those APIs behind staff authentication.
5. Run staff acceptance testing with test catalog and test payments only.
6. Obtain explicit approval before any Firebase, payment, rules or production deployment.

## Definition of done for the next implementation pass

- `/admin` is distinct from the public experience and usable on desktop and tablet.
- All prototype data is visibly identified as local/demo data.
- Walk-in POS, order list, order detail, inventory and ledger flows are navigable.
- The frontend documents where a trusted server action is required.
- No credentials, live payment calls, production Firestore writes or deployments were added.
- `npm run build` passes.
