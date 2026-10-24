# Release batch 2026-10 (branch `release/2026-10-batch`)

Rules: every PR targets this branch (not `main`), has its own branch, tests, bug-bot + collateral review, `/code-review` + `/security-review`, mobile-standard Playwright checks, **no merging to `main`** until Nathan says so. Canvass app is the model and is left as it is. Design files: `docs/design/`.

**Apply order when the batch is approved:** migrations in filename order, then data fixes. Nothing below is applied to prod yet unless it says so.

## Shipped to main already (exceptions to the batch)
| PR | What | Applied |
|---|---|---|
| #70, #72, #73 | Default pay plans per role; defaults never pay inactive users; test-account flag + plan-ends-on-deactivation | migrations 202610240030, 202610240040 + data fixes (flag n8rhall; end plans for inactive users, backed up in `data_fix_backups`) applied 2026-10-23 |
| #81–#84 | Needs-you by role (server-side), removed from /whats-new; settled-externally jobs (38 pre-cutover jobs settled, 0 job rows left in Needs you); appointments >14 days hidden + owner-only "Close out old appointments" (100 pending, **not run**); owner-only Unsettle | migrations 202610250030, 202610260010, 202610260020, 202610260030 applied; rollback: clear `payroll_settled_externally_at` (Unsettle) / `outcome_not_recorded_at` |

## Pay plans (this batch)
| PR | What | Migration / data fix |
|---|---|---|
| #73 `feat/default-plan-rules` | Default-plan reps earn inspection / self-gen / manager-override lines like assigned reps (13% self-gen deal test); `users.is_test_account` (no plan, lines or credit); default applies only while active on the sale date and before a person's first assignment (ended plan = ended on purpose); Needs-you "plan ended" item | `202610240030_users_is_test_account.sql`, `202610240040_end_plan_on_deactivation.sql` (deactivation ends the user's open plan assignments; trigger), data fixes `2026-10-24_flag_test_accounts.sql` (n8rhall, ARX Measure Test Rep — pending OK), `2026-10-24_end_plans_for_inactive_users.sql` |
| #72 (merged to main, exception) | Defaults never pay inactive users | — |
| #70 (merged to main) | Org default pay plan per role | applied 2026-10-23 |

## UI overhaul
### Phase A — foundation
| PR | What | Migration |
|---|---|---|
| #71 `feat/ui-foundation` | `components/ui` kit, tokens, `lib/format.ts`, `lib/status.ts`, alert→toast / confirm→dialog, lint ratchet, saved views | `202610240020_table_views.sql` |

### Phase B — navigation, home, search — built on release (#74 nav, #75 search, #76 settings hub); migration `202610240050_global_search.sql` (additive, **not applied**; rollback `DROP FUNCTION search_all`)
### Phase C — Customer File + Job Threads — built (`feat/phase-c-core`), designs approved 2026-10-22
| Piece | What |
|---|---|
| Migration `202610270010_threads_audiences.sql` (additive; **not applied**) | `activities` gains audience / origin / restricted_pricing / priority / reply / pins / soft-delete / mentions columns; `threads`, `thread_members`; `notifications` gains thread/priority/resolved columns; `users.ui_prefs`; SQL `message_visible_to` (mirrors `lib/threads/visibility.ts`), RLS on `activities` (rows with NULL audience behave exactly as today), `search_messages`. Rollback: restore the old `activities` SELECT policy (`org_id = get_user_org_id(auth.uid()) AND referral_partner_id IS NULL`), drop the two functions and two tables; columns can stay. Dry-run in a rolled-back transaction on prod 2026-10-22 (role × audience matrix verified). |
| Customer File `/c/[customer]/d/[deal]/[tab]` | Header (stepper, next action, pinned alerts, deal switcher), lazy tabs Overview / Sales / Job / Money / Files (+ Notes on phones), role-default tab (remembered per user), thread rail. Sales and Job tabs are the existing opportunity and job pages re-shelled (`embedded`), so every existing action and permission check is kept. Prospect File `/c/lead/[lead]`. |
| Job Threads | Audiences Team / Sales / Production / Crew chosen automatically (chip is only a request), pricing guard, exact @mentions (picker offers only people who can read the audience), needs-reply / urgent (3 a day), Waiting-on-you on Today, pins (3 customer alerts), edit / 15-min delete / tombstone, reclassify, typo-tolerant search in Cmd-K that opens at the message, crew link shows Crew notes only. |
| Old note paths | `/api/ops/jobs/[id]/notes` is an adapter; packets, run sheet, dashboard, cancellation, supplier-order and project-handoff notes all read/write the thread (`lib/threads/job-notes.ts`). `production_job_notes` is no longer written. Subs portal still reads it (shared-with-sub notes only). |
| Customer at inspection booking | `customerIdForLead` links/creates the customer when a deal is created (4 routes). No QuickBooks event, `leads.customer_id` untouched. |
| Redirects | Old `/opportunities/[id]` (not queue mode), `/leads/[id]`, `/projects/[id]`, `/ops/jobs/[id]` → file, **off** until Vercel env `CUSTOMER_FILE_REDIRECTS` = `all` or a role list (`operations,admin`). Each hit is logged. |

