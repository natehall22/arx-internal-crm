# Commission statement v2 — 9/10 ship spec (ARX Roofing)

**Branch:** `feat/payroll-statement-v2` (do not merge until staging checklist complete)  

**Org:** ARX Roofing — roofing commission and hold rules, not solar/NTP milestone pay.  

**Layout reference (only):** A prior-company commission spreadsheet was used as a **visual/layout example** — wide per-deal row, multi-role column groups, header totals, deficit, and component breakdown chips. We are **not** adopting that company’s industry labels, plan rules, or terminology wholesale. This CRM uses **ARX** comp plans, hold rules, and copy from org settings / product data.

**Framework:** [payroll-commission-transparency-desire-paths.md](./payroll-commission-transparency-desire-paths.md) — human workflow first; pay data only via service APIs.

---

## ARX hold & release (product language)

| Status | Meaning | UI label |
|--------|---------|----------|
| `held_till_install` | Commission not fully released until install completes | **On hold** |
| `released` | Install done; commission released for payroll | **Released** |
| `paid` | Period marked paid | **Paid** |

**Not in scope for ARX statements:** Notice-to-proceed (NTP) tranche pay or partial commission at NTP. Optional DB columns (`ntp_date`, `ntp_commission_percent` on `production_jobs`) may exist for legacy/other workflows; **leave nullable** — no migration required. Statement UI does not surface NTP.

---

## Current quality (honest score — branch `feat/payroll-statement-v2`)

| Dimension | Branch (~) | Target |
|-----------|------------|--------|
| Routing & access | ~8/10 | 9/10 |
| UI shell | ~7/10 | 9/10 |
| Spreadsheet column fidelity | ~4–5/10 | 8/10 |
| Data pipeline (lock → lines) | **~7–8/10** (staging proof pending) | 9/10 |
| Trust / dispute prevention | ~6–7/10 | 9/10 |
| **Overall** | **~7/10** code · **~7.5–8/10** after staging | **9/10** |

**Staging gate (human):** Lock a real period → non-empty payout lines → export vs statement ± $0.01; dashboard hero vs statement API ± $0.01. See [payroll-statement-staging-env.md](./payroll-statement-staging-env.md).

---

## Layout reference → product mapping (generic)

Use the example sheet for **information architecture** (header band + wide deal grid + role columns), not for literal column names.

### Header (summary band) — pattern to keep

| Pattern from example | Product field / UI |
|----------------------|-------------------|
| Pay date | `period.scheduled_pay_date` |
| Rep name | `rep.name` |
| Period total | Sum of deal totals for viewing rep (role-filtered) |
| Deficit when chargebacks win | `totals.hasDeficit` |
| Component breakdown chips | `projectedBreakdown` — plan name, volume bonus, role labels (from comp data) |

### Per-deal row (wide layout target) — pattern to keep

| Pattern from example | Data source |
|----------------------|-------------|
| Customer + status | `customerName` + `commission_hold_status` → On hold / Released / Paid |
| Install date | `completed_at` when job is installed (not NTP) |
| Commissionable base | `commission_comp_base` from job snapshot |
| Per-role amounts | One row per participation (setter, closer, managers) |
| Override / premier | `deal_commission_roles` + payout line `comp_plan_snapshot` |

**Row grain:** One row per **role participation** on a job (setter + closer = two rows). Admin may edit overrides pre-lock.

---

## Desire paths — acceptance criteria (9/10)

### Rep: "What am I getting paid?"

1. Open Dashboard → Pay statement → latest or chosen period.
2. See header: pay date, name, total, deficit if any, projected breakdown (plan / volume bonus / role components).
3. Scroll deal table: every deal with **On hold**, **Released**, or **Paid** badge and dollar columns.
4. Answer without support: why a line is on hold until install, why net differs from gross (chargebacks), estimated vs official.
5. **Never** read `payroll_*` via browser Supabase.

