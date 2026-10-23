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
### Phase C — Customer File + Job Threads — not started (**screenshots for approval before any Phase C code**)
### Phase D — lists and queues — not started

## Payroll redesign (`docs/design/payroll-spec.md`, prototype `payroll-prototype.html`)
| PR | What | Migration |
|---|---|---|
| #77 `feat/payroll-engine-plan` | PR 2a: one calculation — `planPayrollPeriod` (no writes) + persist; preview-equals-approve tests | — |
| `feat/pay-this-week` | PR 2b: "Pay this week" replaces /admin/payroll; folds Pay periods & lock, Consultant statements, Weekly worksheet (hours + bonuses in Needs you); Approve = `lockPayrollPeriod` guarded by the shown total; CSV; old pages/routes deleted, old URLs redirect | none |
| `feat/pay-adjustments` | PR 2c: "Fix a mistake" — signed lines on the next open week (a paid week never changes) + negative checks carried forward as balances; counted in the screen, statements, emails, PDF and CSV | `202610250010_payroll_adjustments.sql` (additive; **not applied**) |
| `feat/my-pay` | PR 3: rep "My pay" (/my-pay; This week / Coming with the reason / Paid, each line with its math) + "Something's wrong?" per line → admin's Needs you (reply or Add a fix); Money → My pay in the nav for commission roles | `202610250020_payroll_disputes.sql` (additive; **not applied**) |

## State 2026-10-22
`release/2026-10-batch` = main + UI stack (A, B) + payroll stack (#77–#80). tsc clean, jest 2035 pass. Settled-externally jobs are excluded from plan, preview, Approve and My pay (`payroll-settled-externally.test.ts`, `settled-externally-guards.test.ts`); preview == Approve covered by the pay-week approve tests.
**Pending batch migrations, apply order:** 202610240020_table_views, 202610240050_global_search, 202610250010_payroll_adjustments, 202610250020_payroll_disputes. Rollbacks: drop the new tables/function (all additive, no existing data touched).
**Next:** Customer File + Job Threads screenshots for approval (Phase C blocked on it), then Phase D, ABC item mapping, 2-week pay reconciliation (needs the external-pay figures).
