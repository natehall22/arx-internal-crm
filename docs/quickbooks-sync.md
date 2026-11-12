# QuickBooks Online sync — design (approved 2026-11-06; widened 2026-11-11)

Status: **PR 1 (deletes) and PR 2 (connection) built; nothing is posted to QuickBooks yet.** The outbox only receives
`customer.upserted` (contract signing) and `payment.recorded` (job payments); `quickbooks-outbox-guard.test.ts` holds that line.

## Standing rule (Nathan, 2026-11-11): the CRM is NOT accounting software
The CRM tracks job costs and invoices and **sends them cleanly into each company's own QuickBooks; QuickBooks does the
accounting.** So the CRM has no general ledger, no chart-of-accounts management, no reconciliation, no bill paying, no check
printing, no A/P aging, no fee/deposit bookkeeping, and posts no payroll. Direction is **CRM -> QuickBooks only**.

## Rules (Tesla: delete before add)
1. **ONE map**: `qb_links` (org, CRM table, CRM id, QB type, QB id, SyncToken). No other table stores a QuickBooks id.
2. **ONE worker**: drains `integration_outbox` (provider `quickbooks`), one cron (`/api/cron/quickbooks`, already keeps tokens warm),
   per company via `loadCronOrgs`. Claim -> find-before-send -> send -> write `qb_links` -> done. Failures back off, then land in **Needs you**.
3. **Per company, owner-only** (`isSuperAdmin`). Feature switch `quickbooks`, default OFF. Nothing posts while it is off or
   disconnected, and never for a date before the company's **start date** (history is never auto-posted).
4. **Money is find-before-retry and idempotent.** Every write sends Intuit `requestid` (= our outbox key) AND carries our
   reference in DocNumber / PrivateNote. After any error or timeout we search QuickBooks for that reference first;
   found = link it, never a second copy. Updates send the stored SyncToken; a stale-token error re-reads and retries once.
5. **QuickBooks stays the bookkeeper's.** We never overwrite an amount a person changed in QuickBooks: a mismatch is a Needs-you line.
6. **Nothing is posted twice, by company choice.** Each flow has ONE owner; the screen says which.

## What goes where (all CRM -> QB)
| CRM | QuickBooks | Rule |
|---|---|---|
| Customer (+ job as sub-customer) | Customer | When they become a customer (contract signed / first invoice). Link-first: match email, phone, name+address before creating |
| Job sale (roofing) | ONE Invoice per job = signed contract + signed COs | Company setting **Invoices = one per job**; a CO updates the same invoice. `job_invoices` not synced in this mode |
| Service invoice (lawn, no job) | Invoice per CRM invoice, lines -> the mapped Item | Company setting **Invoices = every invoice**. Void in CRM = void in QB. One mode per company; switching needs a new start date |
| Sales tax | Tax on the invoice | Taxable / non-taxable per line with the mapped tax code; if QB's total differs from the CRM's by a cent, Needs you (we never force a number) |
| Payment recorded in CRM (cash, check, Stripe) | Payment applied to that invoice, **gross** | Stripe card/ACH is recorded at the gross amount |
| Refund recorded in CRM | Credit memo / refund linked to the invoice | |
| Stripe fees and payouts, Hearth dealer fee | **Not the CRM's job** | QuickBooks' own bank feed / Stripe app books payouts and fees. The dealer fee stays a profit-side CRM figure and a bookkeeper entry |
| Vendor (supplier, sub) | Vendor (`Vendor1099` flag for subs) | Created when its first approved bill is sent; matched by name/email first |
| **Approved** vendor bill from a PO | Bill (ref = bill number), lines -> mapped expense account, Class = job | Only CRM-approved bills. A bill typed in QuickBooks is never re-sent |
| Paying vendors | **In QuickBooks** | No BillPayment writer. Optionally READ BACK "paid" from QB to mark the bill paid in the CRM |
| Payroll, approved pay week | **Not posted** | The CRM exports the week to the payroll provider (Gusto/ADP); the provider's own QuickBooks sync books it. Subs are sent as vendor bills only if the company chooses |
| Cost typed in CRM, time, quotes, unbilled POs | Not pushed | |

