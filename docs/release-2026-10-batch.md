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

## State 2026-10-22
`release/2026-10-batch` = main + UI stack (A, B) + payroll stack (#77–#80). tsc clean, jest 2035 pass. Settled-externally jobs are excluded from plan, preview, Approve and My pay (`payroll-settled-externally.test.ts`, `settled-externally-guards.test.ts`); preview == Approve covered by the pay-week approve tests.
**READY TO SHIP — apply order (all migrations additive; data fixes after them):**
1. `202610240020_table_views` · 2. `202610240050_global_search` · 3. `202610250010_payroll_adjustments` · 4. `202610250020_payroll_disputes` · 5. `202610270010_threads_audiences` (also tightens the browser write policies on `activities`)
6. Data fix `2026-10-27_link_orphan_opportunities.sql` (363 opportunities → customers; +314 customers)
7. Data fix `2026-10-27_merge_notes_into_threads.sql` (classify 4,337 activities; copy 478 old notes; price-looking notes flagged)
8. Merge `release/2026-10-batch` to main, confirm the Vercel deploy, then smoke-test payroll, job page, order sheets, Needs you, reports, a thread post as setter and ops.
9. Optional switches after deploy: `CUSTOMER_FILE_REDIRECTS` (off), ABC connector (off), then run `npm run payroll:side-by-side` for the first two Pay-this-week previews.
Rollbacks: each migration/data fix lists its own (additive tables/columns can stay; policies and data fixes have exact SQL).
**Next:** 2-week pay reconciliation. The tool is built and tested (`npm run payroll:side-by-side -- --weeks 2 --template out.csv`, then fill `paid` and rerun with `--paid paid.csv --out report.md`: CRM vs paid per person per week, every difference to the cent, people on only one side listed). It needs the payroll migrations applied, so it runs at ship time against the first two Pay-this-week previews; I need the paid-outside figures from Andrew for those weeks.

**Phase C items from your original spec NOT built yet** (not in the BATCH list; say if you want them): make-a-task from a message, quiet hours + morning digest, iOS push with inline reply / web push, voice and photo messages, offline outbox, Share-to-ARX extension, @role mentions, measure tool / proposal builder as overlays (they still open their own pages), `/api/v1` read API + webhooks. Also open: Phase C data fixes touch only `opportunities.customer_id` — `projects.customer_id` / `production_jobs.customer_id` / `leads.customer_id` for those deals are untouched.

**No pushes yet:** per Nathan 2026-10-22 nothing is pushed or PR'd until the end (Vercel compute). Everything above is committed locally in worktrees under ~/arx-wt/ and merges locally into `release/2026-10-batch`.
