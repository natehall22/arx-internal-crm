# QuickBooks Online sync — design (approved 2026-11-06; widened 2026-11-11)

Status: **PR 1 (deletes) and PR 2 (connection) built; nothing is posted to QuickBooks yet.** The outbox only receives
`customer.upserted` (contract signing) and `payment.recorded` (job payments); `quickbooks-outbox-guard.test.ts` holds that line.

## Rules (Tesla: delete before add)
1. **ONE map**: `qb_links` (org, CRM table, CRM id, QB type, QB id, SyncToken). No other table stores a QuickBooks id.
2. **ONE worker**: drains `integration_outbox` (provider `quickbooks`), one cron, `verifyCronSecret()`, per company via `loadCronOrgs`.
   Claim → find-before-send → send → write `qb_links` → done. Failures back off, then land in **Needs you**.
3. **Per company, owner-only** (`isSuperAdmin`). Feature switch `quickbooks`, default OFF. Nothing posts while it is off or
   disconnected, and never for a date before the company's **start date** (history is never auto-posted).
4. **Money is find-before-retry and idempotent.** Every write sends Intuit `requestid` (= our outbox key) AND carries our
   reference in DocNumber / PrivateNote. After any error or timeout we search QuickBooks for that reference first;
   found = link it, never a second copy. Updates send the stored SyncToken; a stale-token error re-reads and retries once.
5. **QuickBooks stays the bookkeeper's.** We push only what the CRM owns (sales, payments, approved bills, payroll totals).
   We never overwrite an amount a person changed in QuickBooks: a mismatch becomes a Needs-you line, not an edit.
6. **Nothing is posted twice, by company choice.** Each money flow below has ONE owner; the screen says which.

## What goes where
| CRM | QuickBooks | Rule |
|---|---|---|
| Customer (+ property) | Customer; a job = sub-customer | At first invoice / contract signing. Link-first: match email, phone, name+address before creating |
| Job sale (roofing) | ONE Invoice per job = signed contract + signed COs | Company setting **Invoices = one per job**. CO signed → same invoice updated. `job_invoices` are NOT synced in this mode |
| Service invoice (lawn, no job) | Invoice per CRM invoice, lines → Items | Company setting **Invoices = every invoice**. Void in CRM → void in QB. Never both modes: switching needs a new start date |
| Sales tax | Tax on the invoice | QB automated sales tax: send taxable / non-taxable per line, QB calculates; if its total differs from the CRM's by a cent, Needs you (we never force a number). No AST: explicit tax line to the mapped tax account |
| Payment (cash, check, Stripe) | Payment applied to that invoice | Card/ACH → deposit account **Undeposited Funds**. Refund = Refund Receipt / Credit Memo linked to the invoice |
| Stripe payout, processing fee | Deposit: payments in, fee as a negative line to "Stripe fees" | Needs the CRM to store the Stripe balance transaction fee + payout id (PR 6) |
| Hearth (lender) dealer fee | Same Deposit mechanism: invoice paid at gross, fee = negative line to "Dealer fees" | Profit-side cost, never reduces the commission base (existing rule) |
| Vendor (supplier, sub) | Vendor; `Vendor1099` on for subs who get a 1099 | Created when first needed; matched by name/email first |
| Vendor bill (CRM-approved only) | Bill (ref = bill number), lines → Account/Item, Class = job | Only after the CRM approves it. A bill typed in QuickBooks is read back (below), never re-sent |
| Bill paid | BillPayment | Paid in CRM → BillPayment out. Paid in QB → read back and mark paid in CRM. One side owns it per company |
| Payroll, approved pay week | ONE JournalEntry per week: wages by Class/job, owed-to-people; or Bills to sub Vendors for 1099 crews | **Company choice** (see below). W-2 tax, filings, deposits stay with the provider (Gusto/ADP) |
| Cost typed in CRM, time, quotes, POs not billed | Not pushed | — |

**Payroll, one choice per company:** (a) **Provider syncs to QuickBooks** (Gusto/ADP own the books): the CRM posts nothing for
payroll. (b) **CRM posts a journal entry** from the approved week (needs the provider NOT to sync, or double expense).
(c) **No payroll in QuickBooks.** Default (c) until the owner picks. 1099 crews are Bills in every case except (a-with-contractors).

## Two-way, conflicts, history
- **QB → CRM**, by webhook (reference only, answer 200 in seconds, verify `intuit-signature` HMAC-SHA256 with the verifier token) plus a
  nightly **CDC** pull (30-day window) as the safety net — webhooks are late and duplicated. Read-only landings:
  payment entered in QB = a *suggestion* in Needs you (a person accepts it); bill entered in QB for a job = a read-only line in the
  job cost ledger (`source quickbooks`); a customer/vendor edit never overwrites CRM contact data.