## Conflicts, history (CRM -> QB only)
- **No read-back in v1.** The only thing ever read from QuickBooks later, and only if the company wants it, is "this approved vendor
  bill was paid" (to mark it paid in the CRM) — optional, a later PR, never an edit of QuickBooks data. We do not import payments,
  customers or vendors typed in QuickBooks. If that read-back is built it polls the bills we sent (no webhooks, no CDC needed).
- **Conflict**: CRM changed a synced record whose SyncToken moved (edited in QB) -> we do not overwrite; Needs you shows both.
  Deleted/voided in QB -> link marked broken, Needs you.
- **Backfill (link-first)**: pull QB customers/invoices/vendors; match; write `qb_links`; list ambiguous ones for a person; only
  then create what is missing, for records dated on/after the start date.
- **Disconnect** = revoke at Intuit, wipe tokens, keep `qb_links` (the same QuickBooks company resumes; a *different* one is refused once links exist).

## Worker (PR3, built 2026-11-11, branch feat/quickbooks-sync)
ONE worker drains `integration_outbox` (`provider='quickbooks'`): cron `/api/cron/quickbooks` every 10 min (`verifyCronSecret`, per company via
`lib/cron-orgs.ts`; skips a company whose switch is off, that is not connected, or whose mapping is not confirmed). Code: `lib/quickbooks/*`.
- **Events** (ONE enqueue family in `lib/integrations.ts`, key `org:table:id:event:vN`): `customer.upserted` (contract signing), `invoice.upserted/voided`
  (job sale amount change, invoice send/void, job cancel), `payment.recorded/refunded/disputed`, `bill.recorded/voided`. A sweep enqueues anything since the
  start date nobody queued (no-job invoices/payments, bills) as a safety net (<= 10 min).
- **State-based:** the worker reads the CRM record at send time, never the payload; a later re-queue mid-send makes the earlier result drop (lease CAS).
- **Every create is find-before-send:** `qb_links` -> DocNumber/name query -> scan for the marker `[crm:<kind>:<id>]` in PrivateNote -> only then create,
  with Intuit `requestid`. A timeout therefore finds what it created. `qb_links` only maps; QuickBooks owns the books.
- **Conflicts:** stale SyncToken (5010) re-read and retry once. If a person changed the QuickBooks invoice total, the CRM does NOT overwrite it: Needs you.
- **Failures:** back off 1/5/15/60/240 min; after 6 tries "Needs you" in plain words with Retry / Skip (Settings -> QuickBooks activity, and Today).
  Login failure (120) or a stopped company stops the whole company and flags reconnect. 429 stops the batch.
- **Nothing deletes in QuickBooks.** Only a voided/cancelled CRM record voids its invoice (zeroed, kept). A CRM-voided bill goes to Needs you
  (a person voids it in QuickBooks).
- **Start date:** nothing dated before it posts (invoice date, payment date, bill date, customer event day in the company time zone).
- **Money:** pre-tax lines + tax lines must equal the total to the cent or the invoice is not sent. Refunds/disputes go as a Refund Receipt at the gross amount
  (tax not split).
- Screens: Settings -> QuickBooks: "What goes where" (mapping) and "QuickBooks activity"; APIs `/api/admin/quickbooks/mapping|activity` (owners only).

## Mapping screen (owner, plain words)
Every choice is one of the company's OWN QuickBooks lists, pre-picked where obvious, checked server-side against those lists: start date, invoice mode
(one per job | every invoice), sales item (per trade optional), tax (none | QuickBooks automatic | CRM tax mapped to a tax code/rates), deposit-to account,
receivables account (only when more than one), vendor bills on/off + expense account + class (Plus) + 1099 vendors. Nothing posts until "Start sending";
any later change un-confirms until saved again. Changing invoice mode after invoices were sent needs a new start date of today or later.
Stored in `orgs.settings.quickbooks`. We never create or edit accounts.

