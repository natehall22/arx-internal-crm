# Cross-company break-in suite (S4) — coverage

`lib/__tests__/cross-company-breakin.test.ts` (harness `lib/test-helpers/breakin-harness.ts`), runs in `npm run gates` (jest, ~30 s).
Company A and B share one fake database; every A row in every table has the same id and marker values. Signed in as
B's owner (admin + super admin), every exported method of every `app/api/**/route.ts` and every server page with an
id in its address is called with A's ids in path, query and body. Fails on: A data in the response/props, an A row
changed or deleted, a row inserted into A (incl. child rows hung on A's parent), A storage paths / auth users / mail /
outbound calls, a B row pointing at A's id (`ALLOWED_XREF` lists the reasoned exceptions), or an rpc receiving A's id
that is not in `VERIFIED_RPCS` (SQL read and cited).

- **Three ways in:** B's own token on an unfenced address; B's token on A's web address (`alpha.<APP_BASE_DOMAIN>`); B's token with `X-Company-Code: alpha`.
- **Public links:** `[token]` routes/pages get B's own VALID token while every other id is A's (can a link be walked to A?).
- **Crons:** called with the real secret, both companies holding data; nothing written for one company may point at the other's records, no mail to one carries the other's data.
- **Real requests:** bodies/queries come from each route's own source (fields it reads) plus `FIXTURES` variants for enum/multi-resource routes; DELETE carries a body; uploads get real multipart with a real PNG.
- **Built-in control:** every handler first runs with B's OWN ids. The last column says whether that reached B's data (read B's record or wrote a B row) — so a refusal in the attack means "refused A's record", not "never got past input checks". The count is ratcheted in `scripts/breakin-reach-baseline.json` (may only rise; `BREAKIN_REACH_UPDATE=1` raises it).
- **Own record, A's references:** B's ids in path/`id`, A's ids in every other reference field and A's org_id — catches a B row moved into A or left pointing at A.
- **Stricter checks:** any read of an A row fails unless it is a listed load-then-check (`READ_THEN_CHECK`); a 2xx response carrying A's record id fails (`ECHO_OK` lists reasoned echoes); A's timestamps count as leaked data.
- **Middleware:** the real `middleware.ts` runs, then its forwarded headers go to a route (B on A's address, forged resolved header, unknown address, A's company code).
- **Proof the harness works:** planted-hole tests (leak, write, child insert, cross-reference, RLS emulation).
- Regenerate this table: `BREAKIN_REPORT=/tmp/a.json npx jest cross-company-breakin`.

## Holes found and fixed (2026-11-10, second pass)
4. **Mass assignment that moved rows into another company** (service client, raw body to update): `campaigns` PUT, `admin/data` PATCH campaign / proposal_template, `admin/crews` PATCH — `org_id` in the body re-homed the row. Now field allow-lists / `org_id` stripped. `estimates/[id]/lines` POST spread the body into the insert — now a shared field allow-list (`lib/estimate-line-fields.ts`).
5. **Stored references to another company's records** — one check now, `firstForeignRef` (`lib/supabase/org-db.ts`): `canvass/lead` closer (stored even with no inspection booked), `change-orders/create` project/job/contract, `measurements` opportunity, `lead-sources` campaign + auto-assignee, `admin/crews` foreman, `admin/roles` parent role, `projects/[id]` owner + customer, `admin/data` team region / user team, region, manager, role / campaign creator, estimate-line pricebook item; `leads` POST moved onto it.
6. `admin/data` 'sub' branches wrote to a `subcontractors` table that no migration creates and no screen calls — deleted.

## Holes found and fixed (2026-11-10, first pass)
1. `POST /api/opportunities/[id]/inspection-photos` created an `inspection_results` draft for any opportunity id; the table is unique on `opportunity_id`, so B could squat A's row (A's next submit then overwrote and re-homed it). Now 404 unless the opportunity is the caller's company's.
2. `POST /api/leads` accepted any `owner_user_id` (service-client insert) — a lead could be owned by another company's user. Owner must be a user of the caller's company.
3. `canvass/data` + `leads/scheduling-resources` read every company's `user_google_tokens`; now only this company's users. Org-scope baseline 197 → 194.

## Not exercised dynamically, assessed by reading code
- **Handlers whose control does not reach B's data** (column "no", 117 of 494: crons and webhooks that need their secret, AI routes switched off per account, pay-week routes behind `PAYROLL_PAY_WEEK_ENABLED`, sub-portal routes for a role B's owner is not, SMTP/env-dependent sends, and list endpoints that return nothing for this seed) are covered statically by the `org-scope` gate. The ones in files that still hold grandfathered unscoped chains had each remaining finding (`npm run org-scope:list`) checked at its call site: `inspections/status|schedule-close|reschedule`, `canvass/availability|team-availability`, `calendar/sync` — the unscoped chains are the Google-token helpers keyed on a user id taken from an org-scoped row (Known Redundancy #29) and appointment ids the route just created/loaded org-scoped; `contracts/sign` — every chain hangs off the signing-token contract; `sisu/incentives` — period ids from org-scoped rows; `ai/chat` — conversation update also keyed on the signed-in user; `admin/employee-agreements`, `payroll/deal-commission-roles` — ids from rows just loaded/saved org-scoped. No hole found.
- **Crons** mostly return early in the fake world (time windows, feature switches), so the cron pass is shallow; the per-cron company tests from S3 (`cron-orgs`, `morning-update-cron-orgs`, `promote-insurance-cron-orgs`, `company-recipient`) carry that.
- **Webhooks:** `abc-supply` needs its env secret (503 here; signature-checked, org from the stored connection). `webhooks/leads` exercised with B's real lead-source token: lead lands in B only.
- **SQL:** RPC bodies are verified by reading (`VERIFIED_RPCS`); RLS for user-token clients is emulated as "own company only", not proven — RLS policies are their own audit.
- **5 'use client' pages** (`proposals/[id]`, `commissions/statement/[periodId]`, `admin/teams/[id]/closers`, `admin/payroll/[periodId]/hours`, `dev-harness`) load through `/api`, covered above.

## Known residual (not a data leak)
On A's address or with A's company code, 44 handlers still answer B with **B's own** data (the "B on A's address" 200s below): the #3b hand-rolled-cookie routes and raw `auth.getUser` paths that do not pass through the company fence (`leads`, `canvass/data`, `admin/settings|crews|roofing-types|…`, `inspections/status`, `whoami`, …) plus public routes (`health`, `public/estimate/config`, `webhooks/leads` GET, logout). With host-only cookies only a Bearer token can reach them on a foreign address, and they stay scoped to the token's own company. Closing it = moving those routes onto `requireAuthApi` (Known Redundancy #3b).

## Coverage table

| Route | Method | B, own token | B on A's address | B + code alpha | Control reaches B's data |
|---|---|---|---|---|---|
| `/api/admin/announcements` | GET | 200 | 401 | 401 | yes |
| `/api/admin/announcements` | POST | 400 | 401 | 401 | no |
| `/api/admin/appointment-types` | DELETE | 200 | 401 | 401 | yes |
| `/api/admin/appointment-types` | GET | 200 | 401 | 401 | yes |
| `/api/admin/appointment-types` | POST | 200 | 401 | 401 | yes |
| `/api/admin/appointment-types` | PUT | 200 | 401 | 401 | yes |
| `/api/admin/appointments/closeout` | GET | 200 | 401 | 401 | yes |
| `/api/admin/appointments/closeout` | POST | 409 | 401 | 401 | yes |
| `/api/admin/backfill-customers` | GET | 200 | 401 | 401 | no |
| `/api/admin/backfill-customers` | POST | 200 | 401 | 401 | no |
| `/api/admin/canvass-territories` | GET | 200 | 200 | 200 | yes |
| `/api/admin/canvass-territories` | POST | 200 | 200 | 200 | yes |
| `/api/admin/canvass-territories/[id]` | DELETE | 200 | 200 | 200 | yes |
| `/api/admin/canvass-territories/[id]` | PATCH | 404 | 404 | 404 | yes |
| `/api/admin/comp-plan-overlays` | DELETE | 200 | 401 | 401 | no |
| `/api/admin/comp-plan-overlays` | PATCH | 200 | 401 | 401 | no |
| `/api/admin/comp-plan-overlays` | POST | 400 | 401 | 401 | no |
| `/api/admin/comp-plans/defaults` | GET | 200 | 401 | 401 | yes |
| `/api/admin/comp-plans/defaults` | POST | 404 | 401 | 401 | yes |
| `/api/admin/comp-rates` | GET | 200 | 401 | 401 | yes |
| `/api/admin/comp-rates` | POST | 200 | 401 | 401 | no |
| `/api/admin/crews` | DELETE | 200 | 200 | 200 | yes |
| `/api/admin/crews` | GET | 200 | 200 | 200 | yes |
| `/api/admin/crews` | PATCH | 400 | 400 | 400 | yes |
| `/api/admin/crews` | POST | 400 | 400 | 400 | yes |
| `/api/admin/dashboard-settings` | GET | 200 | 200 | 200 | yes |
| `/api/admin/dashboard-settings` | POST | 200 | 200 | 200 | yes |
| `/api/admin/data` | DELETE | 200 | 401 | 401 | yes |
| `/api/admin/data` | GET | 200 | 401 | 401 | yes |
| `/api/admin/data` | PATCH | 200/400/404 | 401 | 401 | yes |
| `/api/admin/data` | POST | 400/200 | 401 | 401 | yes |
| `/api/admin/email-blasts` | GET | 200 | 500 | 500 | yes |
| `/api/admin/email-blasts` | PUT | 200 | 500 | 500 | yes |
| `/api/admin/email-blasts/morning-update/test` | POST | 400 | 500 | 500 | no |
| `/api/admin/email-blasts/resend-today` | POST | 400 | 500 | 500 | yes |
| `/api/admin/employee-agreements` | GET | 404 | 401 | 401 | yes |
| `/api/admin/employee-agreements` | PATCH | 400 | 401 | 401 | yes |
| `/api/admin/employee-agreements` | POST | 400 | 401 | 401 | no |
| `/api/admin/financing-programs` | DELETE | 200 | 200 | 200 | yes |
| `/api/admin/financing-programs` | GET | 200 | 200 | 200 | yes |
| `/api/admin/financing-programs` | PATCH | 200 | 200 | 200 | yes |
| `/api/admin/financing-programs` | POST | 200 | 200 | 200 | yes |
| `/api/admin/goals` | GET | 200 | 401 | 401 | no |
| `/api/admin/goals` | PUT | 200 | 401 | 401 | yes |
| `/api/admin/goals/forecast` | GET | 200 | 401 | 401 | yes |
| `/api/admin/goals/scorecard` | GET | 200 | 401 | 401 | yes |
| `/api/admin/incentives` | GET | 404/200 | 401 | 401 | yes |
| `/api/admin/incentives` | PATCH | 400/200 | 401 | 401 | yes |
| `/api/admin/incentives` | POST | 400/200/404 | 401 | 401 | yes |
| `/api/admin/incentives/badges/[id]/image` | DELETE | 404 | 401 | 401 | yes |
| `/api/admin/incentives/badges/[id]/image` | POST | 404 | 401 | 401 | yes |
| `/api/admin/inspection-feedback` | GET | 200 | 500 | 500 | no |
| `/api/admin/inspection-feedback/resend` | POST | 400 | 500 | 500 | no |
| `/api/admin/inspection-feedback/resend-all` | POST | 200 | 500 | 500 | no |
| `/api/admin/job-page-v2` | POST | 404 | 401 | 401 | yes |
| `/api/admin/job-setup/trades` | GET | 200 | 403 | 403 | yes |
| `/api/admin/job-setup/trades` | POST | 400 | 403 | 403 | yes |
| `/api/admin/logo` | DELETE | 200 | 401 | 401 | yes |
| `/api/admin/logo` | POST | 200 | 401 | 401 | yes |
| `/api/admin/money-access` | GET | 200 | 403 | 403 | yes |
| `/api/admin/money-access` | POST | 404 | 403 | 403 | yes |
| `/api/admin/payroll/[periodId]/hours` | GET | 404 | 401 | 401 | yes |
| `/api/admin/payroll/[periodId]/hours` | POST | 404 | 401 | 401 | yes |
| `/api/admin/payroll/bonus-lines` | GET | 200 | 401 | 401 | no |
| `/api/admin/payroll/bonus-lines/[bonusLineId]/status` | PATCH | 404 | 401 | 401 | yes |
| `/api/admin/payroll/consultants` | GET | 200 | 401 | 401 | yes |
| `/api/admin/payroll/deal-commission-roles` | GET | 200 | 401 | 401 | yes |
| `/api/admin/payroll/deal-commission-roles` | PATCH | 404 | 401 | 401 | yes |
| `/api/admin/payroll/export` | GET | 200 | 401 | 401 | yes |
| `/api/admin/payroll/inspection-rate` | GET | 200 | 401 | 401 | no |
| `/api/admin/payroll/inspection-rate` | PATCH | 200 | 401 | 401 | yes |
| `/api/admin/payroll/pay-week` | GET | 404 | 404 | 404 | no |
| `/api/admin/payroll/pay-week/adjustment` | DELETE | 404 | 404 | 404 | no |
| `/api/admin/payroll/pay-week/adjustment` | POST | 404 | 404 | 404 | no |
| `/api/admin/payroll/pay-week/approve` | POST | 404 | 404 | 404 | no |
| `/api/admin/payroll/pay-week/bonus` | POST | 404 | 404 | 404 | no |
| `/api/admin/payroll/pay-week/csv` | GET | 404 | 404 | 404 | no |
| `/api/admin/payroll/pay-week/dispute` | POST | 404 | 404 | 404 | no |
| `/api/admin/payroll/pay-week/email` | POST | 404 | 404 | 404 | no |
| `/api/admin/payroll/pay-week/hours` | POST | 404 | 404 | 404 | no |
| `/api/admin/payroll/periods` | GET | 200 | 401 | 401 | yes |
| `/api/admin/payroll/periods` | POST | 200 | 401 | 401 | yes |
| `/api/admin/payroll/periods/[periodId]` | PATCH | 404 | 401 | 401 | yes |
| `/api/admin/payroll/self-generated` | PATCH | 404 | 401 | 401 | yes |
| `/api/admin/payroll/statements/email` | POST | 503 | 401 | 401 | no |
| `/api/admin/payroll/weekly/worksheet` | GET | 200 | 401 | 401 | yes |
| `/api/admin/presets` | DELETE | 404 | 404 | 404 | yes |
| `/api/admin/presets` | GET | 200 | 200 | 200 | yes |
| `/api/admin/presets` | POST | 200 | 200 | 200 | yes |
| `/api/admin/presets` | PUT | 404 | 404 | 404 | yes |
| `/api/admin/pricing` | DELETE | 200/400 | 200/400 | 200/400 | yes |
| `/api/admin/pricing` | GET | 200 | 200 | 200 | yes |
| `/api/admin/pricing` | PATCH | 200 | 200 | 200 | yes |
| `/api/admin/pricing` | POST | 200/404/400 | 200/404/400 | 200/404/400 | yes |
| `/api/admin/pricing/items/[id]/image` | DELETE | 404 | 401 | 401 | yes |
| `/api/admin/pricing/items/[id]/image` | POST | 404 | 401 | 401 | yes |
| `/api/admin/proposals` | DELETE | 200/400 | 200/400 | 200/400 | yes |
| `/api/admin/proposals` | GET | 200 | 200 | 200 | yes |
| `/api/admin/proposals` | PATCH | 200/400 | 200/400 | 200/400 | yes |
| `/api/admin/proposals` | POST | 200/400 | 200/400 | 200/400 | yes |
| `/api/admin/repair-contract-project` | POST | 404 | 401 | 401 | yes |
| `/api/admin/roles` | DELETE | 404 | 404 | 404 | yes |
| `/api/admin/roles` | GET | 200 | 200 | 200 | yes |
| `/api/admin/roles` | POST | 400 | 400 | 400 | yes |
| `/api/admin/roles` | PUT | 400 | 400 | 400 | yes |
| `/api/admin/roofing-types` | DELETE | 200 | 200 | 200 | yes |
| `/api/admin/roofing-types` | GET | 200 | 200 | 200 | yes |
| `/api/admin/roofing-types` | PATCH | 200 | 200 | 200 | yes |
| `/api/admin/roofing-types` | POST | 200 | 200 | 200 | yes |
| `/api/admin/scheduling` | DELETE | 200 | 200 | 200 | yes |
| `/api/admin/scheduling` | GET | 200 | 200 | 200 | yes |
| `/api/admin/setter-ramp` | GET | 200 | 401 | 401 | yes |
| `/api/admin/setter-ramp` | PATCH | 200 | 401 | 401 | yes |
| `/api/admin/setter-ramp` | POST | 404 | 401 | 401 | yes |
| `/api/admin/settings` | GET | 200 | 200 | 200 | yes |
| `/api/admin/settings` | PATCH | 400/200 | 400/200 | 400/200 | yes |
| `/api/admin/sisu/accountability` | GET | 200 | 401 | 401 | no |
| `/api/admin/sisu/goals` | PUT | 404 | 401 | 401 | yes |
| `/api/admin/sisu/seed-badges` | POST | 200 | 401 | 401 | yes |
| `/api/admin/subs` | DELETE | 200 | 401 | 401 | yes |
| `/api/admin/subs` | GET | 200 | 401 | 401 | yes |
| `/api/admin/subs` | PATCH | 200 | 401 | 401 | yes |
| `/api/admin/subs` | POST | 200 | 401 | 401 | yes |
| `/api/admin/suppliers` | GET | 200 | 401 | 401 | yes |
| `/api/admin/suppliers` | POST | threw | 401 | 401 | no |
| `/api/admin/suppliers/[id]/api` | GET | 200 | 401 | 401 | yes |
| `/api/admin/suppliers/[id]/api` | PUT | 404 | 401 | 401 | yes |
| `/api/admin/team-closer-queue` | DELETE | 200 | 401 | 401 | yes |
| `/api/admin/team-closer-queue` | GET | 200 | 401 | 401 | yes |
| `/api/admin/team-closer-queue` | POST | 404 | 401 | 401 | yes |
| `/api/admin/team-closer-queue` | PUT | 200 | 401 | 401 | yes |
| `/api/admin/user-permissions` | GET | 404 | 401 | 401 | yes |
| `/api/admin/user-permissions` | PUT | 404 | 401 | 401 | yes |
| `/api/admin/users` | DELETE | 404 | 401 | 401 | yes |
| `/api/admin/users` | GET | 200 | 401 | 401 | yes |
| `/api/admin/users` | PATCH | 400 | 401 | 401 | no |
| `/api/admin/users` | POST | 403 | 401 | 401 | yes |
| `/api/admin/users` | PUT | 404 | 401 | 401 | yes |
| `/api/ai` | POST | 403 | 401 | 401 | no |
| `/api/ai/chat` | GET | 403 | 401 | 401 | no |
| `/api/ai/chat` | POST | 403 | 401 | 401 | no |
| `/api/ai/chat/conversations` | DELETE | 403 | 401 | 401 | no |
| `/api/ai/chat/conversations` | GET | 403 | 401 | 401 | no |
| `/api/ai/chat/feedback` | POST | 403 | 401 | 401 | no |
| `/api/ai/detect-roof` | POST | 400 | 500 | 500 | yes |
| `/api/ai/extract-exterior-measure` | POST | 404 | 500 | 500 | yes |
| `/api/ai/generate-estimate` | POST | 400 | 500 | 500 | yes |
| `/api/ai/sanity-check` | GET | 404 | threw | threw | yes |
| `/api/ai/scope` | POST | 404 | threw | threw | yes |
| `/api/ai/solar-rgb-overlay` | GET | 500 | 401 | 401 | yes |
| `/api/announcements/[id]/dismiss` | POST | 404 | 401 | 401 | yes |
| `/api/announcements/active` | GET | 200 | 401 | 401 | no |
| `/api/appointments` | GET | 200 | 200 | 200 | yes |
| `/api/appointments/[id]` | GET | 404 | 404 | 404 | yes |
| `/api/appointments/[id]` | PATCH | 404 | 404 | 404 | yes |
| `/api/auth/google` | GET | 503 | 503 | 503 | no |
| `/api/auth/google/callback` | GET | 307 | 307 | 307 | no |
| `/api/auth/google/finish` | GET | 404 | 307 | 404 | no |
| `/api/auth/login` | GET | 302 | 302 | 302 | no |
| `/api/auth/login` | POST | 303 | 303 | 303 | no |
| `/api/auth/logout` | GET | 303 | 303 | 303 | no |
| `/api/auth/logout` | POST | 200 | 200 | 200 | no |
| `/api/auth/refresh` | POST | 401 | 401 | 401 | no |
| `/api/calendar/profile` | GET | 200 | 200 | 200 | yes |
| `/api/calendar/sync` | GET | 404 | 404 | 404 | yes |
| `/api/calendar/sync` | POST | 404 | 404 | 404 | yes |
| `/api/campaigns` | DELETE | 404 | 401 | 401 | yes |
| `/api/campaigns` | GET | 200 | 401 | 401 | no |
| `/api/campaigns` | POST | 200 | 401 | 401 | yes |
| `/api/campaigns` | PUT | 404 | 401 | 401 | yes |
| `/api/canvass/availability` | GET | 404 | 500 | 500 | yes |
| `/api/canvass/data` | GET | 200 | 200 | 200 | yes |
| `/api/canvass/import` | POST | 200 | 401 | 401 | yes |
| `/api/canvass/lead` | DELETE | 404 | 500 | 500 | yes |
| `/api/canvass/lead` | POST | 409 | 500 | 500 | yes |
| `/api/canvass/leads/viewport` | GET | 200 | 200 | 200 | no |
| `/api/canvass/leads/viewport` | POST | 200 | 200 | 200 | yes |
| `/api/canvass/reverse-geocode` | GET | 400 | 401 | 401 | no |
| `/api/canvass/reverse-geocode` | POST | 502 | 401 | 401 | no |
| `/api/canvass/roof-age` | GET | 200 | 401 | 401 | no |
| `/api/canvass/scheduling-meta` | GET | 200 | 401 | 401 | yes |
| `/api/canvass/solar` | GET | 200 | 401 | 401 | no |
| `/api/canvass/solar/verify` | POST | 404 | 401 | 401 | no |
| `/api/canvass/team-availability` | GET | 404 | 401 | 401 | yes |
| `/api/canvass/weather` | GET | 400 | 401 | 401 | no |
| `/api/change-orders/[id]/regenerate-pdf` | POST | 404 | 500 | 500 | yes |
| `/api/change-orders/create` | POST | 404 | 500 | 500 | yes |
| `/api/change-orders/sign` | POST | 200 | 200 | 200 | yes |
| `/api/close-appointments/context` | GET | 404 | 404 | 404 | yes |
| `/api/close-appointments/outcomes` | GET | 200 | 200 | 200 | no |
| `/api/close-appointments/submit` | POST | 404 | 404 | 404 | yes |
| `/api/coaching/goals` | GET | 200 | 500 | 500 | no |
| `/api/coaching/goals` | PUT | 404 | 500 | 500 | yes |
| `/api/coaching/trend` | GET | 200 | 500 | 500 | yes |
| `/api/commissions/estimator-adders` | GET | 200 | 401 | 401 | no |
| `/api/commissions/periods` | GET | 200 | 401 | 401 | yes |
| `/api/commissions/statement` | GET | 404 | 401 | 401 | yes |
| `/api/commissions/team-members` | GET | 200 | 401 | 401 | yes |
| `/api/commissions/weekly` | GET | 200 | 401 | 401 | no |
| `/api/comp-agreements/sign/[token]` | POST | 303 | 303 | 303 | no |
| `/api/company-logo` | GET | 404 | 404 | 404 | no |
| `/api/contracts/create` | POST | 404 | 401 | 401 | yes |
| `/api/contracts/sign` | POST | 200 | 200 | 200 | yes |
| `/api/crew/[token]/photos/finalize` | POST | 400 | 400 | 400 | yes |
| `/api/crew/[token]/photos/register` | POST | 500 | 500 | 500 | yes |
| `/api/cron/cleanup-inspection-photos` | GET | 401 | 401 | 401 | no |
| `/api/cron/cleanup-report-photos` | GET | 401 | 401 | 401 | no |
| `/api/cron/founder-contacts-digest` | GET | 401 | 401 | 401 | no |
| `/api/cron/instant-estimate-accuracy` | GET | 401 | 401 | 401 | no |
| `/api/cron/lidar-ingest` | POST | 401 | 401 | 401 | no |
| `/api/cron/morning-update` | GET | 401 | 401 | 401 | no |
| `/api/cron/promote-insurance-follow-ups` | GET | 401 | 401 | 401 | no |
| `/api/cron/referral-partners` | GET | 401 | 401 | 401 | no |
| `/api/cron/storm-opportunity-alerts` | GET | 401 | 401 | 401 | no |
| `/api/cron/sync-setter-ramp` | GET | 401 | 401 | 401 | no |
| `/api/cron/weather-refresh` | GET | 401 | 401 | 401 | no |
| `/api/cron/weather-swaths-ingest` | POST | 401 | 401 | 401 | no |
| `/api/customers/[id]` | GET | 404 | 401 | 401 | yes |
| `/api/customers/[id]` | PATCH | 404 | 401 | 401 | yes |
| `/api/customers/[id]/add-on-opportunity` | POST | 404 | 401 | 401 | yes |
| `/api/customers/link` | POST | 400 | 401 | 401 | yes |
| `/api/customers/search` | GET | 200 | 401 | 401 | yes |
| `/api/customers/sources` | GET | 200 | 401 | 401 | yes |
| `/api/dashboard/attached-sales` | GET | 200 | 500 | 500 | yes |
| `/api/dashboard/ops` | GET | 200 | 500 | 500 | yes |
| `/api/dashboard/ops-metrics` | GET | 200 | 401 | 401 | no |
| `/api/dashboard/personal-stats` | GET | 200 | 500 | 500 | no |
| `/api/dashboard/team-stats` | GET | 200 | 200 | 200 | yes |
| `/api/env-check` | GET | 200 | 401 | 401 | no |
| `/api/estimates` | POST | 404 | 500 | 500 | yes |
| `/api/estimates/[id]` | PATCH | 200 | threw | threw | yes |
| `/api/estimates/[id]/lines` | POST | 404 | threw | threw | yes |
| `/api/estimates/[id]/lines/[lineId]` | DELETE | 200 | threw | threw | yes |
| `/api/estimates/[id]/lines/[lineId]` | PATCH | 200 | threw | threw | yes |
| `/api/estimates/[id]/pdf` | POST | 404 | 401 | 401 | yes |
| `/api/feedback/submit` | POST | 500 | 401 | 401 | no |
| `/api/file-prefs` | POST | 400 | 401 | 401 | no |
| `/api/files/object` | GET | 404 | 401 | 401 | yes |
| `/api/files/signed/[kind]/[token]` | GET | 404 | 404 | 404 | yes |
| `/api/financing-programs` | GET | 200 | 200 | 200 | no |
| `/api/financing-programs/estimate` | GET | 404 | 404 | 404 | no |
| `/api/founder-week/contacts` | GET | 200 | 401 | 401 | no |
| `/api/founder-week/contacts` | POST | 201 | 401 | 401 | yes |
| `/api/founder-week/tally` | GET | 200 | 401 | 401 | no |
| `/api/health` | GET | 200 | 200 | 200 | no |
| `/api/inspection-reports` | POST | 404 | 401 | 401 | yes |
| `/api/inspection-reports/[id]` | DELETE | 404 | 401 | 401 | yes |
| `/api/inspection-reports/[id]` | GET | 404 | 401 | 401 | yes |
| `/api/inspection-reports/[id]` | PATCH | 404 | 401 | 401 | yes |
| `/api/inspection-reports/[id]/pdf` | GET | 404 | 401 | 401 | yes |
| `/api/inspection-reports/[id]/pdf` | POST | 404 | 401 | 401 | yes |
| `/api/inspection-reports/[id]/photos` | POST | 404 | 401 | 401 | yes |
| `/api/inspection-reports/[id]/photos/[photoId]` | DELETE | 404 | 401 | 401 | yes |
| `/api/inspection-reports/[id]/send` | POST | 503 | 401 | 401 | no |
| `/api/inspections/dismiss-prompt` | POST | 404 | 401 | 401 | no |
| `/api/inspections/outcomes` | GET | 200 | 200 | 200 | no |
| `/api/inspections/reschedule` | POST | 404 | 401 | 401 | yes |
| `/api/inspections/schedule-close` | POST | 404 | 404 | 404 | yes |
| `/api/inspections/status` | GET | 200 | 200 | 200 | no |
| `/api/inspections/status` | POST | 404 | 404 | 404 | yes |
| `/api/invoices/[invoiceId]` | GET | 404 | 401 | 401 | yes |
| `/api/invoices/[invoiceId]` | PATCH | 404 | 401 | 401 | yes |
| `/api/invoices/[invoiceId]/payments` | GET | 404 | 401 | 401 | yes |
| `/api/invoices/[invoiceId]/payments` | POST | 404 | 401 | 401 | yes |
| `/api/invoices/[invoiceId]/pdf` | GET | 404 | 401 | 401 | yes |
| `/api/jobs/[id]/additional-scope` | DELETE | 200 | 500 | 500 | yes |
| `/api/jobs/[id]/additional-scope` | GET | 200 | 500 | 500 | yes |
| `/api/jobs/[id]/additional-scope` | POST | 404 | 500 | 500 | yes |
| `/api/jobs/[id]/contract` | GET | 404 | 401 | 401 | yes |
| `/api/jobs/[id]/files` | GET | 404 | 401 | 401 | yes |
| `/api/jobs/[id]/files` | POST | 404 | 401 | 401 | yes |
| `/api/jobs/[id]/files/[fileId]` | DELETE | 404 | 401 | 401 | yes |
| `/api/jobs/[id]/files/[fileId]` | GET | 404 | 401 | 401 | yes |
| `/api/jobs/[id]/files/[fileId]` | PATCH | 404 | 401 | 401 | yes |
| `/api/jobs/[id]/job-packet` | GET | 404 | 500 | 500 | yes |
| `/api/jobs/[id]/job-packet` | POST | 404 | 500 | 500 | yes |
| `/api/jobs/[id]/material-order` | GET | 404 | 401 | 401 | yes |
| `/api/jobs/[id]/material-order` | PATCH | 404 | 401 | 401 | yes |
| `/api/jobs/[id]/review-request` | POST | 404 | 401 | 401 | yes |
| `/api/lead-sources` | DELETE | 404 | 401 | 401 | yes |
| `/api/lead-sources` | GET | 200 | 401 | 401 | yes |
| `/api/lead-sources` | POST | 400 | 401 | 401 | yes |
| `/api/lead-sources` | PUT | 404 | 401 | 401 | yes |
| `/api/leads` | GET | 200 | 200 | 200 | yes |
| `/api/leads` | POST | 400 | 400 | 400 | yes |
| `/api/leads/[id]` | DELETE | 404 | 404 | 404 | yes |
| `/api/leads/[id]` | GET | 404 | 404 | 404 | yes |
| `/api/leads/[id]/opportunity` | POST | 404 | 404 | 404 | yes |
| `/api/leads/[id]/schedule-inspection` | POST | 404 | 401 | 401 | yes |
| `/api/leads/scheduling-resources` | GET | 200 | 200 | 200 | yes |
| `/api/maps/nc-aerial` | GET | 404 | 401 | 401 | yes |
| `/api/maps/static-satellite` | GET | 400 | 401 | 401 | yes |
| `/api/maps/usgs-lidar` | GET | 502 | 401 | 401 | yes |
| `/api/me/effective-permissions` | GET | 200 | 401 | 401 | yes |
| `/api/me/pay` | GET | 404 | 404 | 404 | no |
| `/api/me/pay/dispute` | POST | 404 | 404 | 404 | no |
| `/api/measurements` | GET | 200 | 401 | 401 | yes |
| `/api/measurements` | POST | 404 | 401 | 401 | yes |
| `/api/measurements/[id]` | DELETE | 403 | 401 | 401 | yes |
| `/api/measurements/[id]` | GET | 403 | 401 | 401 | yes |
| `/api/measurements/solar-footprint` | GET | 200 | 401 | 401 | no |
| `/api/mobile/capabilities` | GET | 200 | 401 | 401 | yes |
| `/api/mobile/leads` | GET | 200 | 401 | 401 | yes |
| `/api/mobile/org-config` | GET | 200 | 401 | 401 | no |
| `/api/mobile/push-token` | DELETE | 200 | 401 | 401 | no |
| `/api/mobile/push-token` | POST | 400 | 401 | 401 | no |
| `/api/mobile/territories` | GET | 200 | 401 | 401 | yes |
| `/api/needs-you` | GET | 200 | 401 | 401 | yes |
| `/api/notifications` | GET | 200 | 401 | 401 | no |
| `/api/notifications` | PATCH | 200 | 401 | 401 | no |
| `/api/notifications/stream` | GET | 200 | 401 | 401 | no |
| `/api/opportunities` | GET | 200 | 401 | 401 | yes |
| `/api/opportunities/[id]` | DELETE | 404 | 401 | 401 | yes |
| `/api/opportunities/[id]` | GET | 404 | 401 | 401 | yes |
| `/api/opportunities/[id]` | PATCH | 404 | 401 | 401 | yes |
| `/api/opportunities/[id]/contract` | POST | 404 | 401 | 401 | yes |
| `/api/opportunities/[id]/design-pdf` | POST | 404 | 401 | 401 | yes |
| `/api/opportunities/[id]/inside-sales-follow-up` | POST | 404 | 404 | 404 | yes |
| `/api/opportunities/[id]/inspection-photos` | GET | 200 | 500 | 500 | yes |
| `/api/opportunities/[id]/inspection-photos` | POST | 404 | 500 | 500 | yes |
| `/api/opportunities/[id]/inspection-photos/[photoId]` | DELETE | 404 | 500 | 500 | yes |
| `/api/opportunities/[id]/inspection-result` | GET | 200 | 500 | 500 | yes |
| `/api/opportunities/[id]/inspection-result` | POST | 404 | 500 | 500 | yes |
| `/api/opportunities/[id]/measure` | GET | 404 | 500 | 500 | yes |
| `/api/opportunities/[id]/measure` | PUT | 404 | 500 | 500 | yes |
| `/api/opportunities/[id]/measure/lidar` | POST | 404 | 500 | 500 | yes |
| `/api/opportunities/[id]/measure/photos` | POST | 404 | 500 | 500 | yes |
| `/api/opportunities/[id]/proposals` | GET | 404 | 401 | 401 | yes |
| `/api/opportunities/[id]/sale-credit` | GET | 404 | 401 | 401 | yes |
| `/api/opportunities/inside-sales` | GET | 200 | 200 | 200 | yes |
| `/api/ops/checkups/[id]` | PATCH | 400 | 401 | 401 | yes |
| `/api/ops/install-schedule` | GET | 400 | 401 | 401 | yes |
| `/api/ops/install-schedule/assign` | POST | 404 | 401 | 401 | yes |
| `/api/ops/install-schedule/availability` | GET | 400 | 401 | 401 | yes |
| `/api/ops/install-schedule/unassign` | POST | 404 | 401 | 401 | yes |
| `/api/ops/jobs` | GET | 200 | 500 | 500 | yes |
| `/api/ops/jobs` | POST | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]` | DELETE | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]` | GET | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]` | PATCH | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/cancel` | DELETE | threw | 401 | 401 | yes |
| `/api/ops/jobs/[id]/cancel` | POST | threw | 401 | 401 | yes |
| `/api/ops/jobs/[id]/commission-payroll` | GET | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/completion-certificate` | GET | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/completion-certificate` | POST | 500 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/completion-certificate/send` | POST | 503 | 500 | 500 | no |
| `/api/ops/jobs/[id]/cost-attachments` | POST | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/cost-attachments/finalize` | POST | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/cost-attachments/register` | POST | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/cost-lines` | GET | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/cost-lines` | POST | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/cost-lines/[costLineId]` | DELETE | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/cost-lines/[costLineId]` | PATCH | 404 | 401 | 401 | no |
| `/api/ops/jobs/[id]/documents` | GET | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/documents` | POST | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/documents/[documentId]/download` | GET | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/documents/[documentId]/replace` | POST | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/documents/[documentId]/replace/finalize` | POST | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/documents/[documentId]/replace/register` | POST | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/documents/finalize` | POST | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/documents/register` | POST | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/financial-source` | PATCH | 400 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/force-paid` | DELETE | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/force-paid` | POST | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/invoices` | GET | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/invoices` | POST | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/material-order/pdf` | GET | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/materials-ordered` | DELETE | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/materials-ordered` | POST | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/measure` | GET | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/measure` | PUT | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/measure/lidar` | POST | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/measure/photos` | POST | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/notes` | GET | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/notes` | POST | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/owner` | GET | 200 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/owner` | PUT | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/packet` | GET | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/packet` | POST | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/payments` | GET | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/payments` | POST | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/payments/[paymentId]` | DELETE | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/permit` | PATCH | 400 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/photos` | GET | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/photos/[photoId]/download` | GET | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/photos/finalize` | POST | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/photos/register` | POST | 404 | 500 | 500 | yes |
| `/api/ops/jobs/[id]/run-sheet` | GET | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/run-sheet` | PATCH | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/run-sheet/email` | GET | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/run-sheet/email` | POST | 400 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/run-sheet/pdf` | GET | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/settled-externally` | DELETE | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/supplier-orders` | GET | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/supplier-orders` | PATCH | 400 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/supplier-orders/preview` | GET | 400 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/supplier-orders/received` | POST | 400 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/supplier-orders/send` | POST | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/trades` | GET | 404 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/trades` | PATCH | 400 | 401 | 401 | yes |
| `/api/ops/jobs/[id]/trades` | POST | 400 | 401 | 401 | yes |
| `/api/ops/scheduling-assignees` | GET | 200 | 500 | 500 | yes |
| `/api/org-logo/[orgId]` | GET | 404 | 404 | 404 | no |
| `/api/permissions` | DELETE | 404 | 401 | 401 | no |
| `/api/permissions` | GET | 200 | 401 | 401 | yes |
| `/api/permissions` | POST | 404 | 401 | 401 | no |
| `/api/projects/[id]` | DELETE | 404 | 401 | 401 | yes |
| `/api/projects/[id]` | PATCH | 400 | 401 | 401 | yes |
| `/api/projects/[id]/files` | POST | 404 | 401 | 401 | yes |
| `/api/projects/[id]/review` | POST | 404 | 401 | 401 | yes |
| `/api/proposals` | GET | 200 | 200 | 200 | yes |
| `/api/proposals/[id]` | DELETE | 404 | 404 | 404 | yes |
| `/api/proposals/[id]` | GET | 404 | 404 | 404 | yes |
| `/api/proposals/[id]` | PATCH | 404 | 404 | 404 | yes |
| `/api/proposals/[id]/create-project` | POST | 404 | 404 | 404 | yes |
| `/api/proposals/[id]/image` | DELETE | 404 | 401 | 401 | yes |
| `/api/proposals/[id]/image` | POST | 404 | 401 | 401 | yes |
| `/api/proposals/[id]/line-items/[itemId]` | PATCH | 404 | 404 | 404 | yes |
| `/api/proposals/builder` | GET | 200 | 200 | 200 | yes |
| `/api/proposals/builder` | POST | 400 | 400 | 400 | yes |
| `/api/proposals/builder` | PUT | 404 | 404 | 404 | yes |
| `/api/public/estimate/config` | GET | 200 | 200 | 200 | no |
| `/api/public/estimate/preview` | POST | 503 | 503 | 503 | no |
| `/api/public/estimate/unlock` | POST | 503 | 503 | 503 | no |
| `/api/r/[token]` | GET | 302 | 302 | 302 | yes |
| `/api/referral-partner-types` | GET | 200 | 401 | 401 | yes |
| `/api/referral-partner-types` | POST | 400 | 401 | 401 | yes |
| `/api/referral-partners` | GET | 200 | 401 | 401 | yes |
| `/api/referral-partners` | POST | 400 | 401 | 401 | yes |
| `/api/referral-partners/[id]` | GET | 404 | 401 | 401 | yes |
| `/api/referral-partners/[id]` | PATCH | 404 | 401 | 401 | yes |
| `/api/referral-partners/[id]/assignment` | POST | 404 | 401 | 401 | yes |
| `/api/referral-partners/[id]/touch` | POST | 400 | 401 | 401 | yes |
| `/api/referral-partners/import` | POST | 400 | 401 | 401 | yes |
| `/api/referral-partners/reports` | GET | 400 | 401 | 401 | yes |
| `/api/referral-partners/summary` | GET | 200 | 401 | 401 | yes |
| `/api/referrals` | DELETE | 200 | 200 | 200 | yes |
| `/api/referrals` | GET | 200 | 200 | 200 | no |
| `/api/referrals` | POST | 400 | 400 | 400 | no |
| `/api/referrals/[id]/link` | DELETE | 404 | 401 | 401 | yes |
| `/api/referrals/[id]/link` | POST | 404 | 401 | 401 | yes |
| `/api/referrals/[id]/status` | PATCH | 200 | 401 | 401 | yes |
| `/api/referrals/for-new-lead` | POST | 404 | 401 | 401 | yes |
| `/api/referrals/from-customer` | GET | 200 | 401 | 401 | yes |
| `/api/referrals/from-customer` | PATCH | 400 | 401 | 401 | yes |
| `/api/referrals/from-customer` | POST | 400 | 401 | 401 | yes |
| `/api/referrals/link-search` | GET | 200 | 401 | 401 | yes |
| `/api/referrals/referrer-search` | GET | 200 | 401 | 401 | yes |
| `/api/reports/forecast` | GET | 200 | 500 | 500 | yes |
| `/api/reports/forecast` | PATCH | 400 | 500 | 500 | yes |
| `/api/reports/run` | GET | 200 | 401 | 401 | yes |
| `/api/reports/run` | POST | 400 | 401 | 401 | yes |
| `/api/reports/saved` | DELETE | 200 | 401 | 401 | yes |
| `/api/reports/saved` | GET | 200 | 401 | 401 | yes |
| `/api/reports/saved` | POST | 400 | 401 | 401 | yes |
| `/api/search` | GET | 200 | 401 | 401 | yes |
| `/api/setter/acknowledge-result` | POST | 400 | 401 | 401 | no |
| `/api/setter/inspection-results` | GET | 200 | 401 | 401 | no |
| `/api/settings` | DELETE | 200 | 401 | 401 | yes |
| `/api/settings` | GET | 200 | 401 | 401 | yes |
| `/api/settings` | POST | 200 | 401 | 401 | yes |
| `/api/sisu/badges` | GET | 404 | 401 | 401 | yes |
| `/api/sisu/incentives` | GET | 200 | 401 | 401 | no |
| `/api/sisu/leaderboard` | POST | 400 | 401 | 401 | no |
| `/api/sisu/sync` | POST | 403 | 401 | 401 | no |
| `/api/subs/jobs` | GET | 403 | 401 | 401 | no |
| `/api/subs/jobs/[id]` | GET | 403 | 401 | 401 | no |
| `/api/subs/jobs/[id]` | PATCH | 403 | 401 | 401 | no |
| `/api/subs/work-orders/[id]/complete` | POST | 403 | 500 | 500 | no |
| `/api/table-views` | DELETE | 200 | 401 | 401 | yes |
| `/api/table-views` | GET | 200 | 401 | 401 | no |
| `/api/table-views` | POST | 200 | 401 | 401 | yes |
| `/api/threads/[dealId]/mentionable` | GET | 404 | 401 | 401 | yes |
| `/api/threads/[dealId]/messages` | GET | 404 | 401 | 401 | yes |
| `/api/threads/[dealId]/messages` | POST | 404 | 401 | 401 | yes |
| `/api/threads/[dealId]/read` | POST | 404 | 401 | 401 | yes |
| `/api/threads/messages/[id]` | PATCH | 404 | 401 | 401 | yes |
| `/api/threads/search` | GET | 200 | 401 | 401 | yes |
| `/api/threads/waiting` | GET | 200 | 401 | 401 | yes |
| `/api/threads/waiting/[id]` | POST | 400 | 401 | 401 | yes |
| `/api/trial-signup` | POST | 200 | 200 | 200 | no |
| `/api/user/comp-plan` | GET | 200 | 200 | 200 | no |
| `/api/users` | GET | 200 | 401 | 401 | yes |
| `/api/webhooks/abc-supply` | POST | 503 | 503 | 503 | no |
| `/api/webhooks/leads` | GET | 200 | 200 | 200 | no |
| `/api/webhooks/leads` | POST | 200 | 200 | 200 | yes |
| `/api/whoami` | GET | 200 | 200 | 200 | no |

