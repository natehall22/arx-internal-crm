# Release batch 2026-10 (branch `release/2026-10-batch`)

Rules: every PR targets this branch (not `main`), has its own branch, tests, bug-bot + collateral review, `/code-review` + `/security-review`, mobile-standard Playwright checks, **no merging to `main`** until Nathan says so. Canvass app is the model and is left as it is. Design files: `docs/design/`.

**Apply order when the batch is approved:** migrations in filename order, then data fixes. Nothing below is applied to prod yet unless it says so.

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

### Phase B — navigation, home, search — in progress
### Phase C — Customer File + Job Threads — not started (**screenshots for approval before any Phase C code**)
### Phase D — lists and queues — not started

## Payroll redesign (`docs/design/payroll-spec.md`, prototype `payroll-prototype.html`)
| PR | What | Migration |
|---|---|---|
| #77 `feat/payroll-engine-plan` | PR 2a: one calculation — `planPayrollPeriod` (no writes) + persist; preview-equals-approve tests | — |
| `feat/pay-this-week` | PR 2b: "Pay this week" replaces /admin/payroll; folds Pay periods & lock, Consultant statements, Weekly worksheet (hours + bonuses in Needs you); Approve = `lockPayrollPeriod` guarded by the shown total; CSV; old pages/routes deleted, old URLs redirect | none |
| next | PR 2c: "Fix a mistake" adjustment lines on next week (+ `payroll_adjustments`), chargebacks/balances; PR 3: rep "My pay" + "Something's wrong" | `payroll_adjustments`, `payroll_disputes` (additive) |