**9/10 checks:**
- [ ] Non-empty deals after period lock with eligible jobs
- [ ] On-hold deals show correct status; amounts match locked payout lines (not a separate NTP tranche)
- [ ] Footer net = commission + hourly − chargebacks (single definition documented)
- [ ] "Estimated" when period open; "Official" when locked/paid
- [ ] Statement calculated timestamp visible

### Admin: "Run payroll for this period"

1. Create period → hours (hourly reps) → preview → lock → email → mark paid.
2. Lock generates snapshots + payout lines; response shows backfill counts.
3. Edit overrides pre-lock only; audit trail visible.
4. Reconcile totals vs commission export ± $0.01.

**9/10 checks:**
- [ ] Lock backfill + reopen clears artifacts (API)
- [ ] Overrides update preview and lock lines (`lockPayoutGrossAmount`)
- [ ] FM/SM additive after pool scale (never inside `collectParticipants` pool array)

### Manager: "How is my team doing?"

1. Team pay → pick period → read-only statement.
2. 403 outside hierarchy.

---

## P0 — Must ship (data + trust)

| ID | Work | Status on branch |
|----|------|------------------|
| P0-1 | Lock backfill → `payroll_job_snapshots` + `payroll_payout_lines` + `deal_commission_roles` backfill | **Done** — verify on staging |
| P0-2 | `comp_plan_snapshot` JSON: scaled amount, overrides, volume bonus, plan name (`ntp_split_available: false` sentinel only) | **Partial** — no NTP amounts (not used at ARX) |
| P0-3 | `buildPayrollStatement` estimated/final, role map, totals math | **Done** |
| P0-4 | Additive managers after `scaleCommissionsToPool` in lock | **Done** |
| P0-5 | Open-period preview (no payout writes) | **Done** |
| P0-6 | `lib/payroll-tier-key.ts` + shared export engine | **Done** |

## P1 — Spreadsheet parity & polish

| ID | Work | Effort |
|----|------|--------|
| P1-1 | Wide grid (grouped role columns on one job row) | L |
| P1-2 | Projected breakdown header polish | S |
| P1-3 | Held deals grouped or badged prominently | S |
| P1-4 | Row expand → calculation trace | M (expandable rows exist) |
| P1-5 | Freshness banner | S (done) |
| P1-6 | PDF/CSV export = on-screen totals | M |
| P1-7 | Widget: legacy `commissions` cards vs payroll hero disclaimer | S (partial) |

## P2 — Defer

- Full admin wide grid with all consultants’ roles on one row
- In-app dispute workflow per line
- Migrate all CommissionWidget summaries off legacy `commissions`
- Feature flag `payroll_statement_v2_*`
- Admin UI **Reopen period** (API exists)

---

## Collateral damage — do not touch in UI-only PRs

| Dangerous | Safe |
|-----------|------|
| `collectParticipants()` before pool scale | `PayrollStatementView` layout |
| `scaleCommissionsToPool` inputs | `lib/payroll-format.ts` labels |
| Export date-range semantics | Docs, copy |
| Browser Supabase on `payroll_*` | Statement pages via API only |

**Dual systems:** Dashboard hero uses payroll estimate/official; some widget period summaries still use legacy `commissions`. Label clearly (P1-7).

---

## Test gate (minimum before merge)

**Automated:** payroll Jest suites (~64 tests), `canViewPayrollStatement`, lock backfill, export reconcile fixture, send-statement guards.

**Manual:** Lock → statement vs export; dashboard vs statement; email smoke; cross-rep 403; on-hold badge on installed vs not-installed jobs.

---

## Definition of done (9/10) — ARX

A payroll admin and a rep can walk through one real period where:

1. Lock produces payout lines that match export for the same jobs (± $0.01).  
2. Rep statement shows plan-driven labels and **On hold / Released / Paid** (not NTP).  
3. Deficit banner math is correct when chargebacks apply.  
4. No pay data in browser Supabase on `payroll_*`.  
5. Inactive reps cannot use the app; managers cannot view out-of-hierarchy reps.  
6. Email + in-app official statement agree on net pay.
