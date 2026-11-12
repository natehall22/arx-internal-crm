# ARX Internal CRM — Claude Context

## Company
**ARX Roofing & Exteriors** — residential roofing company, primarily storm/insurance work.
Subcontractor model (no in-house crews). Based in the US, field reps canvass door-to-door.

## Ownership Team
| Owner | Domain |
|---|---|
| Nathan Hall | Closing, tech stack, training, leadership development |
| Steve | Crew scheduling (paid via OPP 9% of commissionable) |
| Andrew | Crew scheduling (paid via OPP 9% of commissionable) |

## Business Model
- **Lead gen:** Door-to-door canvassing (setters) → inspection → close
- **Comp stack per job:** Setter 5% + Closer 7% + Sales override 6% + OPP 9% = 27% of commissionable
- **Average ticket:** ~$16,325 gross; ~28 squares/roof
- **Net per roof:** ~$4,962 after sales comp (18%) and OPEX (4%)
- **Subcontractor cost:** ~$145/sq labor + $100/sq materials + $30/sq dump + $75 permits
- **Call center:** 1 Philippine rep on Enzo Dialer ($230/mo)

## Tech Stack
- **Framework:** Next.js 14 App Router, TypeScript strict mode
- **Database:** Supabase (Postgres 17), RLS enabled
- **Auth:** Custom session-cookie auth via `requireAuth()` / `requireAuthApi()` in `lib/auth.ts` — never use raw `supabase.auth.getUser()`
- **Maps:** Google Maps API (canvassing, territory management, roof measurement)
- **Calendar:** Google Calendar API (inspection scheduling, closer sync)
- **Email:** Nodemailer via SMTP
- **State:** Zustand (canvass offline queue), React state elsewhere
- **PDF:** Custom PDF generation for proposals and contracts

