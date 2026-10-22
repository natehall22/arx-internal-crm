# CRM emails the order sheet to suppliers

**Stacked on** `fix/money-inputs` (#54: `lib/super-admin.ts`) and `feat/status-desire-paths` (#56: `markMaterialsOrdered`). Merge those first; this branch contains both and will shrink to its own commits.

## Rules implemented
- Suppliers are per-company rows (`vendors`): order email, cc, account, branch, delivery notes, default trades, `connection_type` (`email` default | `api`). Owners (super admins) edit them in **Settings → Suppliers** (`/admin/suppliers`); every change is logged. Ops editors who hit a "no order email" blocker are told to ask an owner. ARX uses ABC Supply.
- Every line has a source: supplier / installer / customer / stock — per-trade company default (`org_trade_material_defaults`), per-job override (`job_trade_material_sources`), per-line override. Only supplier lines make POs.
- One PO per SUPPLIER (trades sectioned inside): PDF + email each. `supplier_orders` unique per (job, supplier); PO numbers `PO-<job>-<letter>`, unique per org.
- Preview first (`GET …/supplier-orders/preview`, PDF iframe); explicit **Send to <supplier>** (`POST …/supplier-orders/send`) is the only door (`lib/__tests__/supplier-send-door.test.ts` fails if anything else imports `sendOrderToSupplier`). Nothing auto-sends.
- Send log (`supplier_order_sends` + lines + sourcing snapshot), content hash double-send guard (re-sending identical content or within an unknown/in-flight send asks a second "yes"), revised POs `-R1…` list what changed, cancellation emails only via preview.
- Failure never marks ordered. "Materials ordered" = every supplier PO sent unchanged; installer-supplied trades count once their crew is scheduled (`install-schedule/assign` re-checks).
- Any trade works (electrical covered by tests). `lib/suppliers/send-order.ts` is the connector interface (ABC API plugs in there).

- **Sending it yourself:** downloading the order sheet records nothing. Each supplier card has a one-tap **"I sent this to <supplier> myself"** (`manual: true` on the send route): same PO number, send log and N-of-M roll-up, nothing emailed, works even with no order email on file.

## Deploy order
1. Migration `202610210060_supplier_orders.sql` (additive: new tables + nullable vendor columns + enums).
2. Deploy. 3. Open /admin/suppliers, add ABC Supply (order email, default trades). 4. Needs `SMTP_HOST` etc. already used by other emails.

## Reporting fields
`supplier_orders` (status enum, revision, last_sent_at/to), `supplier_order_sends` (kind, connection_type, status, to, sent_by, timestamps, content hashes), `supplier_order_send_lines` (what was on each PO), `vendors.connection_type`, `job_trade_material_sources.material_source`.

## Not done / decisions
- No cancellation-on-job-cancel automation (by design: cancellations only via preview).
- Delivery-date picker defaults to the day before the earliest crew date.
- `connection_type='api'` suppliers are blocked from sending until a connector is registered (feat/abc-supply-connector).