**Data fixes, apply after the migration, in this order (previews dry-run on prod 2026-10-22, nothing written):**
1. `2026-10-27_link_orphan_opportunities.sql` — 363 opportunities have no customer. Preview: 2 join an existing customer by email, 35 by phone, 326 need a new customer = **314 new customers** (49 → 363 customers), 2 have no lead. After: 0 without a customer. Backup in `data_fix_backups`; rollback SQL in the file.
2. `2026-10-27_merge_notes_into_threads.sql` — classifies the 4,337 existing activities (human vs system; only 1 existing note is human-written, 4,135 are system rows) and copies **478** old notes into the timeline (104 job notes with 54 exact-name mentions parsed, 158 + 94 old opportunity notes, 17 lead notes that have a deal, 42 + 29 project notes, 31 job internal notes, 3 pinned special instructions). Idempotent (legacy_ref); 14 lead notes with no deal stay on the lead; canvass door notes are shown live. Rollback in the file.

### Phase D — lists and queues — built (`feat/phase-d-lists`)
| Piece | What |
|---|---|
| Shared DataTable | dropdown filters, built-in views (cannot be deleted), saved views that carry filters (`table_views.state.filters`, no schema change), server mode for big lists, per-row actions, phone cards |
| Lists on it | Customers (Customers / Prospects / Everyone views — customers now exist from inspection booking), Leads (server mode), Opportunities (record-page queue navigation keeps working: same `?queue=1&status=…` keys), Job Board list view, Work orders, Proposals, Subs, Job profit (money math stays on the server) |
| Appointments | one hub: `/appointments` (List) · `?view=calendar` · `?reschedule=ID`. `/calendar` and `/schedule` now redirect. Scheduling *setup* stays in Settings → Appointment scheduling |
| Jobs → Schedule | `/ops/schedule` = Board (sub dispatch) · `?view=calendar` (production calendar). `/ops/calendar` redirects. New nav item Jobs → Schedule |
| **Not merged (decision for Nathan)** | The Inside Sales queue is still two screens: the working conveyor `/inside-sales` (priority tiers, handoff context, booking modal) and the Inside Sales list on Opportunities (follow-up drawer). They overlap, but the conveyor is what Roda works from daily, so I did not fold or retire either without your OK. Recommendation: make the Opportunities tab link to the conveyor ("Start calling") and delete the duplicate cards after a week of use. |

## Payroll redesign (`docs/design/payroll-spec.md`, prototype `payroll-prototype.html`)
| PR | What | Migration |
|---|---|---|
| #77 `feat/payroll-engine-plan` | PR 2a: one calculation — `planPayrollPeriod` (no writes) + persist; preview-equals-approve tests | — |
| `feat/pay-this-week` | PR 2b: "Pay this week" replaces /admin/payroll; folds Pay periods & lock, Consultant statements, Weekly worksheet (hours + bonuses in Needs you); Approve = `lockPayrollPeriod` guarded by the shown total; CSV; old pages/routes deleted, old URLs redirect | none |
| `feat/pay-adjustments` | PR 2c: "Fix a mistake" — signed lines on the next open week (a paid week never changes) + negative checks carried forward as balances; counted in the screen, statements, emails, PDF and CSV | `202610250010_payroll_adjustments.sql` (additive; **not applied**) |
| `feat/my-pay` | PR 3: rep "My pay" (/my-pay; This week / Coming with the reason / Paid, each line with its math) + "Something's wrong?" per line → admin's Needs you (reply or Add a fix); Money → My pay in the nav for commission roles | `202610250020_payroll_disputes.sql` (additive; **not applied**) |

