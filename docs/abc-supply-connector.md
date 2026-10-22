# ABC Supply ordering connector

Design background (QXO, SRS, other suppliers, phased plan): `docs/supplier-integrations-spec.md`.

Status: built, **OFF everywhere**, sandbox only until an owner changes it. Orders still go by email until all
three switches below are on and a supplier's lines are mapped to ABC item numbers.

## How it fits (nothing new in the ordering flow)
The connector plugs into `lib/suppliers/send-order.ts` (`registerSupplierOrderConnector`). Everything else —
preview, the preview token ("send exactly what you looked at"), the one-in-flight lock, PO numbers, the send
log, "materials ordered" — is the same code email orders use. Only `POST /api/ops/jobs/[id]/supplier-orders/send`
can place an order (test-enforced), so no status change, cron or automation can.

## Safety rules, and where each lives
| Rule | Where |
|---|---|
| OFF by default, three switches | env `SUPPLIER_API_ORDERING=on`, `orgs.supplier_api_ordering_enabled`, `supplier_api_settings.ordering_enabled`. Each blocks alone. Re-checked at the last moment in `transmit`. |
| Sandbox first | `supplier_api_settings.environment` defaults to `sandbox`; production needs the owner-only settings route and its own credentials. |
| Preview + explicit confirm | existing preview token; the token also covers environment, switches, ship-to, branch and the item map. |
| Second approver | orders at/over `orgs.supplier_api_second_approval_cents` (default $10,000) **or with an unknown total** need a *different owner* to open the job and press Send. Nobody approves their own; a changed order starts over; approvals are single-use. |
| Idempotent PO | the PO label (`26-0141-A`, max 16 chars) is the ABC `purchaseOrder`; a fresh `requestId` per attempt; the existing one-in-flight lock + "already sent" guard stop doubles. ABC's docs do not say whether a repeated PO is rejected, so we never rely on that. |
| No auto-retry | `submitAbcOrder` makes exactly one request. A timeout/5xx/answer without a confirmation number is recorded **unknown** and the next send asks for a second yes. |
| Only first orders | ABC's order API has no change/cancel call, so a revision, resend or cancellation is blocked for API suppliers (a resend would create a second order). Call the branch, then use "I sent this myself". |
| Audit log | `supplier_api_events` is append-only (trigger blocks update/delete): settings/map changes, approval requests/approvals, every submit attempt and its outcome, webhooks. Credentials are never stored or logged. |
| No price comparison | the connector never calls ABC's Pricing API. `est_unit_price_cents` is a number typed in by us and is read only to decide whether an order needs a second approver. A test fails if either changes. |

## What you need to register with ABC (Individual Business track)
1. Go to the ABC Partner Developer Portal (https://partners-developer.abcsupply.com/) and register as an **Individual Business**.
2. Have ready: ARX's **ABC customer (sold-to) account number** and a **myABCsupply user email** on that account.
3. Ask API Support in writing: (a) sandbox credentials, (b) permission to test **order placement** in the sandbox (required), (c) whether a repeated `purchaseOrder`/`requestId` is rejected, (d) the order-placement success code (docs say both 201 and 202), (e) whether an internal buyer screen that shows only ABC's own prices is OK under the "no price comparison" clause.
4. In sandbox, find a **Ship-To** with the Account API (`accountType = Ship-To`) and pick a **branch number**.
5. Register an `ORDER_UPDATE` webhook pointing at `https://<crm-domain>/api/webhooks/abc-supply`; ABC returns a `secret`.
6. For production, ABC validates ARX's account before granting access; then repeat steps 4-5 with the production ship-to/branch.

## Setting it up in the CRM (when you have sandbox credentials)
1. Vercel env vars (mark Sensitive): `ABC_CLIENT_ID_SANDBOX`, `ABC_CLIENT_SECRET_SANDBOX`, `ABC_WEBHOOK_SECRET`.
   (Production later: `ABC_CLIENT_ID_PRODUCTION`, `ABC_CLIENT_SECRET_PRODUCTION`.) Do **not** set `SUPPLIER_API_ORDERING` yet.
2. Apply `202610230010_abc_supply_connector.sql` (before deploying this code).
3. Settings → Suppliers → ABC Supply: set "How orders are sent" to API.
4. As an owner, `PUT /api/admin/suppliers/<ABC vendor id>/api`:
   `{ "settings": { "environment": "sandbox", "orderingEnabled": true, "shipToNumber": "...", "branchNumber": "...", "deliveryService": "OTR" },
      "org": { "orderingEnabled": true, "secondApprovalCents": 1000000 },
      "itemMap": [ { "lineKey": "<order line key>", "itemNumber": "<ABC item>", "uom": "BD", "qtyUnitWord": "bundles", "estUnitPriceCents": 3800 } ] }`
   `lineKey` is the key shown in the order list; `qtyUnitWord` is the word after the number in the CRM quantity ("58 bundles" → `bundles`).
5. Turn on `SUPPLIER_API_ORDERING=on` in the **preview** deployment only, place a sandbox order, compare with ABC's sandbox.
6. Watch `supplier_api_events` and the webhook updating `supplier_order_sends.supplier_status`.

## Known gaps (decide before production)
- **Item mapping has no screen yet**; it is an owner-only API. Every order line needs an ABC item number and a readable quantity or the order stays on email. Dimensional items (needing `dimensions`) are not supported.
- Verify in sandbox: success status code (201 vs 202), the sandbox token URL (`/v1/token` suffix), whether ABC overrides `shipTo.address` with the ship-to on file.
- ABC says order details are unavailable until the branch accepts ("Requested"); the CRM records the confirmation number at once and the status when the webhook arrives.