- **Conflict**: CRM changed a synced record whose SyncToken moved (someone edited it in QB) → we do not overwrite; Needs you shows both.
  Deleted/voided in QB → link marked broken, Needs you.
- **Backfill (link-first)**: pull QB customers/invoices/vendors; match; write `qb_links`; list ambiguous ones for a person; only
  then create what is missing, for records dated on/after the start date.
- **Disconnect** = revoke at Intuit, wipe tokens, keep `qb_links` (reconnecting the same QuickBooks company resumes; a *different*
  company asks first, because the links would point at the wrong books). A company ever deleted in QB shows "needs reconnect".

## Mapping screen (owner, plain words)
Settings → QuickBooks: after connecting, the CRM reads the company's accounts, items, classes and tax codes and **pre-picks**
the obvious ones by name ("Sales", "Undeposited Funds", "Stripe fees", "Cost of goods sold", "Payroll expenses"). The owner sees
one list — "Sales go to: [Sales ▾]" — confirms or changes, and can add a missing account in one tap. Nothing posts until every
line shown is confirmed. Class = job (QuickBooks Plus+). Stored in `orgs.settings.quickbooks` (mapping, modes, start date).

## Intuit facts this relies on (checked 2026-11-11 against Intuit docs/posts and developer write-ups; items marked * not confirmed on an Intuit page we could read)
- OAuth 2.0, authorization-code. Access token ~60 min. **A refresh returns a NEW refresh token: always store the newest, in the same
  step, under a per-company lock** (two workers refreshing = the old one is dead = `invalid_grant`). Refresh tokens have a max life of
  **5 years** (Intuit post; was "100 days unused" — we refresh at least weekly so both rules hold). A user disconnecting at Intuit
  kills it at once. Developer portal needs a **Reconnect URL** (mandatory since Jan 2026); QuickBooks warns the customer 30 and 7 days
  before expiry.
- Redirect URIs are exact and registered per app (no wildcards) → one fixed callback host, same as Google connect.
- Accounting API: Customer (sub-customer via `Job`/`ParentRef`), Invoice, Payment, Refund Receipt/Credit Memo, Deposit, Vendor
  (`Vendor1099`), Bill, BillPayment, JournalEntry, Item, Account, Class, Department, TaxCode. Updates need the current **SyncToken**
  (sparse updates allowed); stale token = error 5010. Send `minorversion=75`+ (older phased out Aug 2025). Queries page at 1000.
- Rate limits: ~500 requests/min per company, ~10 concurrent, batch ≤30 operations (batch endpoint ~120/min); 429 → back off with jitter.
- Webhooks are reference-only, batched, late, sometimes duplicated; CDC covers 30 days. `requestid` makes a retried create safe.
- Sandbox and production use different keys/URLs. Production keys need Intuit's **app assessment** (questionnaire).*

## Decisions the owner / bookkeeper must make (in writing before go-live)
1. QuickBooks plan is **Plus or higher** (classes, sub-customers)? 2. **Start date.** 3. Invoice mode per company (roofing: one per job =
sale amount; lawn: every invoice). 4. Sales tax: automated tax or manual tax account. 5. Accounts: income, undeposited funds,
Stripe fees, dealer fees, payroll expense/liability. 6. Payroll: provider syncs, CRM posts a journal, or none. 7. Bills: who marks a
bill paid (CRM or QuickBooks). 8. Which subs get 1099s.
Only Nathan can: create the Intuit app, register the redirect + reconnect URLs, set env (below), pass the app assessment.

## Env (names only)
`INTUIT_CLIENT_ID`, `INTUIT_CLIENT_SECRET`, `INTUIT_REDIRECT_URI` (the ONE callback, `<app host>/api/integrations/quickbooks/callback`),
`INTUIT_ENVIRONMENT` (`sandbox` | `production`), `SECRETS_ENCRYPTION_KEY` (32+ random chars; encrypts tokens; set BEFORE the first connect and
never change it — a changed key makes stored tokens unreadable = "needs reconnect"), later `INTUIT_WEBHOOK_VERIFIER_TOKEN`.

## Build order (each a PR)
1. **Deletes — done.** 2. **Connection (this PR)**: OAuth, encrypted tokens + rotation, `qb_links`, status card, disconnect, Needs you.
3. Mapping screen + read-only accounts/items/classes pull. 4. Worker: customer, invoice (both modes), tax, payment, refund.
5. Stripe payout/fee + Hearth fee deposits (+ CRM stores fee/payout). 6. Vendors + approved bills + BillPayment + 1099.
7. Payroll journal / sub bills (company choice). 8. Backfill (link-first). 9. QB → CRM: webhooks + CDC, payment suggestions, bills to cost ledger.