## SHIP RUNBOOK + ROLLBACK PLAN (written 2026-10-24, before anything is applied)

**Safety net (no manual backup was taken, by decision):** Supabase daily physical backups, latest verified `2026-10-23 10:15 UTC` (7 retained; the next one lands ~10:15 UTC / 6:15 am ET on the ship day). Every data fix also keeps its own old values in the private schema `release_backups` with a one-command undo (below). Everything the code needs from the database is additive.

**Vercel rollback target (current production):** deployment `https://arx-internal-1g2gqw1em-nathan-halls-projects-ef79f55c.vercel.app` (GitHub deployment 7268754739, commit `924f2cac30bd`, state success, 2026-10-23 02:35 UTC). To roll back: Vercel dashboard → Deployments → that deployment → Promote to Production (instant, no rebuild). The old code runs fine against the new schema (everything below is additive), so a code rollback never needs a database rollback.

**Apply order (Step 4):** 1) migrations in filename order; 2) smoke the CURRENT app against the new schema; 3) `link_orphan_opportunities('preview')` → read the match list → `('apply')`; 4) `merge_notes_into_threads('preview')` → `('apply')`; 5) merge to `main`, confirm Vercel deploy; 6) keep `CUSTOMER_FILE_REDIRECTS` and the ABC connector OFF.