## Intuit facts this relies on (checked 2026-11-11 against Intuit docs/posts and developer write-ups; items marked * not confirmed on an Intuit page we could read)
- OAuth 2.0, authorization-code. Access token ~60 min. **A refresh returns a NEW refresh token: always store the newest, in the same
  step, under a per-company lock** (two workers refreshing = the old one is dead = `invalid_grant`). Refresh tokens have a max life of
  **5 years** (Intuit post; was "100 days unused" — we refresh at least weekly so both rules hold). A user disconnecting at Intuit
  kills it at once. Developer portal needs a **Reconnect URL** (mandatory since Jan 2026); QuickBooks warns the customer 30 and 7 days
  before expiry.
- Redirect URIs are exact and registered per app (no wildcards) → one fixed callback host, same as Google connect.
- Accounting API: Customer (sub-customer via `Job`/`ParentRef`), Invoice, Payment, Refund Receipt/Credit Memo, Vendor
  (`Vendor1099`), Bill (BillPayment read-only), Item, Account (read-only), Class, TaxCode. Updates need the current **SyncToken**
  (sparse updates allowed); stale token = error 5010. Send `minorversion=75`+ (1-74 deprecated Aug 1 2025; blogs.intuit.com/?p=34635). Queries page at 1000.
- Rate limits: ~500 requests/min per company, ~10 concurrent, batch ≤30 operations (batch endpoint ~120/min); 429 → back off with jitter.
- `requestid` makes a retried create safe: max **50 characters**, a repeat returns the first response (blogs.a.intuit.com/2015/04/06/15346/). (Webhooks / CDC exist but we do not use them: nothing is read back.)
- Sandbox and production use different keys/URLs. Production keys need Intuit's **app assessment** (questionnaire).*

## Decisions the owner / bookkeeper must make (in writing before go-live)
1. QuickBooks plan is **Plus or higher** (classes, sub-customers)? 2. **Start date.** 3. Invoice mode per company (roofing: one per job =
sale amount; lawn: every invoice). 4. Sales tax: automated tax or a manual tax code. 5. The four mapping picks above.
6. Do vendor bills go to QuickBooks, and is "paid" read back or left alone? 7. Which subs get 1099s / are sent as vendors.
8. Who owns payroll in QuickBooks: the provider's sync (default; the CRM only exports).
Only Nathan can: create the Intuit app, register the redirect + reconnect URLs, set env (below), pass the app assessment.

## Env (names only)
`INTUIT_CLIENT_ID`, `INTUIT_CLIENT_SECRET`, `INTUIT_REDIRECT_URI` (the ONE callback, `<app host>/api/integrations/quickbooks/callback`),
`INTUIT_ENVIRONMENT` (`sandbox` | `production`), `SECRETS_ENCRYPTION_KEY` (32+ random chars; encrypts tokens; set BEFORE the first connect and
never change it — a changed key makes stored tokens unreadable = "needs reconnect"), later `INTUIT_WEBHOOK_VERIFIER_TOKEN`.

## Build order (each a PR)
1. **Deletes - done.** 2. **Connection (this PR)**: OAuth, encrypted tokens + rotation, `qb_links`, status card, disconnect, Needs you.
3-5. **Mapping screen, worker (customer, invoice both modes, tax, payment, refund, vendors + bills, 1099): built (PR3).** 6. Backfill (link-first): next (PR4). 7. Optional: "bill paid" read-back.
(Payroll: a provider export in the payroll branch; nothing here.)

