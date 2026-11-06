# QuickBooks Online sync — design (approved 2026-11-06)

Status: **not connected.** PR 1 (deletes first) is done: only contract signing queues a customer, only recording a job
payment queues a payment, invoices are never queued, the fake Settings/Integrations QuickBooks screens are gone, and
`supabase/data-fixes/2026-11-06_skip_stale_qb_outbox.sql` marks the 128 never-sent historical rows `skipped` so connecting
later never auto-posts history.

## Connection
- **Per company** (each org connects its own QuickBooks company; multi-company ready). One connection per org.
- **Owner-only**: connect / disconnect / settings need `isSuperAdmin()`; nobody else sees the screen.
- Intuit OAuth 2.0; access + refresh tokens **encrypted at rest** (server-side key, never sent to the browser), realm id
  stored beside them. Refresh before expiry; a dead refresh token marks the connection "needs reconnect" in Needs you.

## Mapping
- `qb_links` (org_id, crm_table, crm_id, qb_type, qb_id, sync_token, last_synced_at) is the ONE CRM↔QuickBooks map.
  Nothing else stores QuickBooks ids. Unique per (org, crm_table, crm_id, qb_type) and per (org, qb_type, qb_id).

## Worker
- Drains `integration_outbox` (existing table, `outbox_status` enum incl. `skipped`); one cron, `verifyCronSecret()`.
- Per row: claim → send → write `qb_links` → `completed`; failures back off and land in Needs you after N tries.
- **Money is find-before-retry**: before re-sending a payment or invoice after any error/timeout, search QuickBooks for it
  (by our reference in the memo/doc number). Found → link it, never post a second copy.
- Skips everything while the org is not connected; no row is ever posted for a date before the backfill start date.

## Sync directions
| What | Direction | When / rule |
|---|---|---|
| Customer | CRM → QB | At contract signing (`enrichCustomerFromContract`) — the one moment QB hears about a customer |
| Job | CRM → QB | Sub-customer under the customer, created at signing |
| Invoice | CRM → QB | One per job = **sale amount** (contract + signed change orders); updated when a CO is signed. `job_invoices` are not synced |
| Payment recorded in CRM | CRM → QB | Received payment applied to the job's invoice |
| Payment entered in QB | QB → CRM | **Suggestion only** in Needs you; a person accepts it into the job's payments. Never auto-written |
| Bill tagged to a job in QB | QB → CRM | Read-only line in the job cost ledger (`job_cost_lines`, source `quickbooks`) |
| Cost typed in the CRM | — | **Not pushed** to QB (the bookkeeper owns bills) |

## Backfill (link-first)
1. Pull QB customers / sub-customers / invoices; match to CRM customers and jobs (email, phone, name+address, job number).
2. Write `qb_links` for matches; list ambiguous ones for a person to confirm. **Link before create** — never duplicate
   something QB already has.
3. Only after linking, create what is missing — for jobs signed on/after the backfill start date only.

## Steps only Nathan can do
- Create the Intuit developer app; set redirect URIs; put the client id/secret in Vercel env.
- Pass Intuit's production review (app assessment + security questionnaire) before live keys work.
- Confirm the QuickBooks plan is **Plus or higher** (sub-customers/class tracking for job costing).
- Bookkeeper decisions, in writing, before go-live:
  - Invoice = sale amount (contract + signed COs) — confirm.
  - How Hearth (lender) **dealer fees** are booked (fee expense vs. net deposit).
  - **Sales tax**: on the invoice or not, and which tax code.
  - **Backfill start date** (nothing earlier is created in QB).
  - Income / deposit / A-R accounts and items to map to.

## Build order
PR 1 deletes (done) → PR 2 connection + `qb_links` + encrypted tokens → PR 3 worker (customer, job, invoice, payment out)
→ PR 4 backfill → PR 5 QB → CRM (payment suggestions, bills to cost ledger).
