# External review brief — release/2026-10-batch

**Frozen at:** `61d1d14423cc7dd40f1660d22c2eff4810289757` (HEAD of `release/2026-10-batch`; no commits after this except this brief, which is intentionally uncommitted).
**Repo / checkout:** `~/arx-wt/plans` (git worktree of `~/arx-internal-crm`).
**Nothing is pushed, nothing is applied to production.** Prod is a live roofing-company CRM in daily use (Supabase Postgres 17, project `anzqkklwcgaoeunzpqjh`; Next.js 14 App Router, TypeScript strict). There is no manual backup; the release must be near zero-risk, so anything that can corrupt data, leak data across roles/orgs, change what someone is paid, or break a currently-working screen is the highest-severity finding.

## 1. Diff range

```
git diff origin/main...release/2026-10-batch      # merge-base == origin/main == 924f2cac (release already contains current origin/main)
```
**Use `origin/main`, not local `main`.** Local `main` is 25 commits stale (`73952f35`); diffing against it wrongly shows 26 migrations and 16 data fixes that are already live. Against `origin/main`: 304 files, +17,705 / −12,804, 50 commits; app code (excluding docs/supabase/tests) is 254 files.
The only SQL in the diff is exactly the 5 migrations + 2 data fixes in §3. Everything else is application code that deploys with the merge.

## 2. What is in the release

| Area | What | Main entry points |
|---|---|---|
| UI foundation (Phase A) | `components/ui` kit + tokens, `lib/format.ts`, `lib/status.ts`, toasts/dialogs replace `alert`/`confirm`, saved table views | `components/ui/*`, `lib/format.ts`, `table_views` |
| Navigation / Today / search / Settings hub (B) | One permission-driven six-section nav; role-specific Today home; Cmd-K global search (`pg_trgm`); grouped Settings | `lib/nav-config.ts`, `components/Nav.tsx`, `app/today/page.tsx`, `lib/today.ts`, `app/api/search`, `app/admin/SettingsHub.tsx` |
| Customer File + Job Threads (C) | `/c/[customer]/d/[deal]/[tab]`; one message store (`activities`) with audiences Team/Sales/Production/Crew, pricing guard, mentions, pins, edit/delete/reclassify, Waiting-on-you; old notes paths become adapters over the thread | `lib/threads/*` (esp. `visibility.ts`, `get-thread.ts`, `post-message.ts`, `viewer.ts`), `lib/customer-file/*`, `app/c/*`, `components/customer-file/*`, `app/api/threads/*`, `app/api/ops/jobs/[id]/notes` |
| Lists / queues (D) | Shared `DataTable` (filters, saved views, server mode); Customers, Leads, Opportunities, Job board list, Work orders, Proposals, Subs, Job profit moved onto it; Appointments hub; Jobs→Schedule | `components/ui/data-table.tsx`, `components/appointments/*`, `app/ops/schedule` |
| Payroll redesign | One calc (`planPayrollPeriod`, no writes) + persist; "Pay this week" replaces `/admin/payroll`; "Fix a mistake" adjustments + carried-forward negative balances; rep "My pay" + "Something's wrong?" disputes; settled-externally jobs excluded | `lib/payroll-pay-week.ts`, `lib/weekly-payroll/*`, `lib/payroll-period-materialization.ts`, `components/payroll/*`, `app/api/admin/payroll/*`, `app/api/me/pay` |
| Pay plans | Org default pay plan per role, only for active users, date-aware; test-account flag; plan ends on deactivation | `lib/comp-plan-defaults*.ts`, `lib/comp-plan-payability.ts`, migrations already live |
| Needs you | Role-correct, server-side, one rule | `lib/data-health.ts` (`needsYouAudience`, `shapeNeedsYou`, `loadNeedsYouForViewer`) |
| Design docs | Specs and approved prototypes | `docs/design/`, `docs/release-2026-10-batch.md` |

Not enabled by this release: `CUSTOMER_FILE_REDIRECTS` (old record URLs → Customer File) stays **off**; ABC Supply connector stays **off**.

## 3. Migrations and data fixes (apply order)

All five migrations are additive. Apply in this order, then the data fixes.