## PR3 additions: facts, unverified items, decisions
Verified (Intuit blog posts): error codes 5010 stale SyncToken, 6240 duplicate name, 6210 duplicate doc number / closed period, 610 not found, 2500 invalid
reference, 120 auth failure, 6190 invalid company status (blogs.a.intuit.com/2017/06/08/top-quickbooks-online-api-errors-and-how-to-handle-them/); void invoice =
`POST invoice?operation=void` with Id+SyncToken, amounts zeroed and **PrivateNote is overwritten with "Voided"**, so the CRM marker is kept in `qb_links`
(blogs.a.intuit.com/2016/04/06/voiding-invoice-objects). Rate limit 429 code 003001 (third-party write-ups). Sandbox host `sandbox-quickbooks.api.intuit.com`.
developer.intuit.com is script-rendered and could not be read.
Unverified `*` (confirm in the sandbox before go-live): payment void operation, RefundReceipt / VendorCredit shapes, Preferences `CustomTxnNumbers`, QuickBooks
Online record URLs (a wrong link opens the home page), `\'` escaping in queries, Class query when class tracking is off, whether a sparse invoice update replaces
Lines wholesale.
Decisions for Nathan / bookkeeper (additions): Plus plan (classes, sub-customers) | start date | invoice mode | automatic vs manual tax | the four mapping picks |
vendor bills and 1099 flags | refunds at gross, tax not split | customers are matched only by email/phone/street, else a suffixed name (never merged on name alone) |
vendors adopted on exact name | each job is a sub-customer of the customer | change-order tax treated as tax-included | T&M jobs and no-job invoices send each CRM invoice
even in per-job mode | payroll via the payroll provider, not here | cron every 10 min.
Migration order (Phase 1, both BEFORE the code): 202611210010 (additive columns) then 202611210020 (NOT additive: drops the outbox policies that let any signed-in member of the company read/update rows; every reader and writer uses the service role). Needs 202611100040 first.

## PR4 backfill + review fixes (2026-11-11)
- **Backfill (link-first), `lib/quickbooks/backfill.ts`, `POST /api/admin/quickbooks/backfill` (owners; `action: preview | apply`):** pulls QuickBooks customers, sub-customers and invoices, matches CRM records
  (customers by the CRM's ONE identity rule `matchExistingCustomer` via `lib/quickbooks/identity.ts`; jobs by job number under the matched customer; invoices by DocNumber, a different amount goes to the owner),
  owner resolves ambiguous ones, `apply` writes `qb_links` only (re-planned on the server). It creates nothing in QuickBooks; unmatched records are created later by the worker from the start date on.
  The worker's first-send customer adoption now uses the same rule (the old street-only match is gone).
- **Undo-cancel:** the void clears the fingerprint; the restored job is sent again as a NEW invoice numbered `<number>-R` (QuickBooks cannot un-void). A queued void for a job that is no longer cancelled is dropped.
- **Refund on a cancelled/voided sale** is not posted (it would cut income twice): Needs you, "refund the customer credit in QuickBooks". Whether Intuit can refund that credit through the API is unverified.
- **Invoice mode** applies to new jobs; a job whose sale invoice is already in QuickBooks keeps it. Customers carry `CRM:<org>:<id>` in Notes (find-before-retry). Skip records who/when/why; a skipped line stays closed.
- No outbox rows are written for a company with the QuickBooks switch off (TS enqueue). Still open: the SQL `record_job_payment` writes its payment row regardless of the switch.
- Sandbox checklist before go-live: every `*` item above, plus the `-R` reissue number and a customer-credit refund.
- **One setup page** (Settings -> QuickBooks, `components/admin/QuickBooksSetup.tsx`): 1 Connect, 2 Pick accounts, 3 Match what is already in QuickBooks, 4 Start sending. The ONE Start-sending button is disabled until step 3 is done or skipped after a warning (`backfill.doneAt` / `skipped`); the server refuses a first confirm without it when QuickBooks already has customers. Skip (activity log) needs a reason and stays in the log with who/when/why.

## Undo payment -> `payment.voided` (2026-11-12)
- "Undo payment" in the CRM writes a negative job payment (key `undo:<original id>`) and enqueues **`payment.voided`** (not `payment.refunded`): the handler `paymentVoided` finds the original's `Payment` link and VOIDS it (kept, zeroed, never deleted; no Refund Receipt). Idempotent: a Payment already shown as voided is left alone; a payment never sent has nothing to void; an undone payment that is not yet sent is never created (`paymentHandler` skips it, code `undone`).
- **UNVERIFIED against Intuit's live API:** that `operation=void` on a Payment zeroes `TotalAmt` and that the "Voided" `PrivateNote` marker appears as the fake QuickBooks company models it (it is modelled on Invoice voids). Check on the sandbox before go-live; if a Payment void behaves differently the handler's "already voided" test is the one line to adjust.
- **Migration order:** apply `202611220020_record_job_payment_void_event.sql` AFTER `202611210030` and BEFORE the code (the SQL `record_job_payment` validates the event type; without it undo fails).
