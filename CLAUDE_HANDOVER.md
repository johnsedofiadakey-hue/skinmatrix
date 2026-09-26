# Claude Handover — SkinMatrix Operations

## Your ownership

You own the SkinMatrix **staff operations frontend**. Build an isolated `/admin` prototype for the team that will manage products, orders, inventory, walk-in sales and reporting.

The public customer experience is actively owned elsewhere. Do **not** redesign, refactor or restyle its homepage, editorial sections, shop drawer, matrix scenes or public interactions. Keep all operations code isolated from the public surface.

## Start here

1. Read [`docs/OPERATIONS_IMPLEMENTATION_PLAN.md`](docs/OPERATIONS_IMPLEMENTATION_PLAN.md).
2. Inspect the current project structure and preserve existing public behavior.
3. Create a concise implementation note before building. Update the plan if you discover a needed change.

## Lollarod: read-only reference

Use `/Users/truth/Developer/lollarod Project/lollarod` as a source of operational design patterns, not as a source to copy from or modify.

Read, in this order:

1. `CODEX_HANDOFF.md`
2. `functions/pos.js`
3. `functions/posEdit.js`
4. `functions/orders.js`
5. `src/components/admin/POSTerminal.jsx`
6. `src/components/admin/AdminOrders.jsx`
7. `src/components/admin/OrderDetailsModal.jsx`
8. `src/components/admin/AdminSalesLedger.jsx`
9. `src/lib/branchOrdersFilter.js`
10. `src/lib/inventoryPool.js`

Never edit Lollarod. Never read, print, copy, commit or alter its `.env`, credentials, Firebase project settings or production data. Do not transfer its branding, code, business data or project identifiers into SkinMatrix.

## What to build

Build a responsive `/admin` frontend prototype with plainly labelled local demo data. The next implementation pass should include:

- Staff sign-in gate UI only, plus visible role and branch context.
- Operations overview with sales, order attention, inventory and payment-hold signals.
- Searchable and filterable order queue.
- Order detail with immutable item snapshot, timeline, notes, branch assignment and safe action UI.
- Inventory overview with per-branch availability and low-stock signals.
- Cashier POS for walk-in orders: product search, cart, quantity control, optional customer information, cash/mobile-money selection and receipt state.
- Sales ledger and operational audit log.

Design for cashiers and branch staff on desktop/tablet: faster than the customer storefront, high contrast, clear status, readable totals and deliberate destructive actions.

## Production behavior the UI must respect

Represent the following as **future trusted-server contracts**, not as frontend facts:

- Server, not browser, owns price calculation, stock decrement, reservation, restore and order-state transition.
- Money is stored in integer pesewas and formatted at the UI edge.
- Every order carries its ordered product/price/variant snapshot and immutable status history.
- Branch staff may access only their branch unless their verified role explicitly allows otherwise.
- Cash POS completion is a single atomic server operation.
- Mobile money reserves exact stock before charging, settles idempotently after verified payment and releases its hold on failure/cancellation/expiry.
- Payment exceptions remain visible for human resolution; never silently add a sale or change stock.
- Cancellation/void requires a reason and restores recorded stock exactly once.
- Post-completion POS corrections are role/time constrained, reasoned and use calculated stock deltas.
- A live charged payment must not be silently edited.

## Hard boundaries

- Do not deploy.
- Do not add live Firebase, Paystack, payment or authentication wiring.
- Do not add secrets, test-key fallbacks or production project identifiers.
- Do not make customer checkout, stock or payment promises that the backend does not actually enforce.
- Do not use direct client-side mutable inventory/order writes in future integration code.

## Completion checklist

Before handback:

1. Confirm public homepage behavior remains intact.
2. Clearly identify all demo/local data in the UI.
3. Run `npm run build`.
4. Report files changed, implemented journeys, backend gaps and test result.
5. Do not deploy or call live services.