| # | File | What | Rollback | Prior verification |
|---|---|---|---|---|
| 1 | `supabase/migrations/202610240020_table_views.sql` | `table_views` table (per-user saved views) | `DROP TABLE table_views` | additive table |
| 2 | `202610240050_global_search.sql` | `pg_trgm` indexes + `search_all` function, service-role only | `DROP FUNCTION search_all` (indexes can stay) | — |
| 3 | `202610250010_payroll_adjustments.sql` | `payroll_adjustments` (signed lines on a later open week; negative check carried at most once per person per source week, unique index) | `DROP TABLE payroll_adjustments` | — |
| 4 | `202610250020_payroll_disputes.sql` | `payroll_disputes` (references #3) | `DROP TABLE payroll_disputes` (before #3) | — |
| 5 | `202610270010_threads_audiences.sql` (198 lines) | `activities` gains audience / origin / restricted_pricing / priority / reply / pins / soft-delete / mentions; new `threads`, `thread_members`; `notifications` gains thread/priority/resolved; `users.ui_prefs`; SQL `message_visible_to` (must mirror `lib/threads/visibility.ts`); **replaces the RLS policies on `activities`** (read policy + three write policies); `search_messages`. Rows with `audience IS NULL` behave exactly as today. | Restore old SELECT policy `org_id = get_user_org_id(auth.uid()) AND referral_partner_id IS NULL` and the three old write policies `org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid()`; drop the 2 functions + 2 tables; added columns may stay | Dry-run in a rolled-back transaction on prod 2026-10-22; role × audience matrix verified |

**Data fixes** (run after #5, in this order; both idempotent; both save old values in `data_fix_backups` first):

1. `supabase/data-fixes/2026-10-27_link_orphan_opportunities.sql` — 363 opportunities have no customer. Preview on prod (2026-10-22, nothing written): 2 join an existing customer by email, 35 by phone, 326 need new customers = **314 new customers** (49 → 363 customers; 363 opportunities linked), 2 opportunities have no lead. After: 0 without a customer. Uses the same match rule as `lib/customers.ts findExistingCustomer`. Does **not** write `leads.customer_id` (canvass reads it as "existing customer") and queues **no** QuickBooks event.
2. `2026-10-27_merge_notes_into_threads.sql` — classifies the 4,337 existing activities (human vs system; only 1 existing note is human-written, 4,135 system rows) and **copies** 478 old notes into the timeline (104 job notes with 54 exact-name mentions, 158 + 94 opportunity notes, 17 lead notes that have a deal, 42 + 29 project notes, 31 job internal notes, 3 pinned special instructions). Old columns/tables untouched; each copy carries `legacy_ref` (idempotent). 14 lead notes with no deal stay on the lead.

Review questions specific to the SQL: does `message_visible_to` match `lib/threads/visibility.ts` for every role × audience × pricing combination? Can the new `activities` RLS expose a row to a browser (anon-key) client that the service-client rules would hide, or hide a row the app currently relies on browser reads for? Can any statement lock a hot table for long, fail on existing data, or double-apply?

## 4. Rules from CLAUDE.md that the code must not violate

- Auth: only `requireAuth()` / `requireAuthApi()` (the latter **throws**; callers wrap in try/catch → 401). Never raw `supabase.auth.getUser()` (only `/api/whoami` is exempt).
- `PAYROLL_ADMIN_ROLES = ['admin','owner','operations']` — never expanded.
- Schema changes must be additive/nullable (live system).
- Never hard-delete a contract; a superseded `order_form_contracts` row is `voided`, PDF kept. Sales/payroll readers filter `status = 'completed'`.
- Cancelled jobs: `production_jobs.status='cancelled'` written only by `POST /api/ops/jobs/[id]/cancel`; any job-based "sales/ops work" query without a status allowlist must `.neq('status','cancelled')`.
- Canvass attribution: `owner_user_id` wins for pins transferred on/after `CANVASS_OWNERSHIP_TRANSFER_EFFECTIVE_FROM`; any caller of `getAttributedCanvassLeadUserId` must select `ownership_reassigned_at`.
- `bonus_status` enum: `pending_approval | approved | rejected | paid`.
- Org scoping: every query on an org table needs `.eq('org_id', …)` (cross-org exposure is the main historical risk). Service-role client only via `createServiceClient()`.
- Tesla rule: no second implementation of something that exists (flag duplicates; the Known Redundancy table is in CLAUDE.md).
- UI: explicit dark text on light surfaces, AA contrast; ≥44px tap targets and ≥16px input text on phones.
- Canvass app is the model and is deliberately left unchanged — regressions there are critical.

## 5. Business rules the code must implement

- **Commission base** = signed contract total + signed change orders, **excluding sales tax only**. The dealer/lender fee is **never** deducted from commission or OPP. The sale amount stays tax-included. Single writer: `syncJobSaleAndCommissionBase()` in `lib/job-commission-base.ts`. Non-commissionable change orders (`is_commissionable=false`) move sale amount but not the base. Sales tax comes from `proposals.tax_amount`. A dealer fee must never reduce the base (locked by test).
- **Paid in full** = collected within **$0.05** (`PAID_IN_FULL_TOLERANCE_CENTS = 5` in `lib/job-collection.ts`); beyond that only a super-admin override.
- **Super admins = the 3 owners** (Nathan Hall, Andrew Waltz, Steve/"Stevo" Potts), `users.is_super_admin`; `isOwnerProfile` is the owner test. Exactly three.
- **Comp (per job):** setter 5% + closer 7% + sales override 6% + OPP 9% as the base stack, with newer lines (inspection 1.5%, self-gen 6%, manager override 1%) per comp plans; default plans apply only to **active** users, only while active on the sale date and before a person's first explicit assignment (an ended plan was ended on purpose); test accounts (`users.is_test_account`) get no plan, lines or credit.
- **Payroll:** preview must equal Approve (same `planPayrollPeriod`); a paid week is never edited — mistakes become signed lines on the next **open** week; a negative check is carried forward once; settled-externally jobs (pre-cutover) are excluded from plan, preview, Approve and My pay; approval is guarded by the shown total; only finished jobs are payable; any unapproved `job_cost_lines` row with `deduct_from_commission_base=true` blocks a job's materialization.
- **Note audiences** (`lib/threads/visibility.ts`): Team = everyone on the deal; Sales = selling talk (ops reads it); Production = how to build it — **never setters/inside sales/canvassers**; Crew = leaves the building on the crew link, only ops/owners write it. `restricted_pricing` hides a message from anyone barred from sales docs (setters, canvassers, inside sales) **whatever its audience**. Setters and closers read team/sales talk on **their own deals only**; closers may see Production only on deals they own as closer; inside sales works the whole queue but never production or pricing. `audience = NULL` = legacy row, org-wide as today. Unrecognized roles (subs, custom-only) read nothing (fail closed). @mention picker and notification fan-out offer only people who can read the message. Delete own within 15 min; owners hide anything (never hard-deleted). Crew link shows Crew notes only. Subs portal still reads `production_job_notes` (shared-with-sub only).
- **Needs you** (`lib/data-health.ts`): one rule, used by ops dashboard, morning email, Today and `GET /api/needs-you`. Owner (super admin) = everything including money, sale credit, pay plans; ops = operational rows only (`materials_not_ordered`, `permit_pending`, `crews_done_job_open`, `completed_no_costs`, `appointment_no_outcome`), **no dollar amounts, no "holds pay", no pay plans**, and only for roles in `OPS_ROLES` that also have job-board access; field roles (setter, canvasser, setter_manager, sales_rep, closer, rep, inside_sales, call_center…) get **nothing**, whatever else they were granted; inactive users get nothing; appointments older than 14 days drop off (owner-only "Close out old appointments").
- **Job cost** has several readers that are known not to agree yet (Known Redundancy #11 in CLAUDE.md); consolidation is not part of this release.
- **Canvass doors** are counted from two tables today (Known Redundancy #8) — pre-existing, not part of this release.

## 6. Verification already done (by the author — do not trust, re-check)

tsc clean; jest 2,035 pass (2026-10-22); Playwright phone checks (iPhone SE + 13) for every new/changed screen; migration #5 dry-run in a rolled-back prod transaction; data-fix previews on prod (read-only). Role-correct Customer File / thread / nav / Today screenshots reviewed. Step-2 re-runs (tsc, full jest, Playwright, `next build`) will be repeated on the final merge commit after review fixes.

## 7. What to look for, in priority order

1. **Data safety / money:** anything in the payroll stack (`planPayrollPeriod`, lock/approve, adjustments, carry-forward, disputes, My pay) that could double-pay, under-pay, change a paid week, or make preview ≠ Approve; any path that changes commission base or deducts a dealer fee.
2. **Access control / leaks:** audience and pricing visibility (`visibility.ts`, `get-thread.ts`, search, notifications, mentions, crew link, customer-file tabs, `/api/needs-you`, Today); org scoping on every new query/route; RLS in migration #5 vs the service-client rules; any route missing `requireAuthApi` (or not wrapping its throw → 401); privilege escalation via custom roles; setters reaching production/pricing/Money/Files.
3. **Migration & data-fix correctness:** idempotency, ordering, lock behavior, backups actually capturing old values, undo actually restoring, counts (363 / 314 / 478) reproducible, nothing deleted.
4. **Regressions in currently-working flows:** canvass app (knock, book, offline sync), job page tabs, order sheet send preview, reports, contracts signing, old URLs (`/calendar`, `/schedule`, `/ops/calendar`, `/admin/payroll`, the removed pages' redirects), anything that read `production_job_notes` or old note columns.
5. **Dead/duplicate code left behind** (Tesla rule): a second implementation of an existing rule.

## 8. Output format wanted

For each finding: `severity (blocker / high / medium / low)`, file:line, one-sentence defect, a concrete failing scenario (role + input + state → wrong result), and a suggested fix. Separate "confirmed by reading code" from "suspected". Say explicitly which areas you did **not** review.