| # | Migration | What it does | Safe to leave in place if the code is rolled back? | Undo (only if the DB itself must go back) |
|---|---|---|---|---|
| 1 | `202610240020_table_views` | new table | yes (unused) | `DROP TABLE table_views;` |
| 2 | `202610240050_global_search` | pg_trgm indexes + `search_all` | yes | `DROP FUNCTION search_all(uuid,text,text[],uuid,int);` + the 6 `idx_search_*` indexes |
| 3 | `202610250010_payroll_adjustments` | new table | yes | `DROP TABLE payroll_adjustments;` (after #4 and #6's trigger) |
| 4 | `202610250020_payroll_disputes` | new table | yes | `DROP TABLE payroll_disputes;` |
| 5 | `202610270010_threads_audiences` | new nullable columns on `activities`/`notifications`/`users`, `threads`, `thread_members`, `message_visible_to`, `search_messages`, and the **four `activities` RLS policies replaced** (legacy rows with `audience IS NULL` behave exactly as before; only the browser WRITE policies are tighter) | yes. The old app only writes legacy-style rows, which the new policies allow | restore the previous `activities` policies: read `org_id = get_user_org_id(auth.uid()) AND referral_partner_id IS NULL`; insert/update/delete `org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid()`; then `DROP FUNCTION message_visible_to, search_messages; DROP TABLE thread_members, threads;` (new columns may stay) |
| 6 | `202610280010_atomic_approve_and_field_role_deny` | `payroll_unit_earnings`, `payroll_periods.units_frozen_at`, claim-guard triggers on hours/bonus/fix tables, `payroll_week_person_totals`, `payroll_commit_week`, and **`can_view_job_board()` replaced** with a field-role deny | yes, with one caveat: the triggers refuse hours/bonus/fix writes on a week that is mid-approval (only while a lock claim is live, max 15 min). The old Approve never leaves a claim open longer than its request | drop the 3 triggers `trg_guard_claimed_period` and the 3 functions; `ALTER TABLE payroll_periods DROP COLUMN units_frozen_at; DROP TABLE payroll_unit_earnings;` and re-create `can_view_job_board` without the `field` CTE (previous body in the migration header) |

**Data fixes** (both leave exact backups in `release_backups`; both are previews until `'apply'` is called):
* `SELECT release_backups.undo_merge_notes_into_threads();` — restores every classified activity from its saved previous values and deletes only the copied notes nobody has touched (edited / removed / re-audienced / re-pinned / replied-to notes are kept and reported). **Run this first if both must be undone.**
* `SELECT release_backups.undo_link_orphan_opportunities();` — puts back `customer_id = NULL` only where the applied customer is still there, and deletes only the customers this run created that nothing else references (every foreign key to `customers` is checked).

**Dress rehearsal on production (2026-10-24, rolled back — nothing persisted; ~12 s):** all 6 migrations + both data fixes applied with their text md5-verified against the repo files; exactly 4 `activities` policies after; migrations alone changed no existing activity row; orphan fix: **362 orphans → 2 linked by email, 360 on 347 new customers (49 → 396), 1 phone match refused (names disagree), 0 orphans left**; notes fix: **4,138 activities classified, 479 notes copied**; no setter/canvasser can read any production, crew or pricing-flagged message; both undos restored activities (rows, bodies, all new columns NULL), opportunity links, customer count (49) and orphan count (362) EXACTLY; payroll commit/claim-guard tests T1–T8 passed on the production tables. **Counts differ from the 2026-10-22 preview (363 / 314 new customers / 478 notes) for two reasons:** (1) 34 of the old "phone matches" were one filler number (`2222222222`, a test customer) swallowing 34 real people — the filler rule and the names-must-agree rule now stop that, so those get their own customers; (2) the day's new data (+1 opportunity linked, +1 note).

**Smoke test after deploy (Step 5):** canvass (knock, book, offline sync), job page (all tabs), order-sheet send preview, Pay this week preview, rep My pay, Needs you (role-correct), reports, global search, a setter posting/reading a thread with production + pricing hidden. Any failure → promote the rollback deployment above, then report. `GET /api/health` with `Authorization: Bearer $CRON_SECRET` reports `schema.threads` and `schema.payrollAtomicApprove` (both must be `true`).

**PAYROLL_PAY_WEEK_ENABLED (default OFF) — ship tonight with the new payroll screens dark.** While the env var is unset or not `true`: `/admin/payroll` renders the OLD payroll hub (restored from main), the old Pay periods / Weekly worksheet / Consultant statements / hours pages and APIs are back with their old URLs (no redirects), the period `lock` action runs the OLD lock (`lib/legacy-payroll-lock.ts` + `lib/legacy-payroll-materialization.ts`, main's code), and the new surface is a 404: Pay this week + its APIs (`requirePayrollAdminApi`), `/my-pay`, `/api/me/pay`, `/api/me/pay/dispute`, and the nav "My pay" link. Migration #6 is additive and unused by the old flow except the writer triggers, which refuse hours/bonus/fix writes on a week mid-lock or already approved (the old flow never needed those). To turn on: set the var in Vercel and REDEPLOY (the old-URL redirects are read at build time). **Do not flip it on mid-way through the side-by-side:** weeks locked by the old lock have no frozen per-unit pay (`units_frozen_at` NULL), so turn it on at a week boundary and use the new Approve from the first fresh week on. Turn-on gate: Codex re-review passes + 2-week side-by-side with Andrew's paid-outside numbers matches to the cent. Delete the two `legacy-payroll-*` files when it is on for good (Known Redundancy in CLAUDE.md).

### Shipped 2026-10-24 (evening) — payroll OFF
Migrations 1–6 applied in order, then both data fixes, then `main` fast-forwarded `924f2cac → f33f922c`. Counts matched the rehearsal exactly: 362 orphan opportunities linked, 347 customers created (49 → 396), 4,138 activities classified, 479 notes copied. `PAYROLL_PAY_WEEK_ENABLED`, `CUSTOMER_FILE_REDIRECTS` and the ABC connector are all unset. Undo for the data fixes: `SELECT release_backups.undo_merge_notes_into_threads();` first, then `SELECT release_backups.undo_link_orphan_opportunities();`. Rollback target for code: deployment `924f2cac30bd` (Vercel → Promote to Production).

### OWED BEFORE PAYROLL TURNS ON (NOT shipped; all required)
1. **Parity test**: the legacy and new planners produce identical payout lines for the same inputs.
2. **Flag read at runtime** (the old-URL redirects in `next.config.js` are read at build time), or document the exact redeploy step: set `PAYROLL_PAY_WEEK_ENABLED=true` in Vercel → redeploy production → confirm `/admin/payroll` shows Pay this week and `/admin/payroll/periods` redirects to it.
3. **Flip only at a period boundary** (never mid-period).
4. **Legacy-locked weeks are shown from stored payout lines only, never recomputed** (they have no `units_frozen_at`).
5. **Per-company pay schedule setting**: weekly / biweekly / twice monthly (today the Wednesday-cutoff weekly schedule is hardcoded).
6. **Codex + Cursor payroll-only re-review** passes.
7. **2-week side-by-side** with Andrew's paid-outside numbers (one row per person per week) matches to the cent.
8. **1 week running alongside** the old payroll before it is the only path.
9. Then delete `lib/legacy-payroll-*` and the restored old pages/routes (CLAUDE.md Known Redundancy #15).

### QUEUED FOR THE NEXT RELEASE (from the 2026-10-24 security review, both LOW)
- Serve notification bodies **only through the redacting API**: browser clients can still read their own `notifications` rows straight from RLS and bypass the redaction (a stale 200-character copy can survive a role demotion). Remove the direct read path or store the body redacted at write time.
- Make the `?around=` pagination cursor in `app/api/threads/[dealId]/messages/route.ts` **opaque** (it currently exposes a message's creation timestamp and checks the target against the open deal, not the target's own deal).

**Findings from the external review (Cursor + Codex) and what was done** — see the table in the PR / chat summary; fixes are in commits `31c4a31f`, `92b0c3d2`, `2da2d528` on `release/2026-10-batch`.

## State 2026-10-22
`release/2026-10-batch` = main + UI stack (A, B) + payroll stack (#77–#80). tsc clean, jest 2035 pass. Settled-externally jobs are excluded from plan, preview, Approve and My pay (`payroll-settled-externally.test.ts`, `settled-externally-guards.test.ts`); preview == Approve covered by the pay-week approve tests.
**READY TO SHIP (after the review fixes) — apply order (migrations are additive; #5 tightens browser write policies on `activities` and #6 replaces `can_view_job_board` and adds claim-guard triggers — see the runbook above):**
1. `202610240020_table_views` · 2. `202610240050_global_search` · 3. `202610250010_payroll_adjustments` · 4. `202610250020_payroll_disputes` · 5. `202610270010_threads_audiences` · 6. `202610280010_atomic_approve_and_field_role_deny`
7. Data fix `2026-10-27_link_orphan_opportunities.sql` — now a preview-by-default function (`release_backups.link_orphan_opportunities('apply')`); counts per the rehearsal above
8. Data fix `2026-10-27_merge_notes_into_threads.sql` — preview-by-default (`release_backups.merge_notes_into_threads('apply')`)
8. Merge `release/2026-10-batch` to main, confirm the Vercel deploy, then smoke-test payroll, job page, order sheets, Needs you, reports, a thread post as setter and ops.
9. Optional switches after deploy: `CUSTOMER_FILE_REDIRECTS` (off), ABC connector (off), then run `npm run payroll:side-by-side` for the first two Pay-this-week previews.
Rollbacks: each migration/data fix lists its own (additive tables/columns can stay; policies and data fixes have exact SQL).
**Next:** 2-week pay reconciliation. The tool is built and tested (`npm run payroll:side-by-side -- --weeks 2 --template out.csv`, then fill `paid` and rerun with `--paid paid.csv --out report.md`: CRM vs paid per person per week, every difference to the cent, people on only one side listed). It needs the payroll migrations applied, so it runs at ship time against the first two Pay-this-week previews; I need the paid-outside figures from Andrew for those weeks.

**Phase C items from your original spec NOT built yet** (not in the BATCH list; say if you want them): make-a-task from a message, quiet hours + morning digest, iOS push with inline reply / web push, voice and photo messages, offline outbox, Share-to-ARX extension, @role mentions, measure tool / proposal builder as overlays (they still open their own pages), `/api/v1` read API + webhooks. Also open: Phase C data fixes touch only `opportunities.customer_id` — `projects.customer_id` / `production_jobs.customer_id` / `leads.customer_id` for those deals are untouched.

**No pushes yet:** per Nathan 2026-10-22 nothing is pushed or PR'd until the end (Vercel compute). Everything above is committed locally in worktrees under ~/arx-wt/ and merges locally into `release/2026-10-batch`.