## Key Rules — Never Violate
- `requireAuth()` / `requireAuthApi()` for all auth — never raw `supabase.auth.getUser()`. NOTE: `requireAuthApi()` *throws* on failure (does not return null) — wrap in try/catch → 401.
- `PAYROLL_ADMIN_ROLES = ['admin', 'owner', 'operations']` — never expand this set
- **Canvass attribution: `owner_user_id` wins once a pin has been transferred.** This reverses the
  old "`pin_attributed_user_id` always takes precedence" rule (amended 2026-09-04, Nathan's call).
  `pin_attributed_user_id` is frozen for the life of the pin by the `leads_assignee_display_names`
  trigger, so preferring it credited whoever *first* dropped a pin forever — including reps who
  have left. `getAttributedCanvassLeadUserId` now prefers `owner_user_id` for leads reassigned at
  or after `CANVASS_OWNERSHIP_TRANSFER_EFFECTIVE_FROM`; `pin_attributed_user_id` stays as the
  fallback for its real remaining job, keeping a pin attributed when `owner_user_id` is cleared on
  user delete. The cutoff makes this forward-only so historical door counts don't restate.
  **Any caller of that helper must select `ownership_reassigned_at`** — a row missing it silently
  falls back to the frozen pin owner instead of failing.
- All schema changes must be nullable/additive — system is live and in daily use
- **Commission/OPP base = signed contract + signed change orders, minus SALES TAX only (Nathan's rule, 2026-10-22).** The dealer/lender fee is a profit-side cost and is NEVER deducted from the base. `lib/job-commission-base.ts` is the single source; a test fails if a fee ever reduces it.
- **Never hard-delete a contract.** A superseded `order_form_contracts` row is set to `voided` and its PDF kept (fixed 2026-09-26; signing used to hard-delete + purge signed agreements on split cash/finance deals — 26-0040/0031/0010). Every sales/payroll reader filters on `status = 'completed'`, so a voided row drops out of totals on its own.
- **Contract terms have ONE source: `lib/contracts/terms.ts`; the signing screen and the PDF both render from it (Nathan, 2026-11-06: PDF wording wins).** Installation / repair / contingency terms, the installation Notice of Cancellation (shown on the signing screen behind a collapsed expander, computed server-side as if signed now with the PDF's own `noticeOfCancellation`) and the change-order agreement sentence. Signed contracts are stored PDFs and never re-rendered — a wording change affects new signings only and moves the PDF golden hashes on purpose. `lib/__tests__/contract-terms-screen-pdf-parity.test.tsx` reads the text out of the generated PDF and fails if the screen says anything else.
- `bonus_status` enum: `pending_approval | approved | rejected | paid`
- `manager_user_id` self-referential FK for org hierarchy traversal
- **Tesla Algorithm applies to every change** — question the requirement, delete before you add, never build a second implementation of something that exists. See the full rule and the Known Redundancy backlog below.
- **Cancelled jobs (added 2026-09-14).** A sold job that won't be installed is `production_jobs.status = 'cancelled'`, written ONLY by `POST /api/ops/jobs/[id]/cancel` → `cancel_production_job` (atomic: job + project → cancelled, sale agreement → `voided`, job note). A reason code is required (`JOB_CANCELLATION_REASONS` in `lib/job-status.ts`; `other` needs notes) so cancels can be tracked and credit fails worked again. **The opportunity is NOT touched** (Nathan's call). Sales counts drop the deal because they all filter contracts on `status = 'completed'`; any **job-based** query that means "sales" or "ops work" and doesn't allowlist statuses must `.neq('status', CANCELLED_JOB_STATUS)`. Re-signing reinstates the job dated today (`reinstateCancelledJob`); an admin/owner can undo a mistaken cancel (`DELETE` on the same route → `uncancel_production_job`, keeps the original sale date).
  **PERMISSION REVIEW DUE 2026-11-14:** anyone with ops `jobs:edit` can cancel, "for now". If ARX has ops management by then, that becomes the floor — change `canEditJobs` in the cancel route.
- **Money inputs (2026-10-21, Nathan's call).** (1) Commission base = sale amount = signed contract total + signed change orders; ONE writer, `lib/job-commission-base.ts` (`syncJobSaleAndCommissionBase`), called at contract signing, CO signing, ops job create, repair-contract job create and financial-source. Nobody types it; no dealer-fee deduction; `commission_pre_tax_subtotal` is retired (cleared). (2) "Paid in full / collected" is ONE rule, `lib/job-collection.ts`: payments (non-pending) within $0.05 of `sale_amount`, or a super admin forced it via `POST /api/ops/jobs/[id]/force-paid` (reason required; `close_balance_by/_at` + `payroll_override_audit` 'force_paid_in_full'). A legacy `allow_close_with_balance` with no `close_balance_by` does NOT count. (3) Sale credit (closer = `opportunities.owner_user_id`, setter = `setter_user_id`, self-gen = `is_self_generated`) is confirmed on the contract screen and written only by `lib/deal-sale-credit.ts`; after a sale agreement is signed only a super admin may change it, with a reason ('sale_credit_change' audit). (4) Super admin = owner = `users.is_super_admin`, checked only via `isSuperAdmin()` in `lib/super-admin.ts`; a DB trigger stops anyone but the server setting it.
- **Field roles never see production or money (2026-10-24).** Setters, canvassers, inside sales / call center — by role slug or custom-role NAME, never inferred from permissions — get every `jobs:*` / `ops:*` permission (and `admin:full`) stripped in `resolveEffectivePermissionNames`, are denied Production/Crew threads and the Job/Money tabs in `lib/threads/visibility.ts` + `lib/customer-file/access.ts`, and the SQL `can_view_job_board()` / `message_visible_to()` mirror it (`job-notes-rls-parity.test.ts` keeps TS and SQL equal). The deny runs BEFORE any grant.
- **Payroll phase 1 (2026-11-12, new pay-week path only; `docs/payroll-cutover.md`).** (1) **Pay week is per company**: `orgs.settings.payWeek` {weekStartDay, cutoffTime, paydayWeekday, lateFunding}, in the company's time zone; ONE pure module `lib/payroll-week-schedule.ts`, ONE reader/writer `lib/payroll-week-schedule-server.ts` (`savePayWeekSchedule`, owners only, dates previewed before save; `mergeOrgSettings` refuses top-level `payWeek`, the generic settings save strips it). Nothing saved = the old Thursday–Wednesday week, byte-identical (test-locked). SQL twin `arx_private.payroll_org_week` (carry-over target in `payroll_commit_week`). ARX's agreements = Monday–Sunday, paid Friday, money in by Wednesday 11:59 PM still pays (late-money window, `paysThisWeek`). Never compute a payroll date from `lib/weekly-payroll/cutoff.ts` in new code. (2) **Weekly minimum** = pay-plan rule `comp_plans.weekly_minimum` {amount, needsCheck}: greater of the amount or the person's commission lines that week, one "Weekly minimum" line with its math, office yes/no in Needs you (`payroll_week_minimums`), frozen at Approve. (3) **Only an owner (`isSuperAdmin`) approves** — checked inside `approvePayWeek` from the database; office (`PAYROLL_ADMIN_ROLES`) prepares everything else. (4) **Per-job commission changes = the Change sheet** (`lib/payroll-job-split.ts` → SQL `payroll_set_job_split`, one transaction + audit, refused once paid). (5) **A week's total has ONE definition**, `PAY_LINE_SOURCES` (`lib/payroll-week-total.ts`): the screen, the fake RPC and SQL `payroll_week_person_totals` (parity-tested) — a new pay-line kind is one entry there + the SQL.
- **Payroll Approve is one DB transaction (2026-10-24).** `lockPayrollPeriod` claims the week, computes the plan once, then `payroll_commit_week` writes snapshots/lines/state/frozen per-unit pay, re-validates the total from the tables to the cent, carries negative balances, applies the week's fixes and locks — or rolls everything back. A trigger refuses hours/bonus/fix writes while a claim is live. Locked weeks read stored per-unit pay (`payroll_unit_earnings`), never a recalculation. The week is the Eastern calendar date of the cutoff (`cutoffYmdEt`), never a UTC slice.
- **Data fixes live in `release_backups` (private schema)** as preview/apply/undo functions with previous AND applied values; undo only reverts rows still equal to the applied value.
- **Setter/canvasser contact scope — owner decisions (2026-10-24, Nathan; do NOT re-flag in reviews).** (1) **Knocking a pin unlocks its contact info.** A setter/canvasser's "own work" (`arx_private.lead_mine`, migration 202610290070, mirrored by `lib/contact-scope.ts`) deliberately includes leads they **knocked** (`canvass_knocks`), so one tap on another rep's pin reveals that homeowner's name/phone/email. Intended. (2) **Lead notes stay visible company-wide.** Legacy thread rows with `audience IS NULL` remain readable by everyone in the org by design. Production / crew / pricing-flagged notes stay restricted (`message_visible_to`, `lib/threads/visibility.ts`). Pins still show every rep address, location, disposition and who knocked it; only name/phone/email/notes are blanked on pins that aren't theirs.
- **`reports:financials` is the one financial-data permission (added 2026-10-25).** Revenue, sale amounts, payments, job costs, profit/margin, commission, pay and pricebook cost in reports, CSV export, scheduled emails (each recipient is run as themselves), the forecast, Today totals, the AI assistant, pricebook/roofing-type cost columns and the job page Financials card all need it (`lib/financials-access.ts`; admins/owners via full access, grantable to anyone later with no code change). Every `money` column in the reporting catalog is sensitive automatically, and a template's `finance` flag is derived from what it reads. **Known exceptions, still on older gates (unify during the job-page redesign):** the job page payments/invoices/cost ledger and Money tab (`jobs:financials:view` + billing roles, ops records payments), `app/api/dashboard/*` and `app/api/ops/jobs*` sale amounts, `opportunities.estimated_value` on the opportunity API, payroll pages (`PAYROLL_ADMIN_ROLES`, separate rule).
- **Never push before every gate passes on the exact commit (2026-10-25, Nathan).** `npm run gates` (scripts/gates.sh: hardcode ratchet, jest, tsc, lint, build, phone suite; a failing gate is rerun once and a pass-on-rerun is reported as FLAKY) stamps the commit it passed on, and `.githooks/pre-push` refuses any push whose commit is not stamped. Install it once for the whole repo (checkout + every worktree): `bash scripts/install-hooks.sh`. The working tree must be clean when the gates run. Do not use `--no-verify`. CI (`.github/workflows/ci.yml`) runs the same checks on every PR and push to main.
- **No new hardcoded company identity, time zone or address (2026-11-03, Nathan).** The CRM is being prepared for other companies, so these literals may only shrink. `scripts/hardcode-ratchet.mjs` (first gate in `npm run gates`; `npm run hardcode:check`) scans app/lib/components/hooks/types/middleware and supabase/functions (tests, test-helpers and migrations excluded — migrations join once SQL has an org time-zone helper) for **brand** (`ARX` incl. `ARX_…` identifiers, `arxroofing.com`), **time zone** (any `America/…`, `US/Eastern`, "Eastern Time", `EST`/`EDT`, hand-written `-05:00`/`-04:00` offsets) and **address/phone** (Kannapolis, Dale Earnhardt, Woodbury Ter, ZIPs 28027/28083, the two company phone numbers), and **host** (`vercel.app`, `arxcapitol.com` — every link comes from `getAppUrl(org?)` in `lib/app-url.ts`, which has no fallback host; added 2026-11-10 with the domain cutover, `docs/domain-cutover.md`). Each group's repo-wide total may never exceed `scripts/hardcode-baseline.json` (renames and moving code between files are fine; adding a literal is not), and the baseline may never be higher than main's. After removing literals, run `npm run hardcode:update` (shrink only). Never hand-edit the baseline upward or re-create it. Where the value comes from instead:
  - **Company name, logo, address, phone, email:** the org row (`orgs` + `orgs.settings`) through its existing readers (e.g. `orgLogoHref`). Do not add a second settings store. Fields with no column yet (legal entity name for contracts, website, service-area line, short name, customer-facing From address such as today's `info@` alias, report phone) live under `orgs.settings.brand` and are read through one helper (`lib/org-brand.ts`, multi-company slice 1).
  - **Phone on customer documents:** the owning rep's phone (`users.phone`, active users in the same org only, and only when it is a dialable number), falling back to the company phone (Nathan, 2026-11-05). Inspection report PDF and `/r/[token]` use the report's creator; the report email uses the sender; proposals already show the proposal owner's phone.
  - **"ARX CRM" is the product name; customers only ever see the company (Nathan, 2026-11-05, Salesforce-style).** (a) Staff-facing app chrome (login, Nav title, password-reset/system emails to staff, page `<title>`) may say "ARX CRM", read from ONE product constant (slice 3 moves today's literals onto it; baseline shrinks), with the company's own logo/name alongside. (b) Anything a homeowner, customer or crew sees (reports, proposals, contracts, invoices, customer emails, `/r` and `/crew` pages, SMS) carries ONLY the company's brand (`lib/org-brand.ts`), never "ARX".
  - **`settings.brand` holds only fields with no `orgs` column** (`legalName`, `shortName`, `website`, `serviceArea`, contract spellings `documentLegalName` / `documentAddress`, and `serviceRegion` for "(… and nearby)" copy; ≤ 120 chars each). `DEFAULT_ORG_BRAND` is blank; ARX's strings are only a legacy fallback while `DEPLOYMENT_ORG_ID` is unset (docs/multi-company-plan.md 2b). New companies: `npm run seed:company`. Name/phone/email/address always come from their columns. Only super admins (`isSuperAdmin`) may change brand fields; the one writer is `saveBrandSettings` (atomic SQL merge `merge_org_brand_settings`, migration 202611050010, with a read-merge-write fallback until it is applied).
  - **Time zone:** import `DEFAULT_TIMEZONE` from `lib/timezone.ts` (or an existing module constant that already holds it) — never type the zone, an offset, or an `EST`/`EDT` label. **Time handling has broken repeatedly (payroll cutoffs, DST, the 2026-07-17 double-shift).** Moving an existing literal onto the shared constant must keep the value byte-identical, and any change to how a time is computed needs a DST test (both Mar and Nov transitions) before it ships. Do not "fix" offset math while consolidating — consolidation and behavior changes go in separate commits.
- **Company web address fence (2026-11-10, slice 10).** `lib/company-host.ts` is the ONE place that turns the request host (`<sub>.<APP_BASE_DOMAIN>`, `orgs.subdomain`) or the iPhone `X-Company-Code` header into a company; `resolveAuth`, `middleware.ts` and the login route use it. Precedence `DEPLOYMENT_ORG_ID` > host > header, disagreement refuses. Never parse the host elsewhere; never set a cookie `Domain` (test-enforced). Details: docs/multi-company-plan.md slice 10.
- **Every company-table query is company-scoped — gate `org-scope` (2026-11-10).** All companies share ONE database and the service client skips RLS. `scripts/org-scope-check.mjs` (2nd gate in `npm run gates`, also in CI; `npm run org-scope:list` prints every finding) parses every `.from('<table with org_id>')` chain with the TypeScript compiler and fails on any NEW chain that is not scoped; existing ones are grandfathered per file in `scripts/org-scope-baseline.json`, which may only shrink (`npm run org-scope:update`). A chain passes with `.eq('org_id', …)` (or `.in/.filter/.match`), through `orgDb(client, orgId)` (`lib/supabase/org-db.ts` — **use this in new code**: adds the org filter to select/update/delete, stamps org_id on insert, refuses a row naming another company, refuses an upsert whose onConflict lacks org_id), by filtering on a row that was itself loaded company-scoped in the same function (incl. "load by id + bail if empty", "load by id, then `if (!x || x.org_id !== org) return`"), by a secret token column, as an insert, or with `// org-scope-ok: <why>`. A URL/body id or a function parameter is NOT scoped. Upserts keyed only on an id can re-home another company's row — they need org_id in onConflict, a checked key, or a reason. Full rule at the top of the script; fixtures in `lib/__tests__/org-scope-check.test.ts`. User-token (RLS) clients and `'use client'` files are not checked; RLS policies and `.rpc()` SQL are their own audit.
- **Per-copy fence `DEPLOYMENT_ORG_ID` (2026-11-06).** Each company's copy sets env `DEPLOYMENT_ORG_ID` to its own org id; `resolveAuth` in `lib/auth.ts` (behind `requireAuth` / `requireAuthApi` / `getAuthContext`) then treats a profile from any other org as no profile (401 / login redirect). Unset = no fence. The 42 #3b hand-rolled-cookie routes and other raw `auth.getUser` paths do NOT pass through it until they move onto `requireAuthApi`.
- **Mandatory change review — no exceptions for size or type:** every code change gets a proactive bug-bot review + full collateral-impact sweep (edge/fringe cases, other features touching the same tables/routes/flags) before it ships, then `/code-review` and `/security-review`. Do this without being asked.

## The Tesla Algorithm — Standing Rule for All AI Work

Apply these five steps **in order** to every task. Order matters: optimizing a
requirement that shouldn't exist, or automating a process that should be deleted,
is wasted work. Most of the value is in steps 1 and 2 — do not skip ahead to 3.

1. **Question every requirement.** Every requirement carries a name, not a
   department. Ask *who* asked for this and *why*. "The CRM has always done it
   that way" is not a requirement. If the requirement is wrong, say so before
   building.
2. **Delete the part or process.** If you aren't adding back at least 10% of what
   you delete, you didn't delete enough. Prefer removing a code path, a table, a
   flag, or a whole screen over adding a new one beside it. **A second
   implementation of something that already exists is a bug, not a feature.**
3. **Simplify or optimize** — only what survived steps 1 and 2.
4. **Accelerate cycle time.** Speed up what's left. Never speed up a step that
   should have been deleted.
5. **Automate — last.** Automating a broken or redundant process just makes it
   fail faster.

### How this applies here — non-negotiable
- **Before writing a new helper, function, constant, or component: grep for it
  first.** If something close exists, extend it. If two now exist, delete one in
  the same change. Do not leave both.
- **Flag repetition when you see it, unprompted.** If you notice the same logic,
  literal, query shape, or boilerplate for the 3rd time, stop and say so — name
  the file count and propose the single home for it. Don't wait to be asked.
- **Don't silently duplicate to avoid a refactor.** If consolidating is out of
  scope for the current task, say that explicitly and add the item to
  **Known Redundancy** below rather than quietly copy-pasting.
- **"Done repeatedly over and over" is a defect report.** Nathan's time is the
  scarce resource. Repeated manual steps, repeated explanations, and repeated
  code all count.

## Known Redundancy — Consolidation Backlog
Audited 2026-08-21. Ranked by risk, not by line count. Each is a step-2 delete
candidate, not a step-3 tidy-up. Do not add to these patterns; when you touch a
listed file, migrate it.

| # | Redundancy | Scale | Risk |
|---|---|---|---|
| 1 | **Authorization is implemented twice.** `lib/permissions.ts` (1,213 lines, real `PermissionName` model + `effective-permissions.ts` DB resolution) exists, but only ~2 API routes call `hasPermission`. Everything else hardcodes role literal arrays. | ~100 inline role arrays across 40+ distinct shapes (`['admin','regional_manager','sales_manager']` ×16, `['admin','regional_manager']` ×14, …); **17 separate single-purpose access modules** in `lib/` (`payroll-admin-access`, `finance-access`, `ops-access`, `goals-admin-access`, `proposal-delete-access`, `sales-doc-access`, `comp-plan-roles`, `manager-commission-roles`, `canvass-territory-manager-roles`, `scheduling-create-permission`, `dashboard-setter-role`, …) | **Highest.** No single place answers "who can do what." A role added or renamed must be found in ~100 spots. Security-relevant. |
| 2 | ~~**`getAdminClient()` redefined per-route.**~~ **DONE 2026-08-21** — all **83** local factories deleted (81 API routes + the `contracts/sign` and `change-orders/sign` server pages, which a `route.ts`-only glob initially missed). Every one now calls `createServiceClient()` from `lib/supabase/service.ts`, hardened with `auth:{autoRefreshToken:false,persistSession:false}` (previously omitted — which also stops a per-call 30s auto-refresh `setInterval` that was keeping the serverless event loop alive on ~198 pre-existing callers). `SUPABASE_SERVICE_ROLE_KEY` now appears in **8** files, down from 88: the helper, `lib/auth.ts`, `app/api/health/route.ts` (presence check), 2 tests, 3 `scripts/`. | was 83 | Closed |
| 3 | ~~**`createServiceClient` name collision.**~~ **DONE 2026-08-21** — dissolved by #2. The 6 aliased files turned out to be 3 real ones using the **anon key + user JWT**, not service role; renamed to `createAnonClient` so the identifier stops lying. | was 6 | Closed |
| 3b | **Local `getAuthClient()` re-parses session cookies by hand.** Found while doing #2. `app/api/admin/scheduling/route.ts` hand-rolls cookie lookup + JWT extraction (the `reports/builder` and `reports/custom` copies were deleted with the old report builder, 2026-10-22), duplicating `lib/supabase/session-cookie.ts` + `createRequestScopedClient()` in `lib/supabase/request-client.ts`. **Recount 2026-11-02: 43 route files** still define a local `getSessionFromRequest`/`getAuthClient` (e.g. `admin/settings`, `admin/users`, `leads`, `proposals`, `proposals/[id]`, `canvass/data`, `appointments`, `calendar/*`) — not 1; `admin/logo` and `proposals/[id]/image` were moved to `requireAuthApi` in the files-bucket phase-2 prep; `admin/user-permissions` moved 2026-11-06 (its GET let any signed-in user read anyone's grants). | 42 files | Medium — deliberately NOT folded into the #2 consolidation: it changes auth-token parsing behavior (notably the null-token path, which currently falls back to an unauthenticated anon client). Needs its own change + review. |
| 4 | **Manual org scoping on every query.** `.eq('org_id', …)` hand-written per call site; `.from('users')` raw 372×. | **1,284 `.eq('org_id')`** (recount 2026-11-06; was 989), 372 `users`, 137 `production_jobs`, 131 `opportunities`, 111 `leads`, 109 `scheduled_appointments` | High — one omitted `.eq` is cross-org data exposure. This is the mechanism behind the parked AI-assistant F2 finding. **2026-11-10:** scoped builder `orgDb` (`lib/supabase/org-db.ts`) + the `org-scope` gate now exist; remaining unscoped chains are the baseline in `scripts/org-scope-baseline.json` (migrate a file when you touch it). |
| 5 | **Timezone hardcoded.** `'America/New_York'` literal. | **154 occurrences** (2026-11-03 ratchet count incl. `EST`/`EDT`/`-05:00` offsets: 200). Plus **10 separate exported constants** all = `'America/New_York'` (`DEFAULT_TIMEZONE`, `EASTERN_TZ`, `PAYROLL_TZ`, `WEEKLY_PAYROLL_TZ`, `CALENDAR_BUSINESS_TZ`, `SETTER_RAMP_PAYROLL_TZ`, `SISU_*`, `STORM_ALERT_TIMEZONE`, `FEEDBACK_PROMPT_DISPLAY_TIMEZONE`), and `lib/timezone.ts` hand-rolls DST as a fixed 4/5-hour offset. Now ratcheted (cannot grow). | Medium-high — already caused the inside-sales reschedule double-TZ bug (2026-07-17). Blocks any non-Eastern market. Needs one `ORG_TIMEZONE` source. |
| 6 | **Formatters re-implemented per file.** No shared `lib/format.ts`. | 18 local `formatCurrency`/`formatMoney`, 33 local `formatDate`/`formatTime`, 22 raw `Intl.NumberFormat`, 159 raw `toLocaleDateString` | Medium — proposals/PDFs/commissions can render the same number differently. |
| 7 | **Error-response literals.** | `NextResponse.json({error:'Unauthorized'},{status:401})` **348×**; `'Forbidden'` 403 **168×**; plus 6 competing synonyms for 403 (`'Access denied'` 24, `'Not authorized'` 8, `'Permission denied'` 4, …) | Low severity, high volume — inconsistent client-side error handling. Needs `unauthorized()` / `forbidden()` helpers. |

| 8 | **Doors are counted twice, from two different tables.** Migrations `202608250002/3` moved dashboard door counts onto `canvass_knocks` (credited to the actual knocker at write time), but `app/dashboard/page.tsx:376` (`rawDoors`, per-member) and `app/sisu/page.tsx:64` (`doorsKnocked`) still count them from `leads` via `getAttributedCanvassLeadUserId`. The two disagree on any reassigned pin — and since 2026-09-04 the leads path is additionally cutoff-gated, so member rows need not sum to the org total beside them. Found during the 2026-09-04 attribution work; not fixed there because collapsing it changes what the dashboard reports. | 2 read paths | Medium-high — two live answers to "how many doors did this rep knock," one of them payroll-adjacent. |

| 9 | **"What was sold on this job" — down to one resolver left.** 2026-09-05: the squares + roof-measure chain was collapsed into `lib/job-sold-scope.ts` (`buildJobSoldScope`, `resolveJobProposalId`, `resolveJobOpportunityId`, `findJobRoofMeasurementRow`), now the single source for `/ops/jobs/[id]`, the materials-order print sheet, and `lib/job-run-sheet.ts`. Two paths were deliberately left alone: (a) `components/ops/SoldScopeCard.tsx` re-fetches the proposal + line items **client-side** through the browser/anon client with its own `linked ?? accepted` precedence and its own with-squares/without-squares fallback select; (b) `app/ops/jobs/[id]/page.tsx` ~L147-210 resolves the job's opportunity from `order_form_contracts` → address match → `project.opportunity_id`, which `resolveJobOpportunityId` does not fully reproduce — the page passes its answer in as an override. **Partially closed 2026-09-05:** `resolveJobOpportunityId` gained an org-scoped `address_text` leg that runs only after proposal → project both come up empty, because without it the supplier order sheet resolved a *different* opportunity than the card ops read on screen and printed a blank sheet for jobs whose measurement is linked by `opportunity_id` only. It still does not reproduce the page's `order_form_contracts` leg. **(a) closed 2026-09-06:** `SoldScopeCard` no longer fetches proposals/`proposal_line_items` client-side or runs its own `linked ?? accepted` precedence / squares resolution (`lib/sold-roof-squares.ts`) — it now takes a required `scope: JobSoldScope | null` prop (the job page passes `job.sold_scope`, the same `buildJobSoldScope` output every other consumer uses) and renders squares, the proposal link/number, and line items straight from it. It keeps one narrow, ID-anchored client fetch — `proposals` by `scope.proposal_id` — purely for cosmetic fields `JobSoldScope` doesn't carry ($ total, free-text scope, accepted date) for the AI job packet; that fetch can't disagree with the rest of the page since the id is already fixed by `scope`. Also found and deleted the same day: a third, undocumented resolver, `components/ProjectSoldScope.tsx` on `/projects/[id]`, keyed only on `project_id` with no linked-proposal/opportunity fallback at all — replaced with a link to the job's Sold Scope card on `/ops/jobs/[id]` when a production job exists for the project, or the project's raw `sold_roof_squares` field (no line items, no resolution) when it doesn't. (b) is still open. **2026-09-28:** `lib/job-run-sheet.ts` still read raw `proposals.sold_squares` + its own measurement lookup, so the crew sheet and supplier sheet disagreed on 3 of 40 live jobs (26-0030: 28.56 vs 33 sq). It now reads squares/LF off `buildJobSoldScope` and starter off the order list (ops edits included), and `buildJobMaterialOrder` is a view of `buildJobRunSheet` — one assembly, two PDFs. Locked by `lib/__tests__/job-run-sheet-order-parity.test.ts`. | 1 path | Medium — (b) means "which opportunity backs this job" still has two answers. Not safe to fold in as a drive-by: it changes which measurement the job page picks. |

| 10 | ~~**Two write paths to the install-scheduling columns.**~~ **DONE** — the generic `PATCH /api/ops/jobs/[id]` no longer accepts `scheduled_date`, `scheduled_time_start`, `estimated_duration_hours`, `assigned_sub_id` or `assigned_crew_id` (verified on main 2026-09-26). Install scheduling writes only go through `/api/ops/install-schedule/assign|unassign`. | was 2 | Closed |

| 11 | ~~**A job's cost is computed FIVE different ways, and they disagree.**~~ **DONE 2026-10-21 (branch `fix/one-cost-ledger`).** `job_cost_lines` is the only cost ledger. **One write path:** `POST/PATCH/DELETE /api/ops/jobs/[id]/cost-lines` — the Materials "+ Job Cost" button and Photos & files "+ Add cost line" both call it (`/api/jobs/[id]/product-orders`, `lib/ops-product-orders.ts`, the `/ops/jobs/[id]/orders` list and the "Save Labor Cost" box are deleted; labor is a cost line with type Labor). **One reader:** `lib/job-cost-ledger.ts` (`loadJobCostLedger` → `summarizeJobCostLines`, `jobDirectCost`), used by the job page Financials card, ops board (`enrichJobsWithCostLedger` → `job.job_costs`), `/admin/job-profit-tracker`, `lib/goals-job-economics.ts`, `lib/payroll-period-materialization.ts`, the payroll worksheet and the ops dashboard. Live lines only (`status='active'`, not deleted). The mirrored `Lender / dealer fee` line is excluded from the total; `dealer_fee_amount` is added once. `job_product_orders` and `production_jobs.material_cost/labor_cost` are kept as read-only history (data moved by `supabase/data-fixes/2026-10-21_one_cost_ledger.sql`). New lines are born `approved=false, deduct_from_commission_base=false` so a cost can never block payroll on a flag that isn't wired into pay. **Still true: do NOT wire `deductible_costs_total` into the comp base without its own decision** (flip `NEW_COST_LINE_PAYROLL_FLAGS` when that happens). Leftovers: `contracts/sign` + `financial-source` write the dealer-fee line by description and without `source='dealer_fee_sync'`; `SoldScopeCard` reads a non-existent `production_job_cost_lines` table for the AI packet. | was 2 write paths, 5+ readers | Closed (leftovers Low) |

| 12 | ~~**Payroll still computes monthly sales volume.**~~ **Volume path DELETED 2026-09-26** (re-verified in prod first: 0 volume-metric tiers in `comp_plans`/`comp_plan_versions`). Still open: `app/api/contracts/sign/route.ts` has two near-identical "create or update the production job" blocks (new-project and existing-project). The signed-contract data-loss bug that made folding them risky is fixed (see Key Rules), so they can now be folded together with ordinary care. | 2 job-create copies | Low |

| 13 | **"Which signed contract is this job's" — three answers.** 2026-09-28: `lib/job-contract.ts` (`findJobSignedContracts`: resolved proposal → resolved opportunity, org-scoped, `completed` only) now feeds the job sheets. But `app/ops/jobs/[id]/page.tsx` still has two older lookups: `installationAgreement` (~L141, the "View Installation Agreement" link) loads **every** completed installation/repair contract through the request client and does one `opportunities` query per contract to exact-match the job's address; `originalContract` (~L239, Financials) matches `order_form_contracts.project_address` to the job address, then falls back to the first opportunity at that address. Address matching picks the wrong contract when a customer has two deals at one address. | 3 lookups | Medium — not migrated in the sheets change because it changes which PDF link and which `project_cost` the job page shows. Move both onto `findJobSignedContracts` when the job page is next restructured (same trip as #9b and #10). |

| 14 | **"Does this lead count as a door" has two source lists that already disagree.** `lib/sales-metrics.ts` (`DOOR_COUNT_SOURCES` / `NON_CANVASS_DISPOSITION_SOURCES`, read by dashboard per-member, sisu, goals scorecard + channel attribution) vs `lib/canvass-lead-attribution.ts` (`CANVASS_DOOR_SOURCES` / `CANVASS_NON_DOOR_DISPOSITION_SOURCES`, read by knock logging). `call_center` is excluded in one only; since 2026-10-01 `solar_import` (6,487 bulk Solar Home pins) is excluded from the sales-metrics list ONLY, on purpose, so a later real re-knock still logs a door. Collapse to one module with an explicit "counts on read" vs "logs a knock" split rather than two lists. | 2 lists | Medium — a source added to one and not the other silently shifts door counts between dashboard paths. |

| 15 | ~~**"What is a person's total for a pay week" exists three times:**~~ **DONE 2026-11-12** — `PAY_LINE_SOURCES` in `lib/payroll-week-total.ts` is the definition; `composeWeek` and the fake RPC use it, the SQL is parity-tested (`payroll-week-total-parity.test.ts`). Left: the statement builder (`buildPayrollStatement`, shared with the legacy path) still sums with `computeNetPayout` — fold it when the legacy path is deleted. Original note: `composeWeek` (`lib/payroll-pay-week.ts`), SQL `payroll_week_person_totals` (the atomic-approve validator) and the fake RPC mirror in `lib/test-helpers/fake-payroll-rpc.ts`. Also dead since the atomic approve: SQL `payroll_discard_lineless_job_snapshot`. | 3 copies | Medium — a new pay-line kind must be added in all three or Approve refuses every week. The SQL runs against Postgres in `supabase/tests/run-release-2026-10-batch.sh`. Fold into one definition when payroll is next restructured. |

| 15 | **Two payroll lock paths while `PAYROLL_PAY_WEEK_ENABLED` is off (2026-10-24).** `lib/legacy-payroll-lock.ts` + `lib/legacy-payroll-materialization.ts` are main's pre-atomic lock/eligibility code kept so the release ships with payroll unchanged; `lib/payroll-period-materialization.ts` (`planPayrollPeriod`, `derivePayrollEligibility`) + `payroll_commit_week` are the new one. Delete the legacy pair, the restored old payroll pages/routes (`app/admin/payroll/{periods,weekly,statements,[periodId]}`, `LegacyPayrollPage.tsx`, `lib/weekly-payroll/{commission-base,eligibility,explicit-rules,index}.ts`) and the build-time redirect conditional in `next.config.js` the day the flag is turned on for good. | 2 lock paths | Medium — a payroll rule fixed in one and not the other. |

**Known Redundancy additions (2026-11-11):** (29) the request lifecycle in `lib/signing/requests/sign.ts` (claim, events, complete, void, decline, resend) parallels `lib/signing/lifecycle.ts` for contract/CO rows; fold when PR4 moves the rest onto the engine.

**Rule going forward:** items 1, 3b, 4 and 5 are the ones that can cause a real incident.
Fix opportunistically — when a task already touches one of these files, migrate
that file rather than extending the pattern.

## AI connector (2026-11-13, phase 1: read-only; `docs/ai-connector-plan.md`)
Lets a person use their own AI app (Claude, ChatGPT) against the CRM AS THEMSELVES. Switch `aiConnector` (default OFF, owners, Settings → Features); owner screen `/admin/ai-connector`, each person's own list `/settings/ai-apps`. Migration `202611130010_ai_connector.sql` (NOT applied).
- **Our own OAuth 2.1 server** (`lib/ai-connector/`): discovery `/.well-known/oauth-protected-resource[/mcp]` + `/.well-known/oauth-authorization-server`; `/oauth/register` (DCR), Client ID Metadata Documents (SSRF-guarded fetch), `/oauth/authorize` (consent page; public so the query survives sign-in, resumes through `/oauth/resume/<ticket>`), `/oauth/token`, `/oauth/revoke`. PKCE S256 only, `resource` = `<company address>/mcp` (audience; any other is refused), `iss` on every authorization response, exact redirect-URI match against a short allow-list (verified Claude + ChatGPT callbacks in `config.ts`, plus owner-added addresses at `settings.aiConnector.redirectUris`, written ONLY by `/api/admin/ai-connector` — the generic settings save strips it). Keys are opaque, stored as SHA-256 hashes (`ai_oauth_grants`), 1 h access + 30 d rotating refresh; a retired refresh key shown again revokes the grant, so does a code used twice. Never a Supabase session.
- **ONE door `authenticateMcpRequest`** (`authenticate.ts`) → the SAME `{ authUser, profile }` `requireAuthApi` returns. Re-checked every request: key live + audience = this address + host fence (company web address only, never the iPhone header) + person still active in that company + company switch on + `crm:read`. Person off / switch off / revoked = 401 on the next call. `/mcp` (POST only, JSON, stateless) is `lib/ai-connector/mcp.ts`: Origin check → auth → rate limit (60/min person, 300/min company, memory) → tool → audit row → reply; a call that cannot be audited is not answered.
- **Tools** (`lib/ai-connector/tools/*`, all read-only, zod `.strict()` args) call the helpers the screens use, with the person's own permissions and `orgDb`: `searchGroupsForCaller` (lib/global-search-server.ts, shared with `/api/search`), `loadCustomerForCaller` (lib/customer-file/customer-read.ts, shared with `/api/customers/[id]`), `offeredTemplates` (lib/reporting/offered.ts, shared with `/api/reports/run`), `resolveOpsAccess`, `callerCanAccessJobBilling`, `canOpenDeal` + `getTimeline`, `loadVisitsPage`. Field roles get nothing of jobs / money / visits. `run_report` runs ONLY ready-made templates the person is offered (never a free-form spec). Unknown and not-yours are the same answer. Customer/staff-typed text is fenced by `wrapUntrusted`; results capped (`capResult`). Gate codes / access notes are never returned.
- **Audit** `ai_audit_log` via the ONE writer `writeAudit` (args as a hash, never text). Tests: `ai-connector-oauth|mcp|breakin.test.ts` (breakin = every tool as company B with A's ids + field roles, on the shared harness).
- **New tool rule:** add it to `MCP_TOOLS`, a `.strict()` schema, scope it with the person's own gate, wrap typed text, add it to the break-in `ATTACKS` list. Phase 2 (writes = preview + confirm), phase 3 (uploads), phase 4 (real-client testing + security review) are in the plan doc.
- **Security review fixes (2026-11-11), migration 202611130020 (apply BEFORE the code, else counters fall back to memory):** rate limits are database counters (`lib/ai-connector/rate-limit.ts`, `ai_rate_hit`) keyed per app / person / company — the per-address limit is only a loose backstop because Claude and ChatGPT share egress addresses; DCR is capped per address per day + globally and never-used apps are pruned after 7 days (`ai_prune_unused_clients`); the metadata-document fetch resolves DNS once and pins the connection to that checked address (no redirects); every connection ends 90 days after approval (`created_at`); a consent approval is single-use (`ai_claim_once` nonce); sign-in events and refused calls are audited; the consent screen always shows the "only continue if you started this" warning, the app name and the return host; setters/canvassers only find/read customers that have a lead of theirs (`tools/contact-scope.ts`, same `my_lead_ids` rule).
- **Known Redundancy (2026-11-11):** the setter/canvasser contact scope is applied to customer RECORDS only in the connector. The app's own `/api/customers/*` and customer search still return every customer's phone/email to field roles (only leads/pins are scoped by `lib/contact-scope.ts`) — apply `ownCustomerIds` (or move it to `lib/contact-scope.ts`) to those screens when decided; not changed here.
- **Phase 2: writes, approved by the PERSON (2026-11-11, migration 202611150070 NOT applied; apply BEFORE the code, else every change fails closed).** The AI never holds the power to save. Scope `crm:write` is granted only when the app asked, the owner switch `aiConnectorWrites` ("AI can make changes", default OFF) is on, AND the person ticked it at consent; `tools/list` hides change tools otherwise and a direct call is refused (`writes_off`, audited). ONE engine `lib/ai-connector/changes.ts` (`writeTool`): a change tool only PREPARES (exact preview, stored as an `ai_changes` row) and hands the AI a preview + `review_link` `/ai-changes/<id>` — **no key, no token**. Only the signed-in person saves it: the review page (`app/ai-changes/[id]`) shows the exact change and Approve / Decline → `POST /api/ai-changes/[id]` (session cookie + same-site browser Origin; an AI bearer key reaches nothing) → `approveChange`: same person, 10 minutes, once (conditional-update claim), connection still live, company switch on, permission AND preview re-checked (`changed_since_preview`), idempotent replay. Pending changes show on the person's Today (`loadAiChangesQueue`). `confirm_change(change_id)` is STATUS ONLY (read-only, never applies). Tools call the EXISTING writers as the person (`postMessage`, `createLeadRecord`, `upsertCustomer`, `applyVisitAction`, `addJobCostLine` via `lib/job-cost-record.ts`, `createServiceInvoiceFromLines`, `savePoDraft` with `createOnly`): add_note, log_contact, create_lead, create_customer, reschedule_visit, add_cost_line (approved=false), draft_invoice, draft_purchase_order. NO tools for payments, payroll, sending, deleting, permissions or settings; no `schedule_visit`. AI-written notes/contacts are tagged "Written by AI (via <app>)", never notify, and `@names` are not mentions (`noMentions`). A duplicate the person cannot open is never named ("ask the office"). Previews use the SQL writer's integer-cents math (`lineTotalCents`). A save stuck in `applying` is retried once for idempotent writers (notes/contacts, keyed on the change id); everything else shows on the owner screen as STUCK. Failed rows are kept 30 days. Every preview, approval, decline and refusal is audited. **New change-tool rule:** add it via `writeTool`, reuse the screen's writer and gate, add it to the break-in phase-2 attack list; never return anything the AI could use to apply it.
- **Phase 2 not built (decided):** the owner setting "Let people approve notes and contact logs from the AI chat" (MCP elicitation) — our stateless JSON endpoint cannot send the server-to-client request elicitation needs; revisit with streaming. Review page has no `e2e/mobile.spec.ts` case yet.
- **Known gaps (phase 1):** CIMD refresh uses built-in + owner-added redirect addresses for the company address that is asking; not yet tried against a real Claude / ChatGPT connector (phase 4).

## Industry profiles (2026-11-10, Nathan's per-business customization decision)
Layers: core → **industry profile** → company settings → roles/people. Definitions (versioned, pure data): `lib/industry-profiles.ts` — `roofing` (= the app before profiles; an org with no `settings.profile` IS roofing, byte-identical, test-locked), `lawn_landscape`, `exterior_cleaning`, `home_builder`. **ONE resolver: `lib/org-profile.ts`** (`resolveOrgProfile` / `loadOrgProfile`, `t(profile, key)`, `applyTodayProfile`, client payload on `/api/me/effective-permissions` `flags.profile` → `useOrgProfile()` in `hooks/useOrgFeatures.ts`).
- **Feature switches:** `resolveOrgFeatures` is profile-aware — saved switch (boolean in `settings.features`) > profile default > ON. Never read `settings.features` any other way.
- **Words:** small fixed key set (`TERM_KEYS`: job, jobs, jobBoard, productionBoard, inspection, proposal, install, installed, subs), used by Nav (Jobs section + board link), /ops heading, customer file Job tab + progress steps + "Next" button, Settings → Subcontractors. Not i18n: add a key only where you wire it, and roofing's value must equal today's word.
- **Profile also sets:** Nav section order + hidden menu entries (pages keep their own gates), Today card order/hidden + `texts` (card titles and empty texts keyed by today's exact wording, parity-tested against `lib/today.ts`; rows "Job …"/"install …" follow the job/install words; the morning email gets the same, keeps its own order), price book add-on categories + units (`app/admin/proposals`) and service-type units (`app/admin/pricing`, roof-measured only — non-roofing profiles have none), starter report templates (`/api/reports/run` GET), starting trades. "Crews" is never a word for subs (crews = a job's trade crews).
- **First paint:** server pages pass the resolved profile down (`useOrgProfile(initial)`: /ops, the job page). Nav needs nothing: the profile only changes permission-gated entries, which appear in the same batched update that brings the profile (test-locked). The root layout stays free of auth/DB reads (keeps static pages static). Known flash: the 'use client' /admin/subs heading for home_builder only.
- An unknown stored profile id runs on roofing defaults, is flagged (`unknownStoredId`) and the owner can switch. Saving an add-on in a service unit before migration 202611100090 → 409 `unit_not_ready` with a plain message.
- **Stored** `orgs.settings.profile = { id, version }`, written ONLY by `applyIndustryProfile` (`lib/org-profile-server.ts`, owners via `/api/admin/industry-profile`, Settings → Industry profile card: preview then apply) and the company seed (`"profile"` in the input / `--profile=`), through `mergeOrgSettings` path ['profile'] (top-level writes refused; the generic settings save strips it). A switch never deletes: trades are add-only (`planOrgTradesAddOnly`), own feature switches are kept unless the owner ticks "use this profile's switches". Bump a profile's `version` whenever its definition changes.
- Units `visit`/`month`/`hour` need migration `202611100090` (NOT applied); only non-roofing profiles offer them.

## Sales tax (2026-11-10)
- **ONE calculation: `lib/sales-tax.ts`** (`computeSalesTax`; `computeDocumentSalesTax` for company defaults). Proposals go through `computeProposalTotals` (`lib/proposal-pricing-visibility.ts`, screen AND server save), invoices through `recalculateInvoiceTotals` → `computeCustomerSalesTax` (`lib/sales-tax-server.ts`), estimates (`lib/calculations.ts`) and service plans the same. Never multiply a rate anywhere else.
- **Rounding:** once per document per rate, half-up to the cent; one rate + every line taxable = the original proposal formula (golden: `lib/__tests__/sales-tax.test.ts`, 10 real ARX proposals + 5,000 random).
- **Settings** `orgs.settings.salesTax` = `{ enabled, rates[{id,name,percent,active}], defaultRateIds }`, owners only, ONE writer `saveSalesTaxSettings` (mergeOrgSettings path ['salesTax']; refused until migration 202611110040). **No `salesTax` key = original behaviour** (one typed rate per quote starting at 8.25%, every line taxed; invoices untaxed) — that is ARX today. New companies are seeded set up with no rates.
- **Documents keep a snapshot** (`proposals.tax_lines`, `job_invoices.tax_lines`, `[{id,name,percent,amount_cents}]`); `tax_amount` stays the sum, so the commission base (contract + COs − `proposals.tax_amount`) is unchanged. Legacy quotes (no snapshot) stay legacy when edited. Only rate IDS come from the browser; the server recomputes rate quotes.
- **Invoice tax is on top of `sale_amount`** (which is the tax-included contract and never includes invoice tax): contract-balance checks use pre-tax invoiced amounts (`getTotalInvoicedCentsForJob`); paid-in-full adds invoice tax to what must be collected via `evaluateJobCollection({ invoiceTaxCents })`, loaded by `loadInvoiceTaxCentsByJob` (`lib/job-invoice-tax.ts`) — wired into the job page summary, banners, ops board + catch-up chip, ops dashboard, both payroll eligibility paths + waiting text, the payroll worksheet and the profit tracker balance. `invoice-tax-collection.test.ts` fails if any `evaluateJobCollection` call omits it. 0 for ARX.
- **Taxable:** quote line override ?? price-book `is_taxable` ?? true; invoice lines are taxed ONLY when marked (contract/deposit/balance lines are tax-included). Exempt customers (`customers.tax_exempt`, billing staff only, certificate = a customer document) get no tax rows.

## Quote approval — optional items, online approval, deposits (2026-11-11)
Switch `quoteApproval` (default OFF; lawn_landscape + exterior_cleaning profiles ON). It EXTENDS proposals — no second quote system.
- **Decision: approval == a signed sale agreement.** Approving a quote (`/q/<token>`, typed name + time + IP) runs `approveQuote` → `finalizeApproval` (`lib/quotes/approve.ts`): rewrite the proposal to the approved selection, create an installation `order_form_contracts` row (`quote_approval_id` set), sign it through the ONE sign route (`signContract`) — so opportunity → won, job create, `syncJobSaleAndCommissionBase` (base = approved total minus sales tax only), paid-in-full (`lib/job-collection.ts`) and payroll readers all work unchanged. There is no second "won" writer.
- **Optional items:** `proposal_line_items.is_optional` / `optional_default_on`. The stored proposal total counts required + default-on lines only (builder `calculateTotals`, `proposalSalesTaxFields`). `lib/quotes/pricing.ts` `priceQuote` is the one client+server pricing function (wraps `computeProposalTotals`); the server re-prices at approval and refuses if the fingerprint changed (office edited the price after the page opened).
- **Deposit:** owner setting `orgs.settings.quoteApproval` (none / percent / fixed, link days, terms; written ONLY by `/api/admin/quote-approval` via `mergeOrgSettings`; the generic settings route strips it) + per-quote override (`proposals.deposit_mode/value`). It becomes a `job_invoices` row (kind 'deposit') paid on the existing `/pay/<token>` Stripe Connect page — `recordJobPayment` / `record_customer_invoice_payment`, no second payment path. It is part of the sale amount, never added to it.
- **Token:** `quote_links` (hashed, expiring, revocable, host-fenced; a new link revokes older ones). Single use = `unique(quote_approvals.proposal_id)`; finalize is repeatable under a 2-minute lease. Approval rows are immutable evidence (trigger) and the proposal FK is `restrict`.
- **Customer pages carry only the company brand.** Terms: the company's own `quoteApproval.terms`, snapshotted on the approval. Installation terms in `lib/contracts/terms.ts` are unchanged; the sign route skips the PDF and the signing email for quote approvals (`isQuoteApproval`).
- **Approval record (ESIGN):** `finalizeApproval` renders `components/QuoteApprovalPDF.tsx` from the approval SNAPSHOT (names, descriptions, quantities, tax per rate, terms, typed name + time + IP; `lib/quotes/pdf.ts`), stores it at `org/<org>/quotes/<approval>.pdf` in `order_form_contracts.pdf_url` (staff contract list, `customerSignedDocUrl` download, confirmation email, quote page). It does NOT reuse `ProposalPDFv2` (a 7-page roofing marketing document). A PDF failure is noted in `finalize_error`; the sale still stands. The approval contract's own signing token expires in 10 years (the 7-day default made a late retry fail forever); the signature is stored as `typed:<name>` and `lib/contracts/generatePdf.ts` prints it as text.
- **Sale credit is confirmed when the link is SENT** (`saleCredit` in the quote-link POST, saved through `saveDealSaleCredit`; owners/admins change, anyone confirms), and `approveQuote` refuses a deal with no closer, so the sign route never credits whoever created the contract.
- **Never reopen a completed contract.** `finalizeApproval` retries a completed-but-jobless approval contract only by calling the sign route again on the same token under the approval lease (job re-checked first; no second job). TODO(fix/signing-safety): the route's idempotent finish step; until it merges that call is a no-op and the approval card shows the error. The PDF is never overwritten (`upsert:false`); customer name/address come from the snapshot. A link sent before the sale-credit rule holds the approval (friendly message + Needs-you row via `quote_links.approval_blocked_at`). Switching a job to hourly billing is refused while it has a live deposit invoice.
- **Deposit is a payment on account.** Fixed-price job: deposit invoice (kind 'deposit') + final invoice (`createFinalInvoice` = sale amount - applied deposit) = the approved total; paid-in-full reads deposit + final payment. **Open hand-off (hourly billing branch):** a job switched to time & materials counts ISSUED invoices as owed, so an issued quote-deposit invoice would be owed ON TOP of the hours. Credit it against the hours invoices (or exclude `invoice_kind = 'deposit'` from the owed total and count its payment) before hourly billing ships on a quote-approved job.
- **Unticked options:** the proposal PDF input filters with `isCountedLine` whatever the switch says (roofing has no optional lines, so unchanged). Other proposal-line readers (squares, packets) only see approved quotes, whose declined lines were removed.
- **Limits (known):** a second quote on a deal that already has a completed installation agreement is refused (the sign pipeline voids the earlier one) — start a new deal. No approved-quote PDF (the approval record holds the snapshot). The quote follow-up message has no link button (the token is stored only as a hash). Mobile cases for `/q`, the staff card and the settings card are written (`e2e/mobile.spec.ts`) but were not run in this session.
- **Migration:** `202611130070_quote_approval.sql` (additive; apply after 202611120020 and 202611110040, before the code).

## Customer File + Job Threads (Phase C, 2026-10) — rules
- Deal conversations are rows in `activities` with an `audience` (team | sales | production | crew) and `restricted_pricing`.
  **ONE read path** (`lib/threads/get-thread.ts`, rules in `lib/threads/visibility.ts`) and **ONE write path** (`lib/threads/post-message.ts`);
  RLS (`message_visible_to`, migration 202610270010) mirrors the read rule for browser clients. Any page that reads `activities` with the
  service client must pass rows through `visibleActivities` (`lib/threads/legacy-feed.ts`) — the service client skips RLS.
  Unknown roles (sub, custom-only) read nothing; setters/closers see team/sales only on deals they set/own/are the appointment closer for.
- Job notes (`production_job_notes`) are no longer written: use `writeJobNote` / `loadJobNotes` (`lib/threads/job-notes.ts`).
- The customer row is created when a deal is created (`customerIdForLead`), not at signing; signing only enriches it
  (`enrichCustomerFromContract`) and is the one moment QuickBooks hears about a customer.
- Customer File lives at `/c/[customer]/d/[deal]/[tab]`; old record URLs redirect only when env `CUSTOMER_FILE_REDIRECTS` is `all` or a role list.
- Lists use the shared DataTable (`components/ui/data-table.tsx`): filters + built-in views + saved views; big lists use server mode.

**Known Redundancy additions (2026-10-23):** (15) four routes create opportunities (`leads/[id]/opportunity`, `inspections/status`, `canvass/lead` ×2) and each must call `customerIdForLead` — one creator would be safer. (16) The inside-sales queue is still two screens (`/inside-sales` conveyor and the Opportunities tab). (17) `/api/threads/[dealId]/mentionable` resolves a viewer per user (N+1).

**Known Redundancy additions (2026-11-06):** (26) Job catch-up gets each board job's materials step by running the full Materials tab load per job (`lib/job-catch-up-db.ts`, capped at 25 jobs per board load; the rest use the recorded status), because the supplier-order answer has no batched form. Give `lib/job-materials-state.ts` a batched loader (org-level reads once) before the board grows past ~25 jobs in sold/materials/scheduled. (27) Trade slug literals still left after `org_trades`: `deriveJobSchedule` prefers the `'roofing'` crew as the job sub, the board/invite quote squares only for `'roofing'`, and supplier ordering (`lib/material-sourcing.ts`, `lib/supplier-orders.ts`) labels trades from `DEFAULT_ORG_TRADES`, not the org list — fold in with the add-ons → supplier-ordering PR.

**Known Redundancy additions (2026-11-05):** (25) `orgs.settings` has many writers that spread a stale copy (`/api/admin/settings` `type:'settings'`, `canvass_dispositions`, `inspection_outcomes`, the column fallback, `admin/data` dashboard_settings) — only brand saves merge atomically (`merge_org_brand_settings`). A save of one key can still overwrite another saved a moment earlier. Move every settings writer onto per-key SQL merges. **2026-11-06:** the ONE per-key writer now exists — `mergeOrgSettings` (`lib/org-settings.ts`, SQL `merge_org_settings(p_org_id, p_path, p_set, p_remove)`, migration 202611060010, NOT applied; read-merge-write fallback only on a missing function). Users: job catch-up (top level) and brand (`saveBrandSettings`, path `{brand}`); `merge_org_brand_settings` is dropped by 202611100010 (apply only after the code is deployed). Move the other writers onto it when touched. **Also pre-existing and still open:** the generic `type:'settings'` save on `/api/admin/settings` accepts ANY key from managers (admin / regional_manager / sales_manager) — only `brand` and the job catch-up keys are stripped. It should become an allow-list.

**Known Redundancy additions (2026-11-03):** (21) Pitch → area multiplier exists twice with different low-slope behavior: `lib/public-estimate-pitch.ts` (exact angle, keeps flat) vs `pitchRiseFromDegrees` + `slopedAreaSqft` (rounded rise; < ~2.4° → 0 → callers default 6/12). (22) `median()` is defined locally in 6 files (incl. `lib/instant-estimate-accuracy.ts`) — one `lib/stats.ts`. (23) Metre distance: `detect-roof/route.ts` and `lib/lidar/measure-near.ts` now share `distanceMetersR6371` (`roof-measure-geometry.ts`, R = 6,371,000 m, the route's original formula — thresholds unchanged); `solar-roof-mask-facets.ts` still has its own copy, and `haversineDistanceFeet` uses R = 6,371,008.8 m.

**Known Redundancy additions (2026-11-05):** (24) `escapeHtml` is defined locally in 16 files (emails, alerts, routes) — `lib/html.ts` is the one home; migrate a file onto it when you touch it (some copies also escape `'`, check before swapping).

**Known Redundancy additions (2026-11-01):** (18) Two job-packet routes (`/api/jobs/[id]/job-packet` and `/api/ops/jobs/[id]/packet`, near-identical; `GenerateJobPacketButton` tries one then the other) — only their returned `url` was moved onto `filesObjectHref` in the files-bucket signed-reads change. Fold into one. (19) ~~Public `files` URLs written / read as fallbacks.~~ **DONE 2026-11-02 (branch `fix/files-bucket-phase2-prep`).** Writers store the storage path in the same columns: `contracts/sign` (its `contracts`-bucket fallback is DELETED — it stored a public URL into a private bucket; 0 rows ever used it), `change-orders/sign|create|[id]/regenerate-pdf` (`pdf_url` = path), `proposals/[id]/image` (`cover_image_url` = path), `admin/logo` (`orgs.logo_url` AND `orgs.settings.logo_url` = `org/<org>/logo.<ext>?v=<ts>`; delete clears both). The page fallbacks to a public URL are gone (no link instead). The logo is served by the PUBLIC `GET /api/org-logo/<orgId>` (signs only `org/<orgId>/logo.<ext>` via `orgLogoPath`, 302, `public, max-age=300`); every reader uses `orgLogoHref` (Nav, admin settings, `/api/proposals/[id]` company → browser proposal PDF; the unused `/api/proposals/[id]/pdf` route was deleted 2026-11-06). Older rows still hold public URLs and resolve through `filesPathFromStoredUrl` — no data change. Guarded by `lib/__tests__/files-bucket-phase2.test.ts` (fails on any `/object/public/files/`, `from('files').getPublicUrl` or inline `from('files').createSignedUrl`). The bucket flip is `supabase/migrations/202611020010_files_bucket_private.sql` — NOT applied; read its header first. Still open after the flip: storage RLS `Users can read files in their org` lets ANY signed-in org member (field roles included) read every `org/<org>/…` object straight from the storage API with their own JWT, bypassing `/api/files/object`'s field-role rules — tighten or drop those SELECT policies once nothing reads `files` with a user-scoped client. **2026-11-10 (branch `fix/invoice-org-scope`):** traced — nothing does (browser storage calls are only `uploadToSignedUrl` into other buckets; `files` is service-client only). `202611100050_files_bucket_drop_all_storage_policies.sql` (NOT applied) drops every `storage.objects` policy whose USING/CHECK says `bucket_id = 'files'`, whatever its name — `202611020020` dropped by name and missed 045's anonymous `Public read access to proposal images` / `…org logos` and the FULL_COMBINED `… in their org storage` names. After it, only the service role reaches `files`. (20) ~~Seven inline `storage.from('files').createSignedUrl` calls.~~ **DONE 2026-11-02** — all on `signFilesObject` (same 1-hour TTL); the four API routes now wrap `requireAuthApi` → 401.

## Customer checkups + one-tap contact logging (2026-11-09, Nathan)
- **Checkups** (`job_checkups`, migration 202611100030; ONE module `lib/checkups.ts`, schedule/settings `lib/checkups-settings.ts`): after an install (`completed_at`, Eastern day; status complete/collected, never cancelled) — inspections at the org's months (default 6 and 12), then a call/text every N months (default 12). OFF per org until Settings → Customer checkups turns it on; one assignee (a user id in `orgs.settings`, never a name). Rows are created lazily, 30 days before due, by `ensureCheckups` (every org, each morning-update cron tick before any email, whether or not email is on; plus `/ops/checkups` page load); a new assignee in Settings takes over all open rows; `job_checkups` has RLS with no policies (service role only); a job brought in late gets only its newest missed checkup; a second job at the same home within 180 days rides on the first job's schedule. Never deleted — declined / couldn't reach are statuses; an inspection is only done with green/yellow/red. Shown on Jobs → Checkups, a Checkups card on the Customer File overview (job-board viewers only), and "Customer checkups due" in the owner morning email (job number + facts, no names). A booked visit is a date on the checkup, NOT a `scheduled_appointments` row (107 readers treat every appointment as sales). The clock is `completed_at`, else the scheduled install day for a job moved straight to collected (`installInstantOf`); checkups never write `completed_at` (payroll eligibility reads it).
- **Logging a contact is `postMessage` with `draft.contact = { kind, outcome }`** (`lib/customer-contact.ts` is the one kind/outcome list; stored as `activities.type` = kind + `activities.contact_outcome`). Forced to team/production audience so job catch-up's "last customer contact" sees it. The shared `components/customer/ContactActions.tsx` (Call / Text / Email / + Log contact) asks "How did it go?" after the phone/SMS/mail app opens — used on the job page customer row, the Customer File header and Checkups. Don't add another contact writer.
- **Not built yet:** yellow/red results don't create a repair opportunity (there are already four opportunity creators — Known Redundancy (15); add it through one creator). ARX Care members aren't excluded (the plan isn't in the CRM). Storm-hit calls and checkup calls can land on the same customer the same week.

**Known Redundancy additions (2026-11-10, sales tax):** (30) The estimates tool (`app/estimates`, `/api/estimates*`, `components/EstimateBuilder.tsx`, `lib/calculations.ts`, `lib/pdf/ProposalPDF.tsx`) has 0 rows in prod and duplicates proposals — deletion candidate (its tax now uses lib/sales-tax). `orgs.settings.pricing.default_tax_rate` (ARX = 7) was never read; its box is gone, the value is left in place. Percentage line items lose `price_type` on reload (not stored on `proposal_line_items`; only `unit = 'percent'` survives) — pre-existing.

**Known Redundancy additions (2026-11-09):** (28) Call-result wording exists in four places: `lib/customer-contact.ts` (the one to keep) plus the inside-sales lists (`app/inside-sales/page.tsx`, `InsideSalesFollowUpDrawer.tsx`, `lib/inside-sales-priority.ts` matching on body text). The inside-sales route also inserts its own call/text rows instead of using `postMessage`. Move both onto `postMessage` + `lib/customer-contact.ts` when touched.

**Known Redundancy additions (2026-11-10):** (29) The Google token refresh + closer-timezone lookup is hand-copied in **8 route files** (`getValidAccessToken` / `getTimezoneForUser` in `calendar/sync`, `canvass/availability`, `canvass/lead`, `canvass/team-availability`, `inspections/reschedule|schedule-close|status`, `opportunities/[id]/inside-sales-follow-up`) beside the exported `getValidAccessToken` in `lib/appointment-calendar-sync.ts`. ~45 of the org-scope baseline's findings are these copies (user_google_tokens / users / teams by a user id). Fold onto the lib one (org-scoped) — not done in the guard change because token refresh behavior differs slightly per copy.

## Properties, customer documents, custom fields (Phase 2, 2026-11-11)
- **Properties** (`properties`, migration 202611110010, NOT applied): a customer has many; `property_id` (nullable) on opportunities, production_jobs, work_orders, **documents** (the live file table — the legacy `files` table has 1 row and is not extended). "Same address" is ONE SQL rule, `property_address_key()`, unique per (org, customer). New rows get `property_id` from the BEFORE INSERT/UPDATE OF customer_id trigger `property_fill_row` (never raises; a row moved to another customer is re-homed). The app never resolves an address from `property_id` for existing flows. App writer: `lib/properties-db.ts` only; rules `lib/properties.ts`; who: `lib/customer-file/customer-access.ts` (customer-level twin of `canOpenDeal`; access notes hidden from field roles). Existing rows: `supabase/data-fixes/2026-11-11_backfill_properties.sql` (preview/apply/undo). UI shows only an "Add another property" link for a plain one-home customer (`propertiesDisplayMode`).
- **Customer documents** = `documents` rows with `job_id` NULL + `customer_id` (+ `property_id`), path `buildCustomerDocumentStoragePath`, routes `/api/customers/[id]/documents` (register / finalize / download). Upload controls use `FileDropZone` (components/ui) — drag and drop + picker.
- **Custom fields** (`custom_field_definitions` + jsonb `custom_fields` on customers / properties / production_jobs keyed by definition id; migration 202611110020, NOT applied). ONE validator `validateValuePatch` (lib/custom-fields.ts), ONE writer `saveCustomFieldValues` → SQL `set_custom_field_values` (atomic merge), ONE definitions writer `saveDefinitionChange` (owners, Settings → Custom fields). Type never changes; fields are turned off, never deleted. A value sent back unchanged is kept without re-validation; forms send only changed fields. Field roles see customer/property values only for fields with `visible_to_field` (`definitionsForViewer` / `valuesForViewer`); generic customer responses strip `custom_fields` (`withoutCustomFields`). Not in report explore yet.

**Known Redundancy additions (2026-11-11):** (30) The browser "register → uploadToSignedUrl → finalize" flow is written 4× (3 in `components/ops/JobFileWorkspaceCard.tsx`, 1 in `CustomerDocumentsCard`), and 5 components hand-roll drag/drop handlers — `FileDropZone` is the one drop area now; give the upload flow one client helper when the job Files card is next touched. (31) Two file tables: `documents` (live) and legacy `files` (1 row in prod, still written by project files / opportunity contract / change-order routes). Move those writers onto `documents`, then retire `files`.

## Service plans + visits (Phase 2, 2026-11-11)
Recurring work at one property (lawn care weekly in season; a roof & gutter care subscription with an inspector's
follow-on visit). Feature switch `servicePlans` — the first **default-OFF** switch (`defaultOn: false` in
`ORG_FEATURE_DEFS`; only an explicit `true` turns it on; any company, roofing included, may turn it on). Migration
`202611110030_service_plans.sql` (NOT applied; apply after 202611110010; DB test `supabase/tests/run-service-plans.sh`).
**Nothing about a plan is in code (Nathan, 2026-11-11: "what fits now might not later").**
- **Plan templates** (`service_plan_templates`, owners at Settings → Plan templates, `components/service-plans/ServicePlanTemplatesCard.tsx`,
  `/api/admin/service-plan-templates`): name, trade, seasons, billing basis (visit / month / year), tax flag, **price rules**
  (`pricing` = questions asked about a home + tiers with conditions on them + allow custom price — generic, no roofing
  fields) and **follow-on steps** (`steps` = label, days after, a person or a crew, result options; green / yellow / red is
  only the default, `DEFAULT_STEP_RESULTS` from `lib/health-result.ts`). `version` bumps on each save. Starters
  (`lib/service-plan-starters.ts`, prices blank) only prefill the editor or a seed file (`servicePlanTemplates` in
  `npm run seed:company`, a starter + `tierPrices` or a full template) — after that the company's row is the only source.
- **A plan copies its template at sale** (`template_id`, `template_version`, its own seasons / pricing / steps / billing / tax).
  Editing a template never changes a sold plan; an owner pushes a new version on purpose (`applyTemplateToPlans`, preview
  first; a plan whose tier no longer fits keeps its price as custom and is listed; each plan saves on its own and
  failures are listed, the rest still apply). Every plan field stays editable on the plan.
- **Rules** `lib/service-plans.ts` (client-safe, pure): seasons (`MM-DD`, may wrap the year, no overlaps) with frequencies
  (weekly / every 2 / every 4 weeks from the plan's anchor weekday / monthly = first <weekday> / none); `planVisitDates`
  deterministic for any window; only clock input is "today" in `orgs.timezone`. `resolvePlanPricing` / `tierCheck` (a tier
  only for a home inside every rule; custom only when allowed). `previewVisitEffect` = what a change would do.
- **ONE writer** `lib/service-plans-db.ts`. Visits are `work_orders` (`work_order_type='service_visit'`, `visit_step`
  'service' or a step key, `step_result`, `service_plan_id`, `service_planned_date` = slot, `scheduled_date` = where it sits,
  `trade` set so browser RLS can't write them, `job_id` NULL) — never `scheduled_appointments`. **ONE generator**
  `ensureServiceVisits`: today → 42 days, idempotent on `(org_id, service_plan_id, service_planned_date, visit_step)`;
  morning cron (switch on only), Visits loads, every plan save; auto-resumes / auto-ends plans (both in history).
  Inserts go through SQL `service_plan_add_visits` (per-plan `pg_advisory_xact_lock`, refuses with -1 if the plan changed
  since it was read) — a board load racing a save can't re-add a removed visit.
- **Edits: preview, then save** (`updateServicePlan` with `preview: true` writes nothing and returns changed fields + visits
  removed / added / updated). Only UNSTARTED FUTURE service visits change; done / skipped / cancelled and anything today or
  earlier never do; a crew picked by hand stays; a trade change refreshes them. The save is ONE transaction, SQL
  `service_plan_save` (same lock; `updated_at` = `clock_timestamp()` is the version, stale → 40001): plan patch + visits
  removed (cancelled if they have a photo) + refreshed + charges. Seasons are sorted before compare; a true no-op is
  "Nothing changed". **History**: `service_plan_changes` (same `{field,label,old,new}` shape as
  `supplier_audit_log`; `lib/change-log.ts` is the one `FieldChange`/`describeChange`/`diffFields`), with `visit_effect`;
  plan History button, template "Plans & history".
- **Statuses** scheduled → completed | skipped (`skip_reason`) | cancelled. A step visit with result options is done only with
  one of the plan's options; done starts the plan's NEXT step (`followUpVisitFields`, chained).
- **Bulk shift** (`bulkShiftVisits`): a day range, all / one crew / unassigned, ±1–30 days; slots kept.
- **"New price starts on"** (plan edit + template push): `previous_price` + `price_starts_on` on the plan; a slot before
  that day keeps the old price (`planPriceOn` / `visitPrice(plan, slotDay)` — the ONE price rule for charges, generator,
  refresh and preview). No date = the new price from the next visit (schedule cleared).
- **Desire paths (2026-11-11):** ONE plan form `components/service-plans/PlanForm.tsx` (Customer File card and "New
  customer + plan"): a new plan from a plan type shows plan type / starts / crew (+ price if it needs an answer) and one
  summary line with "Change". "New customer + plan" (`NewCustomerPlan.tsx`, `POST /api/service-plans` →
  `createCustomerWithPlan`: `upsertCustomer` matching rule, property, plan; plan checked before anyone is created) on the
  Visits board and the customers list. Editor options come from ONE loader (`lib/service-plans-options.ts`). Rain day:
  From/Through default tomorrow, Next day / Day after / Pick a day. Crew page: one tap on a skip reason skips, with a
  6-second Undo (sent at once if the page is hidden); Done offers "Add a photo?". Crew links: Copy + Text (crew phone).
- **Screens:** Customer File → Service plans card (start from a template; edit everything; preview; history); Jobs → Schedule →
  **Visits** tab (paged 300 at a time with a total and "Load more"; photo/charge lookups in chunks of 200 ids); crew phone page `/crew/day/<token>` (token in service-role `crew_day_links`, one per crew, **expires after 30
  days** or when replaced or the switch is off; the open page re-checks `/api/crew/day/<token>/status` on focus / return / every
  5 min and wipes addresses and gate codes when dead; gate codes only on visits still to do). Today + morning email
  "Today's visits" / "Visits skipped this week" when on.
- **Access** `lib/service-plans-access.ts`: view = job board; edit = `jobs:edit`; prices = edit or job financials; templates = owners.
- **Visit photos**: `photos` with `job_id` NULL + `work_order_id`, via `registerVisitPhotoUpload` / `finalizeVisitPhotoUpload`.
- **Visit prices are not on `work_orders`** (field/sub roles read that table): `service_visit_charges` (price + taxable
  snapshot per visit, RLS on, no policies, no grants — service role only). Invoicing reads them through
  `loadCompletedServiceVisits` (see "Invoicing recurring service").
- **Work order numbers** come from `work_order_number_counters` (per company, seeded once from the highest `WO-n`; no
  table scan); `WO-00001`…`WO-99999`, then `WO-100000` (widened, never truncated).
- **Readers that must not count visits** exclude `work_order_type = SERVICE_VISIT_TYPE` (Today crews, ops dashboard open WOs,
  sub portal list + complete). `/work-orders` already lists `trade IS NULL` only.

**Known Redundancy additions (2026-11-11, service plans):** (32) "The migration isn't applied yet" is detected four ways
(`isPropertiesNotReadyError`, `isMissingTableError` in org-trades, `isServicePlansNotReadyError`, and `isMissingColumn` on
the company-links branch) — one helper in `lib/supabase/errors.ts`. (33) **Customer checkups should become one kind of
service plan** (Nathan, 2026-11-11): `job_checkups` (month offsets after an install) and service-plan inspection visits
now share the result vocabulary (`lib/health-result.ts`) and the lazy-generator pattern; folding needs a frequency
"every N months from an anchor date" and a `production_job_id` anchor on the plan. Do not migrate checkups until then.
(34) Browser register → upload → finalize is now 5 copies (KR #30 + `lib/visit-photo-upload.ts`, which at least reuses
`UploadSteps`); crew visit uploads are not on the offline queue yet (`lib/job-photo-queue.ts` keys by job).
(35) The two service-plan RPCs are mirrored in JS for jest (`lib/test-helpers/fake-service-plan-rpc.ts`) — like KR #15's
payroll mirror, a rule changed in the SQL must change there too; `supabase/tests/service_plans.test.sql` runs the real SQL.

## Crew time clock (stages 1–2, 2026-11-11)
Switch `timeTracking` (`ORG_FEATURE_DEFS`, **default OFF**; ARX unchanged). Migration `202611110070_time_tracking.sql`
(NOT applied; apply before the code). Rules `lib/time-tracking.ts` (pure, client-safe); **ONE writer** `lib/time-tracking-db.ts`
(time_entries, crew_members, time_entry_changes — all service-role only, RLS on, no policies); doors `lib/time-tracking-access.ts`.
- **Who clocks:** a crew is a `sub_contractors` row with `tracks_time = true` and `crew_members (sub_id, user_id, is_lead)`
  (employees are `users`; their pay rate is their comp plan's hourly rate). Subs (`tracks_time` false) never see a clock.
  The old `crews` table is NOT used (Known Redundancy 36). Set on Settings → Subcontractors → a crew → "Our own crew".
- **Taps** (`applyClockTap`): crew phone link `/crew/day/<token>` (POST/GET `/api/crew/day/<token>/clock`; that crew's
  members only) and the job page card (`/api/time/clock`; yourself + crews you lead). Clock in crew here (everyone ticked,
  untick absent) → tapping another stop = "Move crew here?" (closes the old entry, opens the new) → Lunch pauses (a break
  entry; never auto-deducted) → Done asks "Clock out crew?" (Yes = done for the day; No = driving to the next stop: the
  gap until the next clock-in the same local day is PAID travel, payroll only, not job cost) → machines (`kind equipment`,
  price-book items with unit `hour` — empty until migration 202611100090) stop when the crew moves / leaves.
  Phone outbox `lib/time-clock-queue.ts` (Zustand persist, in order, `tapId` makes a resend a no-op); phone time is used,
  corrected and flagged when the phone clock is > 5 min off; taps > 7 days old refused. One open work + one open break
  per person (partial unique indexes). Location only at the tap and only with `settings.timeTracking.captureLocation`.
- **Forgot to clock out:** `autoCloseForgotten` (crew page / job card / office list load + morning cron, switch on) stops a
  clock older than `autoCloseHours` (default 12) at the person's last tap, `end_source auto_closed`, flagged; the lead is
  asked "What time did … finish?" next morning (`finish_answer`, logged).
- **Office:** Settings → Time clock / Money → Time (`/admin/time`, payroll admins): one pay week, needs-a-look first, paid
  total vs what payroll has, warnings (no break after N h, long day, overtime — warnings only), add / edit / remove with a
  reason (`time_entry_changes`, `lib/change-log.ts` shape; removed rows kept). A week that is approved (or being approved,
  `periodIsEditable`) refuses office edits; a late tap for it is kept and flagged, never fed. The lock is app-level only.
- **Feeds** (`syncTimeFeeds`, after every write): payroll hours per person per pay week through `saveHoursEntries`
  (exact seconds/3600 — the column stores 2 dp; regular up to `overtimeAfterHours` (40), rest overtime; reason
  'Time clock'). **While the switch is on, a person with clock time that week gets their hours from the clock** — fixes
  go in the time list, not the hours box. Job labor: ONE `job_cost_lines` row per job per pay week (`source
  'time_entries'`, `time_week_ending`), straight-time rate × work time (breaks and drive time out); people without a rate
  are named in the line; the cost-lines PATCH/DELETE refuse that line (409). Visits without a job are skipped
  (service visit billing comes with the invoicing branch). **The pay week is the company's own** (`orgs.settings.payWeek`,
  lib/payroll-week-schedule.ts, read in `loadClockConfig` as `payWeek`): an instant goes to `clockWeekCutoff` = the
  schedule's cutoff (`weekCutoffContaining`) unless a week already stored closes between the instant and it (an old-weekday
  week right after the owner changed the pay week), and a week starts after `clockWeekPrevCutoff` (the stored week before
  it when 1–13 days back — payroll's `weekDays` rule — else one schedule week). Weeks are found/made only with
  `findWeekNear` / `findOrCreateWeek`. Days for travel / warnings use `orgs.timezone`.
- `time_entries.user_id` is ON DELETE RESTRICT: a person with clock time is deactivated, not deleted (users DELETE → 409).
- **Review fixes (2026-11-11):** (1) every tap first runs the forgot-to-clock-out check AT THE TAP'S TIME (a Monday clock
  still open when Tuesday's tap arrives stops at Monday's last tap, flagged; a shift with no other tap says "pays 0 h until a
  finish time is given"). (2) **Typed vs clocked hours:** `payroll_rep_hours.hours_source` ('typed'|'clock') +
  `typed_regular_hours/typed_overtime_hours`; ONE rule `planHoursWrite` (lib/payroll-hours.ts): clock wins while there is
  clock time, typed is kept aside and comes back if the clock time is removed, the clock never writes 0 over typed, a typed
  save never replaces clock hours (Pay this week returns a `warning`); the Time page shows "Typed X vs clocked Y". (3) Signed-in
  clocking: only members of a time-tracked crew, or roles the owner ticks (`settings.timeTracking.selfClockRoles`); field
  roles never. (4) Every people action names `userIds` (empty → 400); clock-out re-reads who is clocked in first
  (`latestOpen`). (5) "N shifts need a finish time" (`loadOpenShiftsQueue`) leads Today (payroll admins) and the morning
  email. (6) A typed labor line on the same job/week: the clock line says CHECK; adding one returns a `warning`. (7) Office
  add/edit and finish answers refuse overlapping time (`overlapRefusal`). (8) Payroll recompute holds a per-person lease
  (`time_feed_try_lock` / `time_feed_unlock`). (9) Time recorded after its week's approval began (`ended_recorded_at` >
  `lock_claimed_at ?? locked_at`) is carried into the next open week, split at the cutoff. (10) The outbox queues the tap
  first; a tap waiting for its location holds its place (≤ 5 s).

**Known Redundancy additions (2026-11-11, time clock):** (36) The old `crews` table (`20260213_operations_tables.sql`,
`members uuid[]`, `/admin/crews`, `app/api/admin/crews`, read by `/ops/schedule` and `/ops/dashboard`) is a deletion
candidate: crews are `sub_contractors` (+ `crew_members` for in-house time-tracked crews). Don't add readers. (37) ~~"The payroll
period for this cutoff (±36 h)" written 4×~~ **DONE at the integration merge (2026-11-11):** `findWeekNear` (same calendar
date in the company zone) / `findOrCreateWeek` (`lib/payroll-periods.ts`) are the only week lookups — pay week, next week,
fixes and the time clock; `findPeriodForCutoff` deleted. `periodIsEditable` lives in `lib/payroll-periods.ts`. (32, recount) "migration not applied" checks: +1
(`isTimeTrackingNotReadyError`, built on `lib/supabase/errors.ts`).

## Gross revenue report (2026-11-13) — dataset `revenue`, view `rpt_revenue`
Migration `202611230010_rpt_revenue.sql` (NOT applied; after 202611220010; DB test `supabase/tests/run-revenue-report.sh`, also run by `lib/__tests__/revenue-report.test.ts` when `ALLOW_SCHEMA_RESET=1` + `PGHOST` are set). Templates **Revenue by month** (billed + collected, jobs and service split out) and **Revenue by service**; both `reports:financials` only (dataset `financeOnly`). Lawn / exterior-cleaning starter lists include them; the Reports home shows the month tile.
- **ONE definition of the numbers = the SQL view.** One row per revenue event; columns `billed` / `collected` (+ jobs / service splits). **No dollar is counted twice:** a JOB is billed once by its contract (`sale_amount` on `sale_date`, cancelled = 0); its own deposit / final invoices bill the same dollars and add nothing, except the sales tax an issued invoice adds on top (own `Sales tax` row) — and a job billed by its invoices — time & materials (`billing_mode`) OR no contract price (`sale_amount` null / 0, not cancelled) — bills its issued invoices (amount before tax + its own `Sales tax` row). The migration also REPLACES `rpt_jobs` (same columns, same order; only `balance_due` changes: a no-price job now owes its issued invoices instead of 0 — ARX has 0 such jobs of 45, verified read-only 2026-11-13). Same rule in both views (parity-tested). `lib/job-collection.ts` (TS) is not changed and still treats a no-price job as owing nothing — align it when decided. Fallback dates (no sale date / no issue date) use the company's day (`arx_private.org_date`). SERVICE = issued invoices with NO job (`job_id IS NULL`, same rule as `rpt_invoices`), line by line + tax; draft and void bill nothing. COLLECTED = the one `job_payments` ledger (pending excluded, refunds = negative rows in the month they happened); `invoice_payments` is never read.
- Not collected here: `paid_outside_cents` (paid before a Jobber import — no date exists). Billed includes sales tax (like `sale_amount` and payments do); it shows as its own `Sales tax` service line. Revenue by service groups by plan-template name (else plan name, else "Hourly (time & materials)" / "One-off / other"); invoice lines carry NO price-book item id today. Existing views / templates / ARX numbers are untouched.
- Engine: `ReportSpec.alsoSum` (sum metrics only) totals more columns beside the main one; result columns `sum_<column>`; checked by `checkAccess` / `specTouchesFinancials` like the main column.
- **Known Redundancy (42): two "collected by month" answers.** `payments-by-month` (`rpt_payments`) counts pending payments; `Revenue by month` / `rpt_revenue.collected` excludes them (the `rpt_jobs.collected` / paid-in-full rule). Same month can differ by the pending amount. Move `payments-by-month` onto `rpt_revenue` (or retire it) when ARX agrees.
- **Known Redundancy (41):** the job-billed rule is written in `rpt_jobs.balance_due` AND `rpt_revenue` (SQL can't share a lateral between views); `revenue-report.test.ts` fails if they drift. Give `rpt_jobs` a `billed` column when it is next replaced, and read it from `rpt_revenue`.

## Customer portal (2026-11-12)
Switch `customerPortal` (`ORG_FEATURE_DEFS`, **default OFF**; lawn_landscape + home_builder profiles ON; ARX unchanged). Migration
`202611120060_customer_portal.sql` (NOT applied; after 202611100040 + 202611120020). Lives only on a company's own address
(`<company>.<base>/portal`; `portalOrgForRequest` = host fence `org`, anything else 404). Customers are NOT users: no second auth
system — a portal session is a row (`portal_sessions`) tied to ONE customer of ONE company.
- **Sign-in:** the customer types email or phone → `requestLoginLink` emails a one-time link to the address ALREADY ON FILE (never to
  the typed one); the answer + timing are the same for a match or a stranger. The link opens `/portal/enter` which does NOT use the
  link — only the "Open my account" POST (`/api/portal/enter`) does (mail scanners can't burn it). Tokens: 256-bit, only SHA-256 stored,
  link 20 min single-use (SQL `portal_consume_login_token`), session 14 days, cookie `portal_session` host-only httpOnly (never `Domain`).
  A link made for another company's address is refused and not burned. ONE door: `getPortalSession` (`lib/portal/server.ts`):
  checks host company, switch, customer still exists.
- **Only the emailed sign-in link makes a session.** Pay, signing and report links are all forwardable, so none of them opens the portal
  (a pay / signing link reaches only its own record on its own page; there is no `/api/portal/open`). A session also ends when the customer's
  email on file changes (`portal_sessions.email_key` is compared on every read; a link mailed to the old address is dead too) and by
  staff "Sign out of portal" on the Customer File (`revokeCustomerPortalAccess`, `POST /api/customers/[id]/portal-signout`, owners / managers / ops).
  Cookie is `__Host-portal_session` in production.
- **Everything a customer sees comes from `lib/portal/data.ts`**: every query `orgDb` + the customer id (or ids loaded for that customer in
  the same function), columns named (no `*`, never notes / costs / access notes / crew / pricing rules), view types only.
  Every id from a request (invoice, document, photo) goes through `findPortalInvoice` / `findPortalFile`. Break-in suite sweeps the
  routes; `lib/__tests__/customer-portal.test.ts` proves customer A2 can't reach A1 (same company) or B1 (another company).
- **No new money path:** Pay = `POST /api/portal/invoices/<id>/pay` hands back a normal `/pay/<token>` link (`createPaymentLink`) and the
  existing Stripe checkout does the rest. Card: autopay OFF / remove / "add a card" (the existing save-card page — turning ON needs the
  customer's consent there). Contracts: signing = the existing `/contracts/sign/<token>` page; signed copy = `/api/files/signed/contract/<token>`.
- **Sharing is opt-in, documents only:** `documents.shared_with_customer` (default false), ONE writer `setSharedWithCustomer`
  (`lib/portal/sharing.ts`, `PATCH /api/portal-sharing`); "Show to customer" is on Customer documents and on each job Files row (owner / job
  board only). **Photos have no switch:** ONE rule, `lib/customer-visit-photos.ts` — a customer sees pictures from their OWN service visits
  (`customerVisitIds`); the `/m/<token>` "done" page (`messagePhotos`) and the portal both call it. Job photos are never shown.
- **Messages are the thread, not a second store.** The customer's message = `postCustomerMessage` (`lib/threads/post-message.ts`): an
  `activities` row, `origin 'customer_portal'`, audience `team`, type `text` (job catch-up reads it as the customer's contact). Staff reply
  with the new audience **`customer`** ("To customer" on the thread composer; non-field roles only; reads like `team` for staff in
  `visibility.ts` and SQL `message_visible_to`); the thread route then emails it via `sendCustomerReply` (company From; skipped for
  opted-out / suppressed addresses; the portal shows it either way). The portal reads ONLY its own customer's rows with audience `customer` or
  origin `customer_portal`, through the allow-list reader `lib/threads/portal-thread.ts` — never the staff visibility rules. The company is
  also emailed on a new customer message.
- **Limits (shared SQL counters `portal_take_attempt`, fail closed):** link requests 10 / 15 min per address, 3 / hour per identifier,
  5 / hour per customer; 30 sign-in taps / 15 min per address; 600 requests / 10 min per session; 10 messages / hour; pay links 20 / hour.
  **Audit:** `portal_login_events` (requested, sent, no match, blocked, login, failed, logout, staff sign-out) — only hashed address
  keys, never a token or raw email.
- **Roofing / job-based customers (2026-11-15; migration `202611150010`, NOT applied).** ROOFING STAYS OFF: `customerPortal` is still off for the roofing profile; the owner switches it on and ARX pilots with a handful. **Invite only** (`orgs.settings.customerPortal.inviteOnly`, default ON for the roofing profile, OFF for lawn/builder; owners edit it at Settings → Customer portal, `/admin/customer-portal`): only customers with `customers.portal_invited_at` get a sign-in link (an uninvited one looks like a stranger) or keep a session (`getPortalSession` re-checks, fails closed). Staff: Customer File → "Invite to portal" (`POST /api/customers/[id]/portal-invite` → `lib/portal/invite.ts`; emails the same one-time link to the address on file, 3 / hour per customer) and "Remove access" (`DELETE`: invitation + sessions + links).
  - **Job progress card** (`lib/portal/job-stages.ts` pure + `lib/portal/job-progress.ts`): Signed → Materials ordered → `<install> scheduled` → `<installed>` → Complete. NO status column: it reads `production_jobs.status`, the materials answer (`loadJobMaterialsState`, supplier orders), the trades' booked days (`syncJobScheduleFromTrades` already wrote the job's schedule; trades come from `work_orders`) and `evaluateJobCollection` (paid in full). Words: `install` / `installed` terms of the industry profile (same as the Customer File stepper). Cancelled **and** on-hold jobs show only the address and "Questions about this project? Contact us" — never a status word or a reason. The old "install visits" rows in Upcoming visits were deleted (the card owns install days).
  - **Install dates:** one line per active trade (`tradeLabel`), "Week of <Monday>" until within `exactDateDays` (company setting, default 3, 0–14), then the exact day; computed on every load so an ops reschedule shows itself; a past day shows nothing.
  - **Job photos hidden by default** (`lib/customer-visit-photos.ts` `loadCustomerJobPhotos`, the one rule for list and download): a photo shows only when staff ticked it (`photos.shared_with_customer`) or the job's "Show crew photos to customer" is on (`production_jobs.portal_show_crew_photos`, one tap on Final Photos) AND it is one of the four walk-around angles on a trade. Staff switches: `PATCH /api/portal-sharing` `{photoId,shared}` / `{jobId,crewPhotos}` (owner / job board).
  - **Paperwork:** signed contract (existing), signed change orders (`/api/files/signed/change-order/<token>`), inspection reports with status `sent` (`/r/<token>`), documents only when ticked. Insurance / claim documents are ordinary documents: hidden until individually shared. Money: balance from `evaluateJobCollection`; financed jobs show "Financed through <lender>" (the signed contract's `finance_company` on this customer's own deal) and NO balance or loan terms; pay = the existing invoice Pay button (only when the job has an open invoice). Never selected: costs, commission, dealer fee, internal notes, crew names, access notes.
  - **Checkups card:** open `job_checkups` (due / booked) as "Checkup" / "Check-in call" with the month or the booked day — no result, notes or assignee. An ARX Care plan is a normal service plan (existing "Your service plan" card).
- **Pre-launch, texting (counsel):** quote follow-up texts count as marketing (written consent needed); the website checkbox wording `v1-2026-11` (`lib/sms/consent-text.ts`) needs counsel review before any company turns `texting` on.
- **Pre-launch (not blocking the prototype):** SMS sign-in (email only now), a staff view of `portal_login_events`, change-order signing
  inside the portal.

## Move signed documents (2026-11-11)
Settings → Move signed documents (`/admin/import/signed-documents`, owners only). `lib/signed-import/*`, routes under
`/api/admin/import/signed-docs`, migration `202611190010` (NOT applied). Docs: `docs/signed-documents-import.md`.
- **Reuses the Jobber import's tables, run helpers and matcher** (`import_runs.source = 'signed_docs'`; `matchExistingCustomer`,
  `matchFileNames`). Never a second matcher; customers are never created. Jobber's `listRuns/loadRun/openRun/startUndo` take a source.
- **ZIPs open in the browser** (fflate streaming, real byte counts, never trust headers); PDFs go straight to storage; the server re-hashes.
- **An imported document is read-only and never re-rendered.** `documents.sha256 / import_source / import_envelope_id` are
  immutable (trigger); duplicates are skipped by (org, sha256). Unmatched = `customer_id NULL` (the "Waiting for a customer" list).
- Known Redundancy (29): customer rows are loaded for matching in `lib/signed-import/db.ts` beside the Jobber loaders
  (`loadCustomerNames`); one loader when either is next touched.

## Move from Jobber (2026-11-12)
Settings → Move from Jobber (`/admin/import/jobber`, owners only, `lib/jobber-import/access.ts`). Full write-up with Jobber
citations: `docs/jobber-import.md`. Migration `202611120040_jobber_import.sql` (NOT applied; after 0010/0020/0030/0060).
- **Pure:** `columns.ts` (file kinds, header aliases, mapping screen choices — add a new Jobber spelling there), `values.ts`
  (money, dates in the account's day/month order, line items "(qty, $total)", J-ID), `schedule.ts` (recurring job →
  seasons from Visits), `plan.ts` (the Check: items + counts + duplicates + problems per row), `files-match.ts`.
  **Server:** `db.ts` only (runs, files, check, `importBatch`, `undoBatch`, `recordDocuments`, `loadJobberHistory`).
- **Writers it uses (no second writer):** plans `createImportedServicePlan` (service-plans-db: PAUSED, no visits, or ended),
  properties `insertImportedProperty` (properties-db), invoices `insertImportedInvoice` (lib/invoices.ts), custom fields
  `saveDefinitionChange`, customer identity `matchExistingCustomer` (lib/customers.ts — the same rule as
  `findExistingCustomer`; change both together), files `uploadCustomerDocument` (lib/customer-document-upload.ts, now also
  the Documents card's upload).
- **Rows keep Jobber's id** (`import_source='jobber'`, `import_source_id`, unique per company) on customers, properties,
  service_plans, job_invoices, pricebook_items, custom_field_definitions. Re-runs update only rows still equal to what the
  last import wrote; linked customers of yours only get blanks filled.
- **No payment is ever made up.** Imported invoices carry Jobber's status/balance; money paid in Jobber =
  `job_invoices.paid_outside_cents` (imported rows only, CHECK). Every balance = total − payments − paid_outside:
  `invoicePaidCents` (lib/invoice-lines.ts) in `computeInvoiceBalance`, `getInvoiceWithDetails`, the invoice document and
  the Customer File invoices card; SQL `record_customer_invoice_payment` + `job_invoices_void_guard` (+ `voidInvoice`).
  New balance readers must use `invoicePaidCents`.
- **Undo** = SQL `import_undo_row` / `import_revert_row` (row still holds what was written, and no foreign key points at it —
  read from the catalog); newest import only. Quotes / one-off jobs are history on the run (`kind 'history'`), shown on the
  customer page "From Jobber" card (owners / managers / ops, never pricing-barred or field roles).

## Hourly billing — time & materials (2026-11-12)
Switch `hourlyBilling` (`ORG_FEATURE_DEFS`, **default OFF**; lawn_landscape profile ON; ARX unchanged). Migration
`202611120030_hourly_billing.sql` (NOT applied; after 202611110060; DB test `supabase/tests/run-hourly-billing.sh`). Rules
`lib/hourly-billing.ts` (pure, client-safe); DB + **ONE writer** `lib/hourly-billing-db.ts` → SQL `approve_billed_time`;
doors `lib/hourly-billing-access.ts` (bill = money:record; job setup = `jobs:edit`; rules = owners).
- **What is billed by the hour:** a job with `production_jobs.billing_mode = 'time_materials'` (+ `estimated_hours`, labor rate =
  `hourly_rate_item_id`, a price-book item with unit `hour`) — set on the job page "Billing" card (`JobHourlyCard`; "By the
  hour" prefills the estimate + rate from the job's quote hour lines, `is_labor` items first) — or a visit of a plan billed
  `per_hour` (plan price = the hourly labor rate as of the visit's day, `planPriceOn`; Ready to bill lists it as "billed by the
  hour"). "Per hour" is offered / accepted only while the switch is on (`billingBasisChoices`, `hourlyBasisRefusal`).
- **Rules** `orgs.settings.hourlyBilling` (owners, Settings → Hourly billing, `/api/admin/hourly-billing`, mergeOrgSettings path
  ['hourlyBilling']; top-level writes refused, the generic settings save strips it): rounding none | up15 | nearest15 (per
  person, or once for the crew, once per machine); minimum hours per visit (labor total and each machine; never invents labor);
  drive time no | yes (own "Travel time" line at the labor rate, the gap before arriving, `closed_for_travel`) | trip_charge (a
  price-book item, once per day billed); basis person-hours | crew-hours (union of the crew's time); machine hours = the
  operator's hours at that stop (`equipmentFromOperator`, default on) or the machine's own on/off.
- **Day** = one job / visit on the local day a stretch STARTED (`orgs.timezone`, DST-safe): a shift past midnight is one
  billing day (rounding / minimum once); all of a visit's time sits on its first day. Read from `time_entries`
  (removed rows out, each person's breaks out); a running clock = "Still clocked in" (approve only by typing, with a reason).
- **Hours to bill** (Jobs → Schedule → Hours to bill, `components/billing/HoursToBill.tsx`, `/api/ops/hours-to-bill`): per
  customer card, days with what they bill + why (`reasons`), one button "Bill N days · $X" = ONE new draft invoice: a JOB
  invoice for a job (send it from the job), the customer's invoice without a job for a visit (optional email). Tap a day to change
  hours (reason required → `source 'edited'`) or type hours when nobody clocked (`'typed'`, marked on screen). Prices are
  never taken from the browser. Tax: `computeCustomerSalesTax` (the one rule), lines taxable by their price-book item / plan.
- **Idempotent:** `billed_time_days` — at most ONE approved row per job/visit per day (partial unique indexes + checks under
  the same per-company lock as `create_service_invoice`). A visit's lines carry `work_order_id`, so Ready to bill and Hours to
  bill refuse each other's visits. Un-approve (`unapprove_billed_time`) only once its invoice is void, with a reason; history kept.
- **Payroll is never touched:** nothing here writes `time_entries`, `payroll_rep_hours` or `job_cost_lines` (test-locked);
  rounding happens on invoice copies only.
- **Money on a T&M job (coordinator decision 2026-11-12):** paid in full = payments vs the total ISSUED (sent / paid — never
  drafts or void), tax included (`evaluateJobCollection({ timeAndMaterialsInvoicedCents, timeAndMaterialsPending })`; nothing
  invoiced = not paid; a draft invoice or clocked days not approved = "still being billed", never paid, payroll waits) and
  commission base = issued minus tax (`invoicedPreTaxCents`, the one rule, lib/job-invoice-tax.ts) (`syncJobSaleAndCommissionBase` T&M branch; sale amount stays the signed estimate). ONE loader for both:
  `loadJobInvoiceFacts` + `collectionInvoiceFields` (lib/job-invoice-tax.ts; replaced `loadInvoiceTaxCentsByJob`); the guard
  test fails on any `evaluateJobCollection` call without the T&M input. Base re-synced after hours are approved, a job
  invoice is changed / voided / copied / made, and the billing mode changes (`syncTimeAndMaterialsCommissionBase` — no-op for
  fixed-price jobs). Fixed-price jobs (ARX): unchanged. **Paid before more hours were billed (or an invoice voided):** the
  paid week never changes — `syncCommissionChangesForJob` (lib/payroll-commission-change.ts) puts one signed
  `payroll_adjustments` line per paid person (kind `commission_change`, `base_delta`, the math in `reason`) on the next open
  week = change in the PAID-FOR base (issued pre-tax × share of it collected; billed-but-unpaid counts only once paid; a
  void / refund claws back) × that person's PERCENT rate only (`percentRateOfLine`: flat Change-sheet dollars, flat-rate plans
  and volume bonuses never scale; unknown snapshot shape = 0); negatives carry forward like any fix. Writer SQL
  `payroll_add_commission_changes` (per-job lock, refuses a stale "base covered so far" → recompute). Refused during an
  approval (55006) → job marked `commission_change_wait 'approval_running'`, retried by the morning cron and Pay this week;
  pay-week flag off → `'pay_week_off'`, no line, owners see "N commission changes waiting" (Today + morning email;
  docs/payroll-cutover.md step 8). Profit tracker labels T&M revenue "billed so far". Once a job is paid its
  billing mode can't switch. Profit tracker: T&M revenue = issued pre-tax, "Not billed yet" when nothing is issued, status
  from the one paid-in-full rule (fixed-price jobs now also get its $0.05 tolerance there).
- **Guards:** a T&M job gets no deposit / final / "job total" invoice (custom amounts for extras, not capped by the estimate);
  no hand-typed hour lines on its invoices; an invoice carrying approved hours can't be copied; back to "as sold" is refused
  while billed hours sit on a live invoice. Line amounts everywhere = `lineTotalCents` (lib/invoice-lines.ts, integer math =
  Postgres `round(qty * cents)`). Machine hours = union of time (two operators on one tractor bill it once); a visit past
  midnight keeps all its time on its first day. Job card rates need money:record or `reports:financials`.
- **Not built:** per-plan estimated hours. The office biller needs job-board access to open Jobs → Schedule (as Ready to bill).

**Known Redundancy additions (2026-11-12, hourly billing):** (38) `approve_billed_time` / `unapprove_billed_time` are mirrored
in JS inside `lib/__tests__/hourly-billing-db.test.ts` (KR #35 pattern) — a SQL rule change must change there too; the real SQL
runs in `supabase/tests/hourly_billing.test.sql`. (39) `addDaysYmd` exists in both `lib/service-plans.ts` and
`lib/payroll-week-schedule.ts` (pre-existing; this change imports the service-plans one).

## Signing safety — contracts + change orders (2026-11-11, PR0)
- **One winner per signature.** `/api/contracts/sign` and `/api/change-orders/sign` save the signature with ONE conditional update (`status = 'pending_customer'` and an unexpired link); a second tap / tab gets `{ success, alreadySigned }` (200), never a second PDF, email, supersede pass or money sync. The server re-checks what the page checks (`lib/signing-input.ts`: PNG signature ≤ 400k chars, name ≤ 200, required initials by agreement type + payment method, preferred contact). There is no consent checkbox on the page, so none is enforced; "consent" = the initialed terms + the Sign action.
- **A signature is never lost to a failure after it (ONE recovery path).** The signature row is saved first (status `completed`, never reopened). Everything after it — sale notice, voiding the superseded contract, PDF, project/job + won status, commission base sync, signed-note activity, customer email — runs in `finishSignedContract` (`app/api/contracts/sign/route.ts`), which records each finished step in `order_form_contracts.signing_steps` (a step is marked ONLY when it truly succeeded — void older: no error; project: a project AND a production job exist; customer sync once, because re-enriching re-queues the QuickBooks `customer.upserted` event; every step re-checks the recorded steps before running and recording one renews the lease) and sets `signing_finalized_at` when all are done. If the request dies mid-way, the next call on the same link (`alreadySignedResponse`) takes a 2-minute lease (`signing_finalize_lease_at`, so a double tap cannot run it twice) and runs ONLY the steps still missing; the project/job and void steps are themselves idempotent (existing rows are updated, never duplicated). **Any new post-signing side effect is a new named step in `finishSignedContract`, never inline in POST. Quote approval (`lib/quotes/approve.ts`) uses exactly this path: for a completed approval contract with no job it calls the sign route with the contract's own token and the route finishes what is missing (a contract with `quote_approval_id` takes a typed signature, no initials, makes no roofing PDF and sends no contract email). Nothing may "reopen and re-sign": a completed contract never leaves `completed`.** The PDF comes from `ensureContractPdf` (`lib/contracts/finalize-pdf.ts`, written only while `pdf_url` is empty, never replaces one); the office's **Generate PDF** (`POST /api/contracts/[id]/regenerate-pdf`) fills a missing one. Change orders keep their own `regenerate-pdf` (also fill-only: refuses when a PDF is stored).
- **Tokens (new links): `lib/signing-tokens.ts`.** A new contract / CO token is stored as `signing_token_hash` (SHA-256, what a link is looked up by) + `signing_token_enc` (AES-256-GCM, key from `SIGNING_TOKEN_SECRET` → `CUSTOMER_MESSAGE_LINK_SECRET` → service key; only so "Copy link" works — `GET /api/signing-link/[kind]/[id]`). `signing_token` is left null. Rows from before still hold the plaintext token and `findBySigningToken` still accepts it (no sent link breaks). **Always look a token up through `findBySigningToken` / `findBySigningTokenOnThisHost`, never `.eq('signing_token', …)` (test-enforced); build links with `signingTokenOf(row)`.** If the service key rotates, existing encrypted copies stop opening (Copy link 404s; the sent links still work by hash).
- **Host fence:** contract + CO sign pages/routes and the signed-copy download resolve the document through `findBySigningTokenOnThisHost` (`lib/signing-fence.ts`, `fenceAllowsOrg` like `/pay`): a token opened on another company's address (or the apex) is "not found". Routing off / legacy hosts stay open.
- **Change orders:** capture IP + user agent (`customer_ip`, `customer_user_agent`; contracts also keep `customer_user_agent`); a pending link with no expiry is treated as expired (DB CHECK for new writes); signing is refused (409) when the job is `cancelled`.
- **ONE signature pad:** `components/contracts/SignaturePad.tsx` (controlled with `onChange`, or posted by a plain form with `name`). The old `components/SignaturePad.tsx` (typed/draw, legacy flow F pages) and the unused `SignaturePadInline` are deleted; legacy flow F is still a deletion candidate.
- **Migrations (NOT applied, apply BEFORE the code):** `202611160010` (drops migration 064's anon `USING (true)` policies on `order_form_contracts`; prod already closed), `202611160020` (evidence + token-hash columns, contracts' `signing_token` loses NOT NULL/default), `202611160030` (`signing_steps` / `signing_finalized_at` / `signing_finalize_lease_at`, columns only; the idempotent backfill `supabase/data-fixes/2026-11-11_signing_recovery_backfill.sql` marks already-completed contracts finalized so nothing is re-sent — run it after 0030 and again right after the deploy). Order: 0010, 0020, 0030, backfill, then the code, then the backfill again.
- **Pre-launch (not built):** a consumer e-sign consent step (ESIGN/UETA disclosure + explicit "I agree to sign electronically" before the signature pad, stored with the signature) — counsel to confirm wording before other companies' homeowners sign.

## Project tools (2026-11-12) — feature `projectTools` (default OFF; home_builder profile ON)
Budget vs actual, selections & allowances, job schedule stages, daily log. Migration `202611120080` (NOT applied; DB test `supabase/tests/run-project-tools.sh`). ARX unchanged until a company turns the switch on. Code: `lib/project-tools/*` (server), `lib/cost-codes.ts` + `lib/selections.ts` + `lib/job-schedule.ts` (pure), `components/project-tools/*`, customer page `/s/[token]`.
- **Budget:** a cost code is a nullable label on THE ledger (`job_cost_lines.cost_code`; null = its `cost_type`'s default code). Company list = `org_cost_codes` (empty = defaults Materials/Labor/Sub/Permit/Dump/Equipment/Other; turned off, never deleted). Budgets = `job_budget_lines` written ONLY by SQL `set_job_budget_line` (line + `job_budget_changes` history in one txn). Actuals come only from `loadJobCostLedger(..., { withCostCodes: true })`; never a second reader. The dealer-fee line is never in a budget comparison.
- **Selections:** `job_selections`; customer link `/s/[token]` (host-fenced, company brand only). Over allowance → ONE change order through `lib/change-orders-remote.ts` (`createRemoteChangeOrder`, also what `POST /api/change-orders/create` uses for "Send to customer"); the customer signs on the existing signing page; the sale/commission base moves only when that is signed (existing sign route). Under allowance = shown as a credit, nothing moves by itself.
- **Schedule:** `job_stages` is the PLAN (workdays, depends on); crews/dates actually booked stay on `work_orders` (existing install scheduling). Templates come from the industry profile (`scheduleTemplates`); rules in `lib/job-schedule.ts` (moving a stage moves what depends on it; never starts before what it waits on ends).
- **Daily log:** `job_daily_logs`; photos are ordinary job photos tagged `daily_log` (staff via `/api/ops/jobs/[id]/photos/*`, crews via `/api/crew/[token]/photos/*`); weather from NWS (rounded coordinates, best effort).
- **Known Redundancy additions (2026-11-12):** (29) browser-side photo upload steps exist in `lib/job-photo-queue.ts` (offline queue), `lib/visit-photo-upload.ts` (now also `uploadTaggedPhotos`) and the crew page's own `uploadOne` — fold the crew page onto the shared steps when touched. (30) Selections and the Change order form both need a rep signature image; the form draws one, selections draw the typed name (`lib/typed-signature.ts`) — one signature helper would be safer. **Pre-launch legal list (2026-11-12):** a selection's rep signature is the sender's typed name, applied at SEND time to a change order whose amount is not known yet (the card now says "up to $X"); counsel should confirm that is an acceptable rep signature before other companies use it. **Review fixes (2026-11-12):** the selection change order builds on `currentContractTotal` (`lib/job-commission-base.ts`, signed contract + SIGNED change orders, same loader as the sale sync); `POST /api/change-orders/create` and the project-tools routes refuse field roles (`resolveSalesDocAccessBarred`) because the service-client insert skips the field-role RLS deny; a chosen overage whose change order expired can be re-sent or cancelled (the unsigned one is set `voided`, its token cleared; the job and project pages skip `voided`); daily-log date and selection due dates use the company's clock (`orgTodayYmd`); `/s/[token]` and `/api/public/selections` 404 when the switch is off.

## Crew incentives (2026-11-23) — lawn_landscape only
Automatic crew bonus rules that FEED the existing bonus approval (`payroll_bonus_lines`, pending_approval → approved → paid). No second payroll path: a line counts only once an owner approves it on the Bonus approval screen. Migration `202611230050_crew_incentives.sql` (NOT applied; apply before the code).
- **Gate:** industry profile is `lawn_landscape` AND `orgs.settings.crewIncentives.enabled` (default off; written only by `/api/admin/crew-incentives`, owners, mergeOrgSettings path ['crewIncentives'] — top-level writes refused, generic save strips it). It is NOT in `ORG_FEATURE_DEFS` on purpose (every company's Features card would list it). Roofing/ARX: `loadCrewIncentivesState` returns off before any visit/time/pay read; no route (404), no Settings entry (`SettingsItem.profile`), no UI, Sisu untouched (test-locked).
- **Rules** `lib/crew-incentives.ts` (pure, cents): done right (photos + no staff-marked callback after N days), beat the time (budget = `work_orders.estimated_hours`, else the job's `estimated_hours` when it is the job's only work order; actual = time-clock person-hours minus breaks; flat $ or % of hours saved × a company $/hour), review named the crew (staff mark), weekly target (visits or $ of `service_visit_charges`), callback deduction (negative line). Each has a split mode (even, exact cents | full each). Members = people who clocked the work order, else the crew's `crew_members`.
- **Writer** `lib/crew-incentives-db.ts` (`runCrewIncentives`, morning cron + after a mark): idempotent through `payroll_bonus_lines.source_key` (unique per org; a rejected line keeps its key). Week = the pay week of the earning date (company schedule); a locked / approved / being-approved week rolls to the next open one (`pickOpenWeek`; a past week that was never opened is never revived). Line text = rule + work order number + date — never a customer name or address.
- **Marks** `crew_visit_marks` (service role only) via `POST /api/crew-incentives/marks` (jobs:edit): "Review mentioned crew" / "Callback / redo" on a finished visit (Visits board → More). Un-marking is refused once a line was proposed (reject the line instead).
- **Scoreboard** `loadScoreboard`: crew phone page card + `/crew-bonuses`; only the viewer's own crews' people; a dollar target shows a percent, never job money.
- **Not built:** a Nav link to `/crew-bonuses`; a crew-link route (the card is server-rendered on `/crew/day/<token>`).

## UI Conventions
- **Text contrast is an ongoing, recurring problem in this build — always verify text stands out.** Use explicit dark text (`#2c2c2a`, not generic gray) on light surfaces; never place text directly on the satellite/photo map — use a solid or opaque-scrim background; aim for WCAG AA. Validate legibility on a cheap Android in direct sun for any field-facing UI.

- **Mobile standard (added 2026-10-22) — every new or changed screen must meet it, verified by `npm run test:mobile` (Playwright, iPhone SE 375 + iPhone 13).**
  Works at 375px and 390–430px with **no sideways page scroll**; tables collapse to stacked cards on mobile or scroll inside their own box with the first column pinned (never the whole page); **tap targets ≥ 44px** and the primary action reachable by thumb (sticky bottom bar for Send / Approve / Save); dialogs are **full-height bottom sheets** on mobile (use `dvh`, not `vh`); body text ≥ 14px and **inputs ≥ 16px** (stops iOS zoom-on-focus); money/number inputs use `inputMode="decimal"`; **no hover-only actions**; contrast per the rule above. New screens get a case in `e2e/mobile.spec.ts` (client screens render through `app/dev-harness/[screen]` with mocked `/api`; the harness 404s in production). The spec fails on sideways scroll, taps under 44px, and inputs under 16px.

- **Per-page Nav + announcements.** `components/Nav.tsx` is imported by each CRM page (there is no shared layout), so every new CRM page must render `<Nav />` itself — that is also what shows the "What's new" banner (`components/AnnouncementBanner.tsx`, data in `announcements` / `announcement_dismissals`, copy per role group in `lib/announcements.ts`, owner editor at Settings → Announcements). Canvass app, signing, crew and other customer-facing pages deliberately do NOT render Nav. Dismissal is per user in the database, never localStorage.

## Payroll phase 2 — pre-launch list (2026-11-13)
Advances, one-tap approve and the Gusto/ADP export sit on the pay-week path (`PAYROLL_PAY_WEEK_ENABLED`). Scope (Nathan): the CRM computes who earns what, approves and EXPORTS; the provider owns tax, filings and its own QuickBooks sync. No tax math, no loan ledger, no journal entries.
- **Advance tax treatment — confirm with the accountant before the first live run.** The export default is: repayment of an advance paid ON a check reduces that week's earnings (not a post-tax deduction); repayment of an advance paid OUTSIDE payroll is a post-tax deduction. An owner can flip either (`orgs.settings.payrollExport.advance`, "Advance export settings" on an approved week). Code never decides tax.
- Gusto upload headers are unverified against a live import; ADP company code, file numbers and earning codes must be set.
- One-tap approve has no WebAuthn re-auth (none in the repo): it is a signed one-time link plus the owner's signed-in session.

## Known Tech Debt
- Canvass service worker `public/canvass-sw.js` (~line 46) skips `/api/*` — API responses get no SW caching; client-side fetches must handle their own caching/timeouts.
- Vercel Cron pattern: every cron in `vercel.json` (11 as of 2026-11-12, incl. `instant-estimate-accuracy` and the 15-minute `customer-messages`) is secured by `Authorization: Bearer ${CRON_SECRET}` (503 if secret unset, 401 on mismatch) — always via `verifyCronSecret()` in `lib/cron-auth.ts` (constant-time; the 8 hand-copied checks were folded into it 2026-09-26). Reuse it for any new cron or Actions worker.
- **Which companies a cron runs for has ONE answer: `loadCronOrgs` / `loadCronOrgIds` (`lib/cron-orgs.ts`, 2026-11-10)** — companies with an active user, inside the `DEPLOYMENT_ORG_ID` fence. Loop it (or filter rows by it); scope every query to the company being processed; time zone per company via `CronOrg.timezone`. Inventory + how a second company posts leads: `docs/background-jobs-multi-company.md`.
- `lib/roofradar-open-data.ts` now contains only `getRecentStormReportsInBbox()` (IEM Local Storm Reports feed) used by the canvass weather overlay + weather-refresh cron. The Roof Radar admin tool that gave the file its name was removed July 2026 (demo-grade data, superseded by the weather overlay).
- **Weather overlay Phase 2** — Phase 1 + Phase 2 merged (PR #3, #4). The 8 Bugbot items (stale-warning clearing, error-as-empty `degraded` flag, swath read/ingest caps, response-cache expiry, atomic swath replace, clear-day orphans, ingest size guard) are **fixed in PR #5** (`feat/weather-phase2-bugfixes`) — verify on merge. No open weather-code debt after that. Prod flag `NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY` stays OFF until the human deploy checklist (GitHub/Vercel secrets, 4th cron, migration-history reconcile, MRMS backfill, preview field QA) is done — see `docs/canvass-weather-overlay-phase2-verification.md`. Claims-safe copy ("est.", "recorded", etc.) is enforced in code; not a separate legal gate. Separate open question (non-weather): confirm the `info@` feedback-routing + canvass "Report Issue" change bundled in commit `22e6ab5` is intended org-wide.
- **Sold add-ons missing from the materials-ORDER flow (not just the brief)** — 2026-07-15: `components/ops/JobRoofingBrief.tsx` "Job materials brief" card now shows sold proposal adders (Gutters, Decking, Siding, Skylights, Chimney, Ventilation category — from `proposal_line_items` where `is_adder=true`, surfaced via `formatSoldAddOns()` in `lib/job-roofing-brief.ts`), fixing a bug where e.g. Ashley Gaines' job (26-0026, proposal P-00118, 306 LF Seamless Gutters + fascia board + OSB + siding) showed no gutters at all. **This was a display-only fix.** The actual materials-*ordering* system (`job_material_order_overrides` table, `/api/jobs/[id]/material-order`, `job_product_orders` table) still only tracks core roofing materials computed from roof measurements (`lib/materials-order-list.ts`: field shingles, starter, hip/ridge cap, ridge vent, underlayment, ice & water, drip edge, step/wall flashing, pipe boots) — it has no path for sold adders at all. So a sold "Gutters" or "Decking" line can now be *seen* on the job page but still won't flow into whatever ops uses to actually place the supplier order. Before touching `job_material_order_overrides`/`job_product_orders`/the ordering UI, trace where ops actually places material orders today (manually off the proposal, or via `job_product_orders`?) and confirm whether adders need to join that flow or whether the ops team already treats "Sold add-ons" as sufficient at-a-glance visibility.

## In-house roof measure from USGS lidar (2026-09-26)
Nathan's goal: measure complex roofs ourselves — **no paid EagleView/Hover reports.** "Load roof"
(`/api/ai/detect-roof`, solar mode) now tries lidar first and falls back to the Google Solar path.
- **Data:** free USGS 3DEP lidar, NC Phase 4 (2016–17, QL1). Registry in `lib/lidar/sources.ts`.
  USGS serves ~110 MB LAZ tiles at ~300 KB/s, so `npm run lidar:ingest -- plan|run|status` (runs on
  any machine with the service key in `.env.local`; no paid compute) extracts building points once into
  the private `lidar-buildings` bucket (`lib/lidar/tile-store.ts`, ~2–3 MB/tile) and tracks tiles in
  `lidar_tiles`. `plan` queues only tiles holding our opportunities/measurements/leads — re-run it as
  new territory comes in. Coordinates stay in NC State Plane ftUS (EPSG:6543).
  **The queue drains itself hourly on GitHub Actions** (`.github/workflows/lidar-ingest.yml`, free on a
  public repo). The runner never holds the service key: it claims/completes through
  `/api/cron/lidar-ingest` (CRON_SECRET) and uploads to a one-time signed URL. Needs repo variable
  `LIDAR_INGEST_URL`. Queue logic lives once in `lib/lidar/ingest-queue.ts` for both workers.
- **Geometry:** `lib/lidar/roof-planes.ts` — RANSAC planes over 7 fixed seeds, medoid run (one run's
  lines swing ±20% with the random samples); 0.5 m label grid in the house's own frame; lines typed in
  3D (ridge/hip/valley/step) + eaves and sloped rakes. `lib/lidar/image-register.ts` shifts outlines
  onto the satellite photo (imagery drifts 0.5–3.6 m from survey truth); shapes/lengths unchanged.
- **Page:** sections load as normal drafts (`geometry_source: 'lidar_plane'`, measured downslope
  `drain_azimuth_source: 'dsm'`). Their lines come from lidar (`lidar_edges`, saved in raw_data) only
  while every section is an unedited lidar plane; an edit hands the geometry back to the 2D classifier.
- **Accuracy vs carrier reports** (`npm run lidar:eval`, 9 roofs): squares ~5%, ridge+hip ~17%, ridge ~14%.
- **Limits:** anything built after the 2016–17 survey is missing (the "section may be missing" note
  helps); tiles not yet ingested fall back to Solar silently. Kill switch: `ROOF_MEASURE_LIDAR=false`.

## Website Instant Estimate — accuracy rules (2026-11)
`lib/public-roof-estimate.ts` (`measurePublicRoofEstimate`). Version string `INSTANT_ESTIMATE_VERSION` — bump it whenever measure/pricing logic changes so accuracy checks compare like with like.
- **Measure:** in-house lidar FIRST via `lib/lidar/measure-near.ts` (the ONE lidar entry point, shared with `/api/ai/detect-roof`), 15 s cap, then Google Solar. Main building only; detached garages/shops are flagged (`nearbyStructures`, sheds ignored) and never added to squares. Lidar is skipped if it found something < 0.6× Google's footprint for the same building (`lidar_solar_mismatch`).
- **Price:** live pricebook — the org's active roofing type named **"Asphalt Shingles"** (`lib/public-estimate-rate.ts`, 10-min cache). **Editing that row changes website prices within ~10 minutes; renaming/deactivating it silently freezes the estimate at $451.20** (a warning is logged). Env `PUBLIC_ESTIMATE_PRICE_PER_SQUARE` overrides. The rate is locked into the preview snapshot. ONE rate for every path — uncertainty widens the range (`getPublicEstimateBand`: lidar −6/+8%, Solar −8/+12%, unreliable −10/+25%); never re-introduce padded fallback $/sq.
- **Waste:** priced on SOLD waste (what reps sell: 11/16/22% by sections, or by lidar hip+valley LF), not crew usage (~10%). Do not reuse `calculateRoofWaste` here — that is the materials-ORDER model.
- **Pitch:** `lib/public-estimate-pitch.ts` keeps real low/flat readings (the measure tool's `pitchRiseFromDegrees` rounds < ~2.4° to 0 and callers default 0 → 6/12). Known divergence; fold into one helper when the measure tool's pitch code is next touched.
- **Accuracy loop:** nightly cron `/api/cron/instant-estimate-accuracy` scores the estimate against carrier/manual/lidar-reviewed measurements into `instant_estimate_checks`; Reports → "Instant estimate accuracy". `instant_estimate_calibration` auto-scales squares per measure source once ≥ 8 trusted checks (clamped 0.85–1.15; lidar_reviewed never grades a lidar estimate). Kill switches: `INSTANT_ESTIMATE_CALIBRATION=false`, `INSTANT_ESTIMATE_ACCURACY_CRON=false`. Details: `docs/measure-tool/instant-estimate-accuracy.md`.
- **Deploy order:** apply migrations `202611030010` and `202611030020` BEFORE the code (the preview store falls back without 0020, but the cron/report need 0010), then trigger the cron once.

## Supplier ordering by API (ABC Supply) — 2026-10-23
Built on the single send door in `lib/suppliers/send-order.ts`; **OFF by default** (env `SUPPLIER_API_ORDERING`, `orgs.supplier_api_ordering_enabled`, per-supplier switch), sandbox first, second owner approves orders over the limit or of unknown size, one attempt and never an auto-retry, only first orders (no API revise/cancel), append-only `supplier_api_events`. **Never call ABC's Pricing API or compare ABC prices with other suppliers — their Terms forbid it** (test-enforced). Setup and gaps: `docs/abc-supply-connector.md`.

## Invoices are per company (2026-11-10)
`job_invoices.org_id` (migration `202611100040`, NOT applied) is filled ONLY by trigger `job_invoices_set_org` from the parent job — writers never pass it. `invoice_number` is unique per org (`INV-<YY>-<job_number>-<seq>`, seq per job, skips numbers already used in the org). Every invoice-id read goes through `findOrgInvoice` (`lib/invoices.ts`, scoped via `production_jobs.org_id`, so code works with or without the migration); a lookup by `invoice_number` must also filter on the org (test-enforced, `invoice-org-scope.test.ts`). Items/payments have no org_id — they hang off a checked invoice. **Invoices without a job (2026-11-11)** carry their own org_id and `customer_id`; `findOrgInvoice` finds them through org_id (see "Invoicing recurring service").

## Invoicing recurring service — invoices without a job (2026-11-11)
ONE invoice system: `job_invoices` (+ items, `invoice_payments`, `job_payments`). Migration `202611110060_customer_invoices.sql`
(NOT applied; **202611100040 MUST be applied first** — 0060 replaces its trigger and needs `org_id`; then after 202611110030,
202611110040; order also in docs/domain-cutover.md; DB test `supabase/tests/run-customer-invoices.sh` on local PG16).
- **Shape:** `job_invoices.job_id` nullable; a row has a job (exactly as before) OR `customer_id` (+ `property_id`) with its own
  `org_id` (writer sets it; trigger `job_invoices_set_org` checks customer/property are that company's). Kind `'service'`.
  Numbers `INV-<YY>-<5-digit seq per company per year>`. Lines gain `work_order_id` (the visit), `service_date`,
  `service_plan_id` + `billing_month` (a monthly plan's month, 1st), `unit` ('hour' = time & materials: qty hours × rate).
- **ONE writer of billed lines:** SQL `create_service_invoice` (per-company advisory lock; ALL OR NOTHING — if a visit or
  plan-month on it is already on a non-void invoice nothing is written; void frees it). Lines AND totals (tax from
  `computeCustomerSalesTax`, same rule as every invoice) go in the same call via `createServiceInvoiceFromLines`
  (`lib/invoices.ts`) — no $0 invoice can hold visits. Used by billing AND by "Duplicate" of an invoice without a job
  (refused while the original is live: void it first, then copy — the copy keeps the visits). App side
  `lib/service-billing-db.ts` (`loadReadyToBill`, `createServiceInvoices` — recomputes from the DB and bills EXACTLY the
  units / visits the screen previewed (`unitKeys`, `visitIds`; a visit finished since waits for the next run), ≤ 25
  per request), rules
  `lib/service-billing.ts` (units: per-visit plan → each visit at its `service_visit_charges` snapshot = its own price as of
  its slot day; per-month plan → one plan-month at `planPriceOn(plan, 1st)` for any month with a done OR skipped visit (the
  fee follows the plan's billing basis; a paused month has no visits so doesn't bill), its done visits listed at $0;
  per-visit plans bill nothing for skips; yearly / unpriced / follow-on steps not billed here). Grouping: one per customer per month (the current month waits unless included) or
  one per visit. Screen: Jobs → Schedule → **Ready to bill** (`components/billing/ReadyToBill.tsx`).
- **Who:** `lib/service-billing-access.ts` — `servicePlans` switch on + `callerCanAccessJobBilling` (money:record).
- **Tax:** `recalculateInvoiceTotals` (draft edits) taxes an invoice without a job by ITS customer and now throws if its
  total write fails; creation and the preview use the same `computeDocumentSalesTax`. Plan / charge `taxable` → line `taxable`.
- **Customer document:** `lib/invoice-document.ts` is THE invoice model for the print page AND the email
  (`lib/invoice-email.ts`); `findPrintableInvoice` is the id-or-number lookup (both scoped). Only invoices without a job are
  really emailed (`sendCustomerInvoice`: email first, then mark sent); job invoices keep the old "mark sent" stub — the
  original company is unchanged. `renderInvoiceEmail(doc, { payUrl })` is where a card pay link goes.
- **Money in:** ONE writer `recordCustomerInvoicePayment` → SQL `record_customer_invoice_payment` (locks the invoice, never over
  the balance, a draft is issued on the spot) = a `job_payments` row with `job_id` NULL + `org_id` + `customer_id` and its
  `invoice_payments` application. The Stripe webhook calls this same function (key `stripe:<payment intent>`, see "Online payments"). Every job reader filters
  `job_payments` by job id (and the SQL views join jobs), so these rows never touch job totals, paid-in-full
  (`lib/job-collection.ts`), payroll or `rpt_payments`. `applyPaymentToInvoice` refuses invoices without a job.
  Paid in full for these invoices = `computeInvoiceBalance(...).is_paid` / status `paid`.
- **A billed visit can't be reopened** (`applyVisitAction` → 409 naming the invoice; DB trigger
  `work_orders_billed_visit_guard` takes the same lock as billing, so they can't cross).
- **An invoice without a job with a payment on it can't be voided** (`voidInvoice` message + DB trigger
  `job_invoices_void_guard`; the payment writer locks the invoice row). Since 202611120020 the guard counts the NET paid
  (refunds are negative applications), so a fully refunded invoice can be voided. Refunds come only from Stripe today.
- **Reports:** `rpt_payments` (redefined in 0060, LEFT JOIN) includes payments without a job under their own company (no
  job number); job payment rows unchanged. `rpt_invoices` (migration 202611140010) is the service-invoice dataset; revenue by month is `rpt_revenue` (see "Gross revenue report").
- **Not built:** auto-invoice when a crew marks a visit done (the office bills from Ready to bill, one tap per visit or a
  batch); yearly-plan billing; the `unpaid-invoices` Today card; QuickBooks for these invoices (the outbox design is per
  job). Hours billing: see "Hourly billing (time & materials)".
- **Visit job costs — deliberately NOT built (2026-11-11):** `job_cost_lines.job_id` stays NOT NULL. Every cost reader is
  job-keyed (`lib/job-cost-ledger.ts`, `rpt_job_costs`, profit tracker, payroll materialization); a visit cost line would
  be invisible to all of them, i.e. a second cost ledger in practice. A visit's real costs are crew time (the time-entry
  source being built on feat/time-tracking: one source for payroll + costing + billing) and per-plan materials — decide the
  visit/plan profit view there, then add `work_order_id` to `job_cost_lines` (nullable job, CHECK one of the two) in one
  change with its reader.

## Online payments — Stripe Connect (2026-11-12)
Switch `onlinePayments` (default OFF). Migration `202611120020_online_payments.sql` (NOT applied; after 0040 → 0060; DB test
`supabase/tests/run-online-payments.sh`). Full design, Stripe doc links and the Stripe-dashboard setup: `docs/online-payments.md`.
- **Each company connects its OWN Stripe account; direct charges** (`Stripe-Account` header) — the money and Stripe's fees are
  the company's. v1 accounts with Standard controller properties, onboarding by Account Link (no OAuth / client id).
  One live `payment_accounts` row per company; never deleted (refunds after a disconnect still resolve).
- **ONE Stripe door** `lib/stripe/api.ts` (fetch, form encoding, pinned API version 2024-06-20, signature check). No SDK.
- **Card data never touches us:** Stripe-hosted Checkout for pay + save card (mode setup). Keep ids + brand/last4/expiry only.
  No surcharge ever. Platform fee = env `STRIPE_APPLICATION_FEE_BPS` (default 0 = not sent).
- **No new money writers.** `lib/online-payments/record.ts` routes Stripe money to the existing ones: job invoice →
  `recordJobPayment` (**`lib/job-payment-record.ts`, server only** — the one job payment writer; "Add payment" uses it too:
  insert + idempotency key + outbox `payment.recorded` + office email) + `applyPaymentToInvoice`; no-job invoice →
  `recordCustomerInvoicePayment` (SQL gained `p_idempotency_key`). Refunds = NEGATIVE payments + negative applications
  (`applyRefundToInvoice`, SQL `record_customer_invoice_refund`), keyed `stripe-refund:<refund id>`, never deletes.
  `invoice_payments.applied_cents` may now be negative (≠ 0). Don't import `lib/job-payment-record.ts` from client code.
- **Webhook** `/api/webhooks/stripe`: signature on the raw body, once per event id (`stripe_webhook_events`), company ONLY from
  `event.account`, object accepted only when its metadata `crm_org_id` is that company; non-CRM Stripe activity skipped.
  Handlers are idempotent; the pay page also records on return.
- **Customer page** `/pay/<token>` (public, hashed tokens in `payment_links`, host-fenced to the company's address).
  Autopay: no-job invoices charge the card on file on Send (`sendCustomerInvoiceOnline`), retries on the morning cron
  (`runAutopayRetries`), one charge per invoice per attempt (unique index + Stripe idempotency key).
- Who: owners connect/disconnect/settings; billing staff (`money:record`) make links and manage cards (`lib/online-payments/access.ts`).
- **Money review (2026-11-12) — rules:** (1) a webhook event is never `done` unless its payment is recorded: a recorder
  holding the lease → 409, any error → 500 (Stripe retries); the recorder is idempotent by PaymentIntent. (2) Autopay: an
  attempt that got no answer stays `open` and is finished with the SAME attempt, amount and idempotency key after asking
  Stripe (search by `online_payment_id` metadata) — never a new charge beside it; the morning cron finishes stale ones.
  (3) Refunds / lost disputes come back off the invoice only as far as THAT payment applied (`refundTakeBack`: an
  overpayment is given back first). (4) Applying a payment to a job invoice is ONE locked SQL step,
  `apply_job_invoice_payment` (never over the payment's rest nor the invoice balance). (5) A job payment and its outbox row
  are ONE SQL transaction, `record_job_payment` (re-queues a missing outbox row on a repeat). (6) Outbox events:
  `payment.recorded`, `payment.refunded`, `payment.disputed` (negative amounts) — never a negative `payment.recorded`.
  (7) Rate limits: `/api/pay/<token>` per address (memory) and per link (SQL `payment_link_take_attempt`, 10 / 15 min);
  staff links ≤ 20 per invoice / customer per hour. (8) A payment in another currency than the company's
  (`settings.onlinePayments.currency`, default usd) is never recorded (needs a look). (9) Stripe's onboarding refresh
  URL is a side-effect-free GET (back to Settings); every staff write refuses a cross-site Origin (`crossSiteWrite`).
  JS mirrors of the new SQL for jest: `lib/test-helpers/fake-payment-rpc.ts` (Known Redundancy 40).
- **Second review (2026-11-12):** only "no answer" (network, timeout, Stripe 5xx / 429 / 409 in-progress — `noAnswer`) keeps an
  autopay attempt open; any other Stripe answer (decline, removed card, bad request) fails it normally (customer + office
  told; the retry is a NEW attempt). An attempt charges in its SAVED currency. Reversals are computed from ALL of a payment's
  succeeded refunds + lost disputes at once (order-independent). A lost dispute on a job already collected or in an
  approved payroll week sets `online_payments.reversal_flag` → "Payment reversed — review" on Today (payroll admins) and the
  owner morning email for 14 days. **Not built (decide first):** automatic negative commission lines for a reversal — the
  office uses Payroll → Fix a mistake (`addAdjustment`) today.

**Hourly billing addition (2026-11-12, customer messages branch):** commission change lines that hit an unexpected error
are marked `commission_change_wait 'retry_error'` (`markCommissionChangeRetry`, also when the T&M base sync fails) and retried by
the morning cron (`retryDueCommissionChanges` — re-syncs a T&M job's base first; now runs whatever the hourly switch says) —
never only logged. Today / morning email list them as "could not be written — retried every morning".

**Known Redundancy additions (2026-11-12, online payments):** (38) `ymdInZone` is defined twice (`lib/payroll-week-schedule.ts`,
`lib/service-plans.ts`, identical) — fold into one date helper. (39) Customer-facing "branded email with one button" HTML is
now hand-built in 4 places (`renderInvoiceEmail`, `notifyCustomerOfFailedPayment`, the save-card email in
`app/api/customers/[id]/card`, `lib/job-payment-email.ts` office) — one small email layout helper when next touched.
(40) `record_job_payment` / `apply_job_invoice_payment` are mirrored in JS for jest (`lib/test-helpers/fake-payment-rpc.ts`);
a rule changed in the SQL must change there too (the real SQL runs in `supabase/tests/online_payments.test.sql`). The old
unlocked TS paths stay only as a fallback until migration 202611120020 is applied — delete them after.

## Purchase orders (2026-11-12) — one PO system, roofing materials are one kind
General POs to any vendor/sub for any trade, on a job or a service visit (`work_orders`). They are the SAME rows as the roofing material order: `supplier_orders.kind` = `materials` (the old flow, unchanged, golden-tested in `purchase-orders-roofing-golden.test.ts`) or `general`. Every materials reader (`lib/supplier-orders.ts`, `job-catch-up-db.ts`, the `received` route) filters to `kind = 'materials'`; `vendor_type = 'sub'` vendors are never offered as material suppliers. Migration `202611120090_purchase_orders.sql` (NOT applied; additive).
- **Vendors = the existing `vendors` table** (Settings → Vendors): `vendor_type` supplier | sub | both, email, phone, contact, default `trades`, optional `sub_contractor_id`. Creation stays owner-only.
- **Rules/DB/PDF:** pure `lib/purchase-orders.ts` (money in integer cents, `derivePoStatus`), server `lib/purchase-orders-db.ts`, PDF `lib/pdf/purchase-order.ts` (the roofing PDF renderer is untouched). PO number = `<job or visit number>-<letter>` (same scheme as materials). One PO per vendor per job/visit.
- **Status** draft → sent → acknowledged → partially_received → received → billed (+ cancelled) is DERIVED and written only by `refreshPoStatus`.
- **Sending** goes through the same door as supplier orders (`sendOrderToSupplier`, allow-listed in `supplier-send-door.test.ts`): preview token must match what the person saw, explicit confirm for a re-send, one in flight per PO, PDF stored, a failure marks nothing sent. Vendors on the supplier API are refused here (email only). "I sent it myself" records a manual send. Nothing automatic ever sends.
- **Vendor confirm link** `/po/<token>` (public, `lib/public-paths.ts`): random token, only its SHA-256 is stored, 90 days, rotated per send, reset on revision, rate-limited; it can only mark "I have this order".
- **Vendor bills** (`purchase_order_bills`) write the job cost ledger ONLY through `addJobCostLine` (`lib/job-cost-ledger.ts`, source `vendor_bill`, unique `purchase_order_bill_id` = no doubling; born unapproved, not in the commission base). A bill over the PO total, or money already typed on the job for that vendor, asks first. Bill-sourced lines cannot be edited or deleted from the cost-lines routes; void the bill on the order (`voidPoBill` archives that cost line with the same soft delete the cost list uses, status `archived` + `deleted_at`). Each bill sheet sends a `clientKey`, so a double tap records once; the over-the-order check is repeated after the insert. A visit with no job records the bill on the PO only (`job_cost_lines.job_id` stays NOT NULL).
- **Gaps:** bill file upload is job POs only (reuses cost-attachments); no budget/cost-code system beyond `cost_type`; vendor logo is not on the PO PDF.

## Automatic customer messages (2026-11-12)
Switch `customerMessages` (`ORG_FEATURE_DEFS`, **default OFF**; lawn_landscape profile ON) AND each message turned on by an
owner at Settings → Customer messages (`/admin/customer-messages`, `/api/admin/customer-messages`; nothing stored = every
message OFF) — ARX is unchanged unless both. Migration `202611120050_customer_messages.sql` (NOT applied; after 202611120030).
- **Messages:** visit reminder (N days before, one email per customer per visit DAY whatever the visits/properties; date,
  company-wide arrival window text, what = plan name (+ step label), the company's gate/pets note — never the gate code), "on
  the way" (crew taps "On my way" on `/crew/day/<token>`, route `.../visits/[id]/on-the-way`; sent at once, even in quiet
  hours), "done" (queued by `applyVisitAction` → `queueVisitDone` only for a visit done on the day it sits; sent 15 min later
  by the cron so a reopen cancels it; optional photos link), quote follow-up (days after sent, the ONE waiting rule
  `listUnsignedProposals` in lib/today.ts; button = the pending contract's signing link if one exists), invoice reminder (days
  from `due_at`, else the sent day; pay link when online payments are ready; an autopay customer is held while an automatic
  charge has no result — open/processing — and hears after a failed one).
- **Rules** `lib/customer-messages.ts` (pure: settings, keys, timing, words for email AND sms text). **Layout** for any
  branded one-button customer email: `lib/customer-email-layout.ts` (`renderCustomerEmail`; footer = company name, postal
  address as a maps link, tap-to-call phone, website, unsubscribe) — the home for Known Redundancy 39. **Channels**
  `lib/customer-message-channels.ts` (email via SMTP + List-Unsubscribe / one-click; `sms` slot defined, `available()`
  false — wire a provider there, nothing else changes).
- **ONE sender** `lib/customer-messages-db.ts`: cron `/api/cron/customer-messages` every 15 min (`loadCronOrgs`, company
  time zone, quiet hours `quietStart`→`quietEnd`, default 8 PM–8 AM). Every message = one `customer_messages` row keyed
  `(org_id, message_key)` — the insert IS the claim; `deliver` claims (queued|failed → sending, conditional), RE-CHECKS
  the facts (visit still that day and open, quote still waiting, invoice still open, not opted out / suppressed), sends,
  records sent / skipped(reason) / cancelled(reason) / failed (≤ 3 tries, 30 min then 2 h). A row stuck in `sending` > 15
  min is closed failed and never retried (it may have gone out). Steps due only within 3 days of their day (an old quote /
  invoice when the switch is turned on gets nothing). Caps: 100 sends per company per run, 4 per address per 24 h.
- **Review rules (2026-11-12):** every builder re-checks at send time that its message is still ON (else cancelled
  'turned_off') and still inside its late window (else skipped 'too_late'). **Identity:** From = the company's own name +
  email (`orgs.name/email`), Reply-To the same, postal address `orgs.address` — read by `companyIdentity` straight from the
  row, never `resolveOrgBrand`'s legacy fallback; any of the three blank → nothing is sent, due rows become `blocked`
  (re-tried hourly, sent once fixed if still in their window), Settings lists the fix and owners get "Customer emails are
  stopped" on Today (`loadCustomerMessagesBlockedQueue`). The SMTP account must be allowed to send as that address.
  **Claim + daily cap are ONE SQL step** `customer_message_claim` (per (company, address) advisory lock; counts sent,
  sending and failed-with-tries-left rows by the address recorded at claim). **Timeouts / dropped connections = unknown**:
  retried only after 6 h, with the same Message-ID (`<cm-<row id>@<company host>>`) and the same links (link token =
  HMAC of the row id, env `CUSTOMER_MESSAGE_LINK_SECRET` else the service key). JS mirror of the claim: in
  `lib/__tests__/customer-messages-db.test.ts` (KR #35 pattern).
- **Opt-outs:** office "Don't email this customer" (`customers.messages_off_at/by`, Customer File → Automatic emails card,
  `/api/customers/[id]/messages`, anyone who may edit the customer); unsubscribe link `/m/<token>?stop=1` + one-click POST
  `/api/m/<token>/unsubscribe` (public, host-fenced, hashed per-message token) → `customer_message_suppressions`
  (`suppressAddress` is the ONE writer — a provider's bounce/complaint webhook must call it) + the customer flag; turning
  back on needs "the customer asked". A 5xx on the recipient at send time suppresses as bounced. **Not visible over plain
  SMTP:** later bounces (DSN mail) and spam complaints — needs a provider with webhooks.
- `/m/<token>` (public) also shows a "done" visit's photos (signed 1 h URLs) for 90 days.

## QuickBooks (2026-11-06; connection built 2026-11-13)
**The CRM is not accounting software (Nathan, 2026-11-11):** it sends customers, invoices (incl. service + tax), payments (gross)
and APPROVED vendor bills to the company's own QuickBooks, one way. No ledger, chart-of-accounts, reconciliation, bill paying,
fee/payout bookkeeping or payroll posting (the payroll provider's own QuickBooks sync books payroll). Design: `docs/quickbooks-sync.md`.
- **Connection (PR 2)** `lib/quickbooks/` (switch `quickbooks`, default OFF; migration `202611130050`, NOT applied): ONE reader/writer
  `connection.ts` for `qb_connections` (tokens sealed with `lib/secret-seal.ts`, env `SECRETS_ENCRYPTION_KEY`, no fallback key);
  ONE Intuit door `api.ts`; refresh with rotation under a lease (`getQuickBooksAccess` — the only way to get a token); `qb_links` is the
  one CRM<->QB map (empty until the worker). Owner-only (`isSuperAdmin`). Connect reuses the Google signed single-use ticket
  (`lib/google-oauth-state.ts`, now with a `purpose` so a ticket can't cross callbacks; `sameOrigin` only for a company with no address):
  start `POST /api/admin/quickbooks`, callback `/api/integrations/quickbooks/callback`, finish `.../finish`. Settings card
  `QuickBooksCard`; Today "QuickBooks needs you" (reconnect). One cron `/api/cron/quickbooks` (keeps tokens warm; PR 4 drains the outbox in it).
  `settings.quickbooks` is written only at path ['quickbooks'] (later PRs).
- Until the worker ships, `integration_outbox` only receives `customer.upserted` (contract signing, `enrichCustomerFromContract`) and
  `payment.recorded` / `payment.refunded` / `payment.disputed` (`recordJobPayment`) — nothing drains it.
  `lib/__tests__/quickbooks-outbox-guard.test.ts` holds that line.

## Install Scheduling — crews per trade (2026-09-15)
A job's crews are **trades**: one `work_orders` row per trade (`trade` = a slug from the company's own
list, `org_trades` — read ONLY via `loadOrgTrades` in `lib/org-trades.ts`, falling back to `DEFAULT_ORG_TRADES`
until migration 202611060030 is applied; composite FK `(org_id, trade)`; slugs never change, trades are turned
off not deleted; owners edit it at Settings → Job setup; client components get the list from the server response; every trade label — catch-up, data health, crews — comes from `tradeLabel(slug, orgTrades)`, never a local map; sub Services choices are the org's active trade labels and match a crew via `subServicesMatchTrade` (slug OR label, case/space/underscore-insensitive; older free-text values like "Doors" stay on the sub)),
`work_order_type='install'`, each with its own sub, date, length
(`install_days` ½ | 1 | 1½ | 2, ops-selected), Google invite, and crew photo link. Pure helpers
in `lib/job-trades.ts` (client-safe), DB in `lib/job-trades-db.ts`.
- **One write path:** `POST /api/ops/install-schedule/assign|unassign` take `workOrderId`.
  `production_jobs.scheduled_date/install_days/assigned_sub_id` are DERIVED by
  `syncJobScheduleFromTrades` — never write them directly. Earliest crew date; roofing crew as the sub.
- **Trades are created lazily** by `ensureJobTrades` (board + job page load): the primary trade
  adopts the job's existing sub/date/Google event; gutters/siding/windows are auto-added from sold
  line items (fascia/soffit deliberately not). Removing a trade sets `cancelled` (kept, so it isn't re-added).
- **Crew photo link** `/crew/[token]` (public, `lib/crew-link.ts`): 4 walk-around photos per trade
  into `photos.work_order_id`. Token rotates on sub change, dies on unschedule/remove/job cancel,
  expires 30 days after the crew's last day. Link goes in the invite notes.
- Marking a trade done needs its 4 photos (override allowed). The JOB is never auto-completed —
  `complete` starts payroll; the job page warns if crews are still open.
- ½ day is a timed 4-hour event; 1/1½/2 are all-day over 1/2/2 dates.
- **Legacy `/sub-portal/[token]` no longer works** — its anon RLS policy leaked every portal-enabled
  sub's token/phone/email and was dropped 2026-09-15. Deletion candidate (the crew link replaces it).

## Install Scheduling — deployment knobs
`/ops/schedule` assigns installs to subcontractors and exports them to Google as
all-day events. Three environment variables, and they are NOT interchangeable:

| Var | What it is |
|---|---|
| `GOOGLE_INSTALL_CALENDAR_ID` | Legacy fallback for the calendar installs are written to. Prefer `orgs.install_scheduling_calendar_id` (below), which needs no deploy. |
| `CRON_SECRET` | Unrelated; existing. |

**`info@arxroofing.com` cannot be the scheduling account.** It is the
customer-facing address (contracts, warranty claims, `lib/crm-email-from.ts`) but
is an ALIAS, not a Workspace mailbox — it cannot own a calendar or hold a Google
token, and there is no `users` row for it. Confirmed with Nathan 2026-09-08; do
not re-propose it without checking that first.

**Which Google account installs act as** is `orgs.install_scheduling_user_id`, a
column rather than an env var so it changes without a deploy (set to Nathan
2026-09-08). It reuses the per-user Google connection that appointment
scheduling already has — `user_google_tokens` + `getValidAccessToken`, connected
on `/admin/scheduling`. Appointments are per-closer because a rep owns their own
booking; an install belongs to the company and a subcontractor, so it needs one
nominated account instead. `resolveInstallGoogleToken` is the single answer, used
for BOTH the event write and the free/busy read — they must match, because crews
share with exactly one address and RSVP is read off events that account owns.
Unset, it falls back to the acting user. The subs admin page prints that same
account's email in its share instructions, resolved server-side, so what crews
are told cannot drift from what the server reads.

**Which calendar** is `orgs.install_scheduling_calendar_id`, resolved in the same
call (`resolveInstallCalendarConfig`) because nothing ever needs the account
without the calendar. NULL falls back to `GOOGLE_INSTALL_CALENDAR_ID`, then that
account's `primary` — i.e. someone's personal calendar, which is what a dedicated
install calendar exists to avoid. Note `production_jobs.install_calendar_id` is a
different thing: it records where a specific job's event actually went, so an
update or delete still finds it after this setting changes.

Subs do **not** OAuth. They share their calendar once at Google's "See only
free/busy (hide details)" — ARX sees busy blocks, never event details. A sub who
never shared is reported `not_shared`, **never** as "free"; conflating those
would make the board confidently wrong. Conflicts warn, never block: subs work
for other GCs and their calendar is not the whole truth.

Invites reach any email address — Google mails a standard `.ics`. **A Google
account is not required**; do not reintroduce copy claiming otherwise.

## Signing engine (2026-11-11, PR1+PR2)
- **ONE engine, `lib/signing/*`, for every signed document.** Envelope per document (`signing_envelopes`, made lazily, no backfill), append-only evidence (`signing_events`, once-events unique per envelope + `signer_key` + event), SHA-256 of the stored signed PDF, a completion certificate PDF (own file; contract/CO PDFs and goldens are untouched), consent (`lib/signing/consent.ts`, version `ESIGN_CONSENT_VERSION`, **wording is for counsel to review**), lifecycle (`lifecycle.ts`: resend/remind/extend/void/decline/markViewed), mail (`mail.ts`, the one SMTP door for signing mail). Domain row status stays the truth; a decline voids the row (enum has no 'declined'). Completion is `completeEnvelope`, idempotent, run as the named step `engine` in `finishSignedContract` and after the CO PDF.
- **Company switches** (`orgs.settings.signing`, owner-only, writer `saveSigningSettings`/`/api/admin/signing`, stripped from the generic save): consent, decline, auto-file default ON only for a company with a saved profile (ARX/legacy = off, identical behavior); reminders (days 2 and 5) and the signed-copy/decline emails default OFF for everyone until Nathan says.
- **Provider seam is narrow:** `getSigningProvider(admin, orgId, kind)`; contracts, change orders and quote approval are always native (they create the sale, job and commission base). `PROVIDER_ELIGIBLE_KINDS` lists the only kinds an outside provider may carry ("send my own PDF").
- **Deploy order:** apply `202611200010_signing_engine.sql` BEFORE the code (the code degrades to "not ready" without it). Staff status/actions: `/api/signing/[kind]/[id]`; public: `/api/signing/viewed|decline` (host-fenced); cron `signing-reminders` (hourly, `SIGNING_REMINDERS_CRON=false` kills it).
- **Send any PDF (PR3, 2026-11-11).** `/signing` (list), `/signing/new` (upload or drag a PDF, place fields on desktop or phone, one or many signers, ALL AT ONCE (Nathan, 2026-11-11: no order picker); the ONE exception is automatic: a role with `company: true` ("We sign too" checkbox, `signature_request_signers.is_company`) signs LAST, after every other signer, no setting. The engine still supports `serial`; `signingWave` in `lib/signing/requests/types.ts` is the one rule), `/signing/templates/new`, bulk send of a template. Library `lib/signing/requests/*` (`db.ts` create/send/token lookup, `sign.ts` sign/complete/void/decline/resend, `pdf.ts` flatten-stamp onto the ORIGINAL bytes, `types.ts` plan rules, `store.ts`); staff door `lib/signing/staff-gate.ts` (same-site, signed in, never a field role); sending needs `contracts:send`, templates `teams:manage`. Tables `signature_requests / _signers / _fields / signature_templates`, envelope `doc_kind='signature-request'` (migration `202611200020`, apply BEFORE the code, after 202611200010; additive, so either order breaks nothing existing; nothing applied). Signer page `/sign/<token>` (public, hashed per-signer token, host-fenced, company brand only): guided Start/Next, progress, adopt signature/initials once, name/date auto-filled, consent + decline, download copy. Field positions are fractions of the displayed page. pdf.js (`pdfjs-dist` legacy build, worker bundled via `new URL(..., import.meta.url)`) renders pages client-side; NOT verified under `next build`, check on the preview. Company switch `signing.customDocuments` (default OFF for every company; an owner turns it on), `signing.bulkDailyCap` (default 200 bulk recipients per rolling 24 h); bulk skips addresses on `customer_message_suppressions` (the one opt-out/bounce list). PDFs go browser -> storage via `POST /api/signing/uploads` (signed upload slot; `adoptUploadedPdf` re-checks path, size 15 MB, type, pages, hash) and out via 302 to a 2-minute signed URL (`redirectToStored`) because Vercel caps function bodies near 4.5 MB (pdf.js fetches the redirect: verify storage CORS on the preview). Reading: list/detail/files need `contracts:view` (a sender sees their own); field roles never. The company countersigner must be an active staff user of the company (matched by email, `company_user_id`) and signs signed in as that user (`login_required` otherwise). A signer who already signed cannot decline. Contracts / COs / quote approval stay on their own flows and are never offered here.
- **Legacy `contracts` / `contract_templates` flow DELETED (PR4, 2026-11-11).** Prod counts were 0 and 0 (read-only count, 2026-11-11). Removed: `app/contracts/[token]` (+ `/rep`), `/api/contracts/start|from-template|[id]/send|rep-sign|audit|download`, `/api/contract-templates`. Nothing in app/components/lib linked to them. The tables (`contracts`, `contract_templates`, `contract_signatures`) are left in place (additive-only rule); drop them in a later migration. The live sale agreement is `order_form_contracts` via `/contracts/sign/[token]`. **Quote approval and selections already ride the engine** (approval finalizes through `/api/contracts/sign`; a chosen selection creates a `job_change_orders` row), so they have envelopes/certificates with no extra code. Employee comp agreements and PO/crew acknowledgements are internal acknowledgements with their own receipts and are deliberately NOT folded (Tesla: no customer-document evidence needed; revisit if Nathan wants certificates for them, they would be `signature-request` kind).

## Major Features / Modules
| Module | Path | Notes |
|---|---|---|
| Canvassing app | `app/(canvass-app)/canvass/` | PWA, offline queue, Google Maps, rep geo-tagging |
| Dashboard | `app/dashboard/` | Sales metrics, KPIs |
| Leads | `app/leads/` | Full lead lifecycle |
| Opportunities | `app/opportunities/` | Post-inspection pipeline |
| Proposals | `app/proposals/` | Proposal builder with roof squares/adders |
| Contracts | `app/contracts/` | Digital signing |
| Work Orders | `app/work-orders/` | Sub dispatch |
| Sub Portal | `app/sub-portal/` | **Dead since 2026-09-15** (anon RLS policy dropped); replaced by `/crew/[token]`. Deletion candidate. |
| Jobs / Projects | `app/jobs/`, `app/projects/` | Production tracking |
| Sisu | `app/sisu/`, `app/admin/sisu/` | Incentive program (444, heats, badges, leaderboard) |
| Payroll | `app/admin/payroll/` | Bonus approval workflow |
| Commissions | `app/commissions/` | Rep commission statements |
| Canvass territories | `app/admin/canvass-territories/` | Territory assignment |
| Inside Sales | `app/inside-sales/` | Call center / inbound |
| Ops | `app/ops/` | Steve's ops dashboard |
| Reports | `app/reports/` | Overview + `/reports/explore` over the `rpt_*` views via one runner (`lib/reporting/`); saved/scheduled reports in `saved_reports`. The old builder is gone; its tables `custom_reports`/`report_schedules` remain, unread. |
| Roof Measure | `app/tools/roof-measure/` | Aerial measurement tool |

## Sisu 444 Program
Incentive program for setters:
- **Week 1:** 400 doors knocked + 4 inspections set = Week 1 bonus
- **Week 2:** Same thresholds again in the same pay period = Week 2 bonus
- Bonus amount configurable per org (`program_444_week_bonus_label` on orgs table)
- Pays within the work week covering the activity
- DB table: `program_444_enrollments` with `week1_qualified_at` / `week2_qualified_at`
- Live door/inspection counts tracked; auto-qualifies on page view

## Canvassing App Details
- Google Maps with pin clustering; reps drop pins on houses
- Dispositions: `not_home`, `bad_roof`, `renter`, `go_back`, `hot_lead`, `not_interested`
- Offline-first: Zustand + IndexedDB queue syncs when connectivity returns
- Rep geo-tagging: captures rep's physical GPS at knock time (`rep_lat/lng/accuracy/captured_at`) — separate from pin lat/lng (property address)
- Territory assignment and visibility controls per role
- Canvass attribution: `owner_user_id` > `pin_attributed_user_id` for pins transferred on/after
  `CANVASS_OWNERSHIP_TRANSFER_EFFECTIVE_FROM` (see Key Rules); frozen pin owner before that

## Active Initiatives (as of June 2026)
- **Recruiting plan** — scaling to 30+ reps by Sept 1 2026; priority #1 is insurance pipeline rep (July 15); 8 active setters target; second closer contingent on 4 conditions; Opportunity Nights every other Tuesday 6:30pm; full playbook at https://arxrecruiting.netlify.app/
- **iOS native app** — SwiftUI, Bearer token auth added to API layer
- **SEO content engine** — standalone at `~/Desktop/SEO Buildout/content-engine/`, merging into CRM as SaaS later
- **Proposal/squares work** — auto-filling roof square footage from aerial measurements into proposals (current branch)
- **Measure tool calibration memory** — post-install ground truth for AI tuning only (not CRM UI). Nathan tells the assistant a job's tool output vs. actual order/reorder outcome; the assistant appends a row to `data/measure-tool-memory/installs.csv` (primary — measured/ordered/actual/delta) and, only when non-obvious, a short note in `docs/measure-tool/lessons-learned.md`. Never fabricate a number the user didn't give. `@`-mention both when tuning waste, hip LF, or cap ordering in `app/tools/roof-measure/`.
- **Canvass roof-age layer** — flag `NEXT_PUBLIC_CANVASS_ROOF_AGE` (set in Vercel to enable). `/api/canvass/roof-age`: NC OneMap statewide parcels (`structyear`; coverage Mecklenburg ~99%, Iredell ~91%, Cabarrus 0%) with a Cabarrus fallback joining county parcel geometry (PIN14) to the `canvass_parcel_years` Supabase table — 84k pins bulk-loaded 2026-07-08 from the county's CAMA "Real Property Building" open-data CSV (largest-heated-area building's ActualYearBuilt per parcel; re-ingest ~yearly). Client markers are `google.maps.Circle` (iOS Safari does not paint Data-layer SVG point symbols), zoom-gated ≥16, buckets 10/15/20+ yrs, copy always "est.". Cabarrus's own GIS `YEAR_` column is legacy PIN numbering, NOT year built — never use it.
- **Canvass weather overlay** (hail/wind) — Phase 1 trial BUILT on `feat/canvass-weather-overlay`, feature-flagged OFF (`NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY`). Recent storm data = free **IEM Local Storm Reports** GeoJSON (bbox-scoped, near-real-time) via `getRecentStormReportsInBbox()` in `lib/roofradar-open-data.ts` — NOT the SPC WCM annual archive (that lags ~1yr; wrong for recent storms). Live NWS Alerts warnings also shown. Window = **2 years / 730 days** (insurance claim scope; hard cap). Hail (inches) + wind gusts (mph) + thunderstorm-wind-damage reports (gray "damage" dots, no speed). Separate `google.maps.Data` layer (`zIndex 1`, `clickable:false`) under pins; collapse-when-off control; claims-safe copy ("may have been impacted — free inspection", always "est."). Route `app/api/canvass/weather/route.ts` uses `requireAuthApi()`. MRMS MESH swaths = Phase 2 (needs GDAL worker, not Vercel). Docs: `docs/canvass-weather-overlay-*.md`. Prod enable: human deploy checklist in `docs/canvass-weather-overlay-phase2-verification.md` (not counsel sign-off).

## iOS App
- Native SwiftUI app for field reps
- Bearer token auth (`Authorization: Bearer <token>`) added to API layer
- Separate Xcode project at `ARX Sales/ARX Sales/`

## Supabase Project
- Project: `arx-internal-crm`
- Project ID: `anzqkklwcgaoeunzpqjh`
- Region: `us-east-2`
- Second project: `ARXroofing.com` (`gklmpghyktcuporhdziu`, us-west-2) — separate, the public website

## Git / Branch Conventions
- Main branch: `main`
- Work lands on short-lived branches off `main` (use a separate worktree when the main checkout has someone else's uncommitted work)
- Git user: Nathan Hall

## Financial Model Inputs (Feb 2026 baseline)
- Working days/month: 23
- Appts per setter/day: 2.0
- Sit rate: 75% | Close rate: 30%
- Gross margin (pre-comp): 52.4%
- OPEX: 4% of revenue ($653/roof)
- Owner draw: 20% of gross profit

- **Morning update "Today" + per-person focus (2026-11-05).** The owner morning email opens with "Today", built from the SAME queue loaders as the `/today` screen (`lib/today.ts`) — never a second query set. Each recipient is Everything (owner exceptions) or Crews only (crews this week + jobs to schedule, and "Needs you" narrowed to the no-dollar ops rows), set per person on Admin → Email Blasts (`email_blasts.morning_update.user_focus`, only 'crews' stored). Email rows show job/proposal numbers, never customer names or addresses (`QueueItem.ref/note`) — the storm-hits call list below is the one exception. "Waiting for a signature" is ONE rule, `loadUnsignedProposals`: status 'sent', deal not won/lost, aged by `sent_at ?? pdf_generated_at ?? created_at` (the builder never wrote `sent_at` before this date; it now stamps it on first save as sent).

- **Storm hits → owner morning email, not a separate email (2026-11-06, Nathan).** The storm-alert cron (`/api/cron/storm-opportunity-alerts`) still matches storms to open deals, writes `storm_opportunity_alerts`, notes the deal and routes it to the inside-sales storm queue — **keep that queue**. Its own digest email is DELETED (it never sent once: 0 of 126 alerts emailed; `email_sent_at` is no longer written). Instead `loadStormHitsQueue` (`lib/today.ts`) reads those rows (last 3 days, open deals and sold customers — lost drop off, one line per deal, biggest hit) and the morning email's **Everything** version leads "Today" with it as a call list: customer name + tap-to-call phone (the one queue allowed to carry customer details; never addresses). Crews-only never loads it, and it is NOT on the `/today` screen (every admin sees that; ops don't need it). Inside sales currently has nobody watching (call-center rep gone). **Next step decided, not built:** storm hits go to the rep who was working the account, so no one person is spammed — confirm which field means "working the account" (closer `owner_user_id` vs `assigned_user_id`) before building. Timing: the storm cron runs at 09:15 UTC (4:15am EST / 5:15am EDT) — after weather-refresh (09:00 UTC) and before the 5:30am ET email in both seasons (it was 10:00 UTC, which missed the email all summer). Spotter reports can lag a day, and radar hail swaths (`weather-mrms-ingest.yml`, scheduled 10:00 UTC, observed landing ~noon ET) cover the previous day, so a storm usually reaches the list the morning after it lands. The list also marks deals the cron did NOT route because a rep is already working them (`routed = false`). **Sold customers are included (Nathan, 2026-11-07):** `won` deals are matched too (`isStormCustomer`), with no inspection-history requirement (9 of 47 sold deals had none). They get a deal note only — written as `type 'note'`, `origin 'system'`, `audience 'sales'` with service wording (`buildStormCustomerNote`), never `status_change`, because job catch-up counts status changes as job movement — and are never routed, reassigned, reopened, or pinged to inside sales — and show on the list as "customer" (some sold jobs are not installed yet). A close on the calendar never hides a customer. Known gap: a won deal whose job was cancelled would still list (0 such today; the opportunity↔job link has two answers, Known Redundancy #9b).

- **Job page v2 (built 2026-10-29, OFF for everyone).** `JobDetailClient` renders the old body or the new five-tab body (Crews · Materials · Money · Notes · Files) by the `v2` prop (`users.ui_prefs.jobPageV2`). Both bodies live in the same file until cutover, so the old one is a deletion candidate once the switch is on for all. Materials status is ONE answer, `lib/job-materials-state.ts` (supplier orders first, stored `materials_status` as fallback and mirror). Parity: `docs/job-page-parity-2026-10.md`.


- **Demo company (2026-11-11).** `orgs.is_demo` (service-role only) marks the one fictional sales-demo org built by `npm run seed:company -- --demo`. `--reset` wipes ONLY a flagged org (`resetDemoOrg` + SQL `demo_reset_org`, dry-run by default; break-in test `lib/__tests__/demo-reset-breakin.test.ts`). Demo orgs never send real email/SMS (logged only), use Stripe test keys, a read-only AI connector, and no QuickBooks/Telnyx. Every send names its sending org: `getMailTransport(orgId)` (`lib/setter-email.ts`) is the ONE SMTP door and `isDemoSenderOrg` / `demoStatusOf` (`lib/demo-org.ts`) the one demo check (unknown status throws; a test fails on any org-less call). Tour: `docs/demo-walkthrough.md`.
