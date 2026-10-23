# Release batch 2026-10 (branch `release/2026-10-batch`)

Rules: every PR targets this branch (not `main`), has its own branch, tests, bug-bot + collateral review, `/code-review` + `/security-review`, mobile-standard Playwright checks, **no merging to `main`** until Nathan says so. Canvass app is the model and is left as it is.

Legend: PR links are filled in as they open. "Migration" = additive SQL in `supabase/migrations`; **none are applied to prod until Nathan approves the batch** unless noted.

## UI overhaul

### Phase A — foundation
| PR | What | Migration / data fix |
|---|---|---|
| `feat/ui-foundation` | `components/ui` kit (Button, Badge/StatusPill, Card, Tabs, Dialog→bottom sheet, ConfirmDialog, DataTable w/ saved views + cards on mobile, FilterBar, EmptyState, Skeleton, Field/Input/Select/Textarea, PageHeader, Toast); tokens in `tailwind.config.ts` (additive — default palette untouched); `lib/format.ts` (org-timezone money/date/time/phone), `lib/status.ts` (one label+tone map; jobs delegate to `lib/job-status.ts`); 300 `alert()` → toast and 66 `confirm()` → `confirmDialog` outside canvass; ESLint: `alert`/`confirm` are errors, raw `toLocale*String` and text <14px are warnings (ratchet — existing ones are migrated as screens move to the kit) | `202610240020_table_views.sql` (saved views, additive) — **not applied** |

### Phase B — navigation, home, search — not started
### Phase C — Customer File + Job Threads — not started (**layout screenshots go to Nathan for approval before any Phase C code**)
### Phase D — lists and queues — not started

## Payroll redesign (earlier in this batch)
| PR | State |
|---|---|
| #70 Comp plan coverage (org default pay plan per role, "N people have no pay plan" in Needs you) | merged to `main` 2026-10-23, migration `202610240010` + default plans applied (Closer 7%, Setter 5%, FM 2.0 3%) |
| PR 2 "Pay this week" / PR 3 rep "My pay" | not started — needs the prototype |