### Server pages

| Page | | B, own token | B on A's address | B + code alpha | Control reaches B's data |
|---|---|---|---|---|---|
| `/app/c/[customerId]/d/[dealId]/[tab]/[jobTab]/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_NOT_FOUND | NEXT_NOT_FOUND | no |
| `/app/c/[customerId]/d/[dealId]/[tab]/n/[messageId]/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_NOT_FOUND | NEXT_NOT_FOUND | no |
| `/app/c/[customerId]/d/[dealId]/[tab]/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_NOT_FOUND | NEXT_NOT_FOUND | no |
| `/app/c/[customerId]/d/[dealId]/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_REDIRECT | NEXT_REDIRECT | yes |
| `/app/c/[customerId]/page.tsx` | PAGE | rendered | NEXT_REDIRECT | NEXT_REDIRECT | yes |
| `/app/c/lead/[leadId]/page.tsx` | PAGE | rendered | NEXT_REDIRECT | NEXT_REDIRECT | no |
| `/app/change-orders/sign/[token]/page.tsx` | PAGE | rendered | rendered | rendered | yes |
| `/app/comp-agreements/receipt/[token]/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_NOT_FOUND | NEXT_NOT_FOUND | no |
| `/app/comp-agreements/sign/[token]/page.tsx` | PAGE | rendered | rendered | rendered | yes |
| `/app/contracts/sign/[token]/page.tsx` | PAGE | rendered | rendered | rendered | yes |
| `/app/crew/[token]/page.tsx` | PAGE | rendered | rendered | rendered | yes |
| `/app/customers/[id]/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_REDIRECT | NEXT_REDIRECT | yes |
| `/app/estimates/[id]/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_REDIRECT | NEXT_REDIRECT | no |
| `/app/invoices/[invoiceId]/print/page.tsx` | PAGE | rendered | NEXT_REDIRECT | NEXT_REDIRECT | yes |
| `/app/leads/[id]/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_REDIRECT | NEXT_REDIRECT | no |
| `/app/opportunities/[id]/measure/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_REDIRECT | NEXT_REDIRECT | yes |
| `/app/opportunities/[id]/measure/print/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_REDIRECT | NEXT_REDIRECT | no |
| `/app/opportunities/[id]/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_REDIRECT | NEXT_REDIRECT | yes |
| `/app/opportunities/[id]/report/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_REDIRECT | NEXT_REDIRECT | no |
| `/app/ops/jobs/[id]/[tab]/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_NOT_FOUND | NEXT_NOT_FOUND | no |
| `/app/ops/jobs/[id]/measure/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_REDIRECT | NEXT_REDIRECT | yes |
| `/app/ops/jobs/[id]/measure/print/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_REDIRECT | NEXT_REDIRECT | yes |
| `/app/ops/jobs/[id]/orders/page.tsx` | PAGE | NEXT_REDIRECT | NEXT_REDIRECT | NEXT_REDIRECT | no |
| `/app/ops/jobs/[id]/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_REDIRECT | NEXT_REDIRECT | yes |
| `/app/ops/jobs/[id]/sheets/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_REDIRECT | NEXT_REDIRECT | yes |
| `/app/projects/[id]/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_REDIRECT | NEXT_REDIRECT | yes |
| `/app/r/[token]/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_NOT_FOUND | NEXT_NOT_FOUND | yes |
| `/app/referral-partners/[id]/page.tsx` | PAGE | rendered | NEXT_REDIRECT | NEXT_REDIRECT | yes |
| `/app/subs/jobs/[id]/page.tsx` | PAGE | NEXT_REDIRECT | NEXT_REDIRECT | NEXT_REDIRECT | no |
| `/app/work-orders/[id]/page.tsx` | PAGE | NEXT_NOT_FOUND | NEXT_REDIRECT | NEXT_REDIRECT | no |

### Crons (real secret, both companies seeded)

| Cron | Method | Status |
|---|---|---|
| `/api/cron/cleanup-inspection-photos` | GET | 200 |
| `/api/cron/cleanup-report-photos` | GET | 200 |
| `/api/cron/founder-contacts-digest` | GET | 200 |
| `/api/cron/instant-estimate-accuracy` | GET | 503 |
| `/api/cron/lidar-ingest` | POST | 404 |
| `/api/cron/morning-update` | GET | 200 |
| `/api/cron/promote-insurance-follow-ups` | GET | 200 |
| `/api/cron/referral-partners` | GET | 200 |
| `/api/cron/storm-opportunity-alerts` | GET | 200 |
| `/api/cron/sync-setter-ramp` | GET | 200 |
| `/api/cron/weather-refresh` | GET | 200 |
| `/api/cron/weather-swaths-ingest` | POST | 200 |
