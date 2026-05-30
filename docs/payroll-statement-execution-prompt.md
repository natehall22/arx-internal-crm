# Master execution prompt — Payroll statements, admin edit, weekly email, accurate dashboard estimate

**Audience:** Seven parallel implementers (or agent workstreams) reporting to a senior coding executive.  
**Branch:** `feat/payroll-statement-v2` until 9/10 gate passes; do not merge to `main` without executive sign-off.  
**Framework:** [payroll-commission-transparency-desire-paths.md](./payroll-commission-transparency-desire-paths.md) + [payroll-statement-9-10-spec.md](./payroll-statement-9-10-spec.md).

## Tool assignment (team standard)

| Tool | When to use |
|------|-------------|
| **Cursor** | Initial design, scaffolding, multi-file implementation, parallel workstreams, branch integration, collateral sweeps, type-check/tests in repo. |
| **Claude** | Hard creative reasoning: lock backfill design, totals/invariants, auth & email semantics, PR review before merge, acceptance criteria disputes. |
| **Codex** | Surgical fixes only: single-file bugs, test additions, small refactors, copy/typing — **with a frozen spec**, no architecture changes. |

**Rule:** Architecture and cross-cutting payroll rules are decided in **Cursor + Claude review**, then implemented in **Cursor**. **Codex** does not own WS1/WS2 or change `collectParticipants` / pool cap behavior without executive sign-off.

---

## Executive summary (read first)

**Desired end state**

1. **Payroll/admin** runs a weekly (or configured) pay period, reviews and **edits** commission lines where needed, **locks** the period, then **emails each rep their pay statement** (HTML + optional PDF attachment).
2. **Reps** open the email or in-app link and see **exactly what they are being paid for** — every deal, every role credit, hourly hours if applicable, chargebacks, net pay — with plain-language status (on hold, paid, etc.).
3. **Hourly-only, commission-only, and hybrid** reps are all supported on the same statement model.
4. **Dashboard** still shows a **commission estimate** so reps stay engaged day-to-day; that number must be **as accurate as possible** and clearly labeled **estimated** vs **official** (locked statement).

**Not in scope for literal copy:** Industry-specific language from any reference spreadsheet; that image was **layout reference only**.

**Quality bar:** 9/10 production readiness — no ship with empty statements after lock, no org-wide pay data in browser Supabase, no silent pool-cap bugs.

---

## What already exists (do not rebuild)

| Area | Location |
|------|----------|
| DB: periods, payout lines, chargebacks, rep hours, deal roles | `supabase/migrations/121_*`, `134_*`, `135_*`, `136_*` |
| Pool cap, comp calculator | `lib/commission-payroll.ts`, `lib/calculate-commission-from-plan.ts`, `lib/payroll-export.ts` |
| Admin export / weekly worksheet | `/admin/payroll`, `/admin/payroll/weekly`, APIs under `app/api/admin/payroll/` |
| Statement API (read) | `GET /api/commissions/statement`, `lib/payroll-statement.ts` |
| Rep/admin UI shells | `/commissions/statement/[periodId]`, `/admin/payroll/statements`, hours, periods |
| Hours entry | `POST /api/admin/payroll/[periodId]/hours` |
| Access control | `lib/payroll-statement-access.ts`, `lib/payroll-admin-access.ts` |
| Email patterns elsewhere | `lib/setter-email`, job certificate email routes — reuse conventions |

**Critical gap:** Lock does **not** generate `payroll_job_snapshots` / `payroll_payout_lines`. Statements are often empty. **Workstream 1 fixes this.**

**Critical split:** `CommissionWidget` + `GET /api/commissions/weekly` read legacy `commissions` table. Official pay uses `payroll_*`. **Workstream 6 aligns dashboard estimate without breaking trust.**

---

## Non-negotiable guardrails

1. **Pay data reads/writes:** Service role via `createServiceClient()` in API routes — **never** browser Supabase on `payroll_payout_lines`, `payroll_rep_hours`, `deal_commission_roles`.
2. **Pool cap:** Only `sales_rep` / `setter` / `owner` in `collectParticipants()` for `scaleCommissionsToPool()`. Field/senior manager via `loadAdditiveDealCommissionParticipants()` **after** scaling.
3. **Hourly pay:** Never included in 18% pool cap (`POOL_CAP_EXCLUDED_PLAN_TYPES` in `lib/commission-payroll.ts`).
4. **Admin edit:** Pre-lock = editable grid; post-lock = immutable except documented **admin adjustment** workflow with audit (`payroll_override_audit`, `deal_commission_roles`, optional line regen).
5. **Rep trust:** Show calculation freshness, estimated vs final labels, and component breakdown from plan data — not hardcoded column names from a reference sheet.

---

## Seven workstreams

| WS | Primary build | Claude review | Codex |
|----|---------------|---------------|-------|
| 1 Lock backfill | Cursor | **Required** before merge | Tests only |
| 2 Statement API | Cursor | **Required** (totals math) | Tests only |
| 3 Admin edit UI | Cursor | Optional | UI nits |
| 4 Rep statement UX | Cursor | Optional | A11y/copy |
| 5 Email send | Cursor | **Required** (idempotency, PII) | Template typos |
| 6 Dashboard estimate | Cursor | **Required** (estimate vs official) | Test fixtures |
| 7 QA | Cursor agents | Sign-off checklist | Surgical fixes from CI |

### Workstream 1 — Lock backfill & payout line writer (OWNER: data pipeline)

**Mission:** When admin locks a period, persist immutable pay data reps will see.

**Tasks**

- On `PATCH /api/admin/payroll/periods/[periodId]` `{ action: 'lock' }`:
  - Determine eligible jobs for period (reuse weekly eligibility + cutoff rules; document any export-only differences).
  - For each job/participant: run export math (`collectParticipants`, `computeRawCommissionForParticipant`, `scaleCommissionsToPool`, then additive manager roles).
  - Insert `payroll_job_snapshots` + `payroll_payout_lines` per participant.
  - Backfill `deal_commission_roles` from `collectParticipants()` when no explicit row exists.
- Store per-line breakdown in `comp_plan_snapshot` JSONB: base, volume bonus, scaled amount, override, hold flags, role.
- Idempotent lock (re-run safe or reject if already locked with lines).
- Return counts: `{ jobsSnapshotted, linesCreated, repsAffected }`.

**Acceptance**

- After lock, `GET /api/commissions/statement` returns non-empty deals for reps with activity in period.
- Totals reconcile with admin commission export for same jobs ± $0.01.

**Do not:** Add manager roles to `collectParticipants()` pre-scale.

---

### Workstream 2 — Statement builder v2 (OWNER: API truth)

**Mission:** One canonical payload for UI, email, and PDF.

**Tasks**

- Extend `lib/payroll-statement.ts` / `PayrollStatementPayload`:
  - `projectedBreakdown` by comp component (labels from plan/org).
  - Per-deal: all roles rep participates in; breakdown fields from snapshot JSON.
  - Fix role map: `owner`/`sales_rep` → `closer` for `deal_commission_roles` joins.
  - Fix totals: document whether `grossCommission` is pre- or post-chargeback; no double subtraction.
- **Open period:** `mode: 'estimated'` — compute from same engine as export (no payout lines required).
- **Locked/paid:** `mode: 'final'` — read snapshots only, not live `production_jobs`.
- Add `statementCalculatedAt`, `periodStatus`, `dataFreshnessNote`.

**Acceptance**

- Rep with setter + closer lines on same job sees both.
- Hybrid rep sees commission section + hourly section.
- Deficit banner mathematically correct on fixture data.

---

### Workstream 3 — Admin editable statement (OWNER: payroll ops UX)

**Mission:** Payroll can fix the sheet before lock; not read-only.

**Tasks**

- `/admin/payroll/statements`: editable grid (not just single override input):
  - Edit override amounts, notes, premier fields on `deal_commission_roles`.
  - Edit hourly rows via existing hours API integration.
  - **Recalculate preview** button (calls preview API, does not lock).
- Block destructive edits when period `locked` or `paid`; show badge.
- Show override audit trail (`payroll_override_audit`) for selected rep/period.
- Bulk actions: optional “recalc all previews” for period.

**API**

- `PATCH /api/admin/payroll/deal-commission-roles` (exists — extend if needed).
- New: `POST /api/admin/payroll/periods/[periodId]/preview` — run engine, return statement-shaped JSON without persisting lines (or persist draft table if needed).

**Acceptance**

- Admin changes override → preview totals update before lock.
- After lock, edits blocked with clear message; only `payroll_override_audit` manual_adjustment path if product allows post-lock corrections (define with executive).

---

### Workstream 4 — Rep statement UX (OWNER: rep clarity)

**Mission:** Reps understand every dollar.

**Tasks**

- Improve `components/payroll/PayrollStatementView.tsx`:
  - Readable deal table (responsive); expandable row → “how calculated” (plan rate, base, bonus, pool cap applied Y/N).
  - Status badges: On hold, Released, Paid (via `lib/payroll-format.ts`).
  - Hourly section for hybrid/hourly with reg × rate, OT × 1.5.
  - Chargebacks listed with reason + linked job/customer.
  - Banner: **Official statement** vs **Estimate** based on `mode`.
- `/commissions/statement/[periodId]` — deep link from email (`?period_id=` already supported).

**Acceptance**

- Non-technical rep can answer: “Why is this deal $X?” without calling payroll.
- Mobile: horizontal scroll acceptable; summary cards readable.

---

### Workstream 5 — Weekly email delivery (OWNER: comms)

**Mission:** Admin/payroll emails statements to all reps in a period.

**Tasks**

- `POST /api/admin/payroll/periods/[periodId]/send-statements`
  - Auth: `isPayrollAdminRole`.
  - Period must be `locked` (or `paid`) — configurable; default locked only.
  - For each rep with payout lines OR hours in period:
    - Build statement via Workstream 2.
    - Render HTML email (template); optional PDF attachment (Workstream 7 or follow-up).
    - Send to `users.email` via existing email infra (`lib/setter-email` pattern or org email settings).
  - Log sends: new table `payroll_statement_deliveries` (period_id, user_id, sent_at, actor_id, status) — migration required.
  - Idempotency: “resend” allowed; track version/hash of statement sent.

**Admin UI**

- On periods page or statements page: **“Email all statements”** + per-rep **“Resend”**.
  - Progress UI; failure list (no email, bounce).

**Acceptance**

- Payroll locks period → clicks send → each rep receives email with correct net pay and link to in-app statement.
- Rep without email on file surfaced in admin UI, not silent fail.

---

### Workstream 6 — Dashboard estimate accuracy (OWNER: rep engagement)

**Mission:** Dashboard estimate stays; must be trustworthy and labeled.

**Tasks**

- **Single source of truth for math:** Reuse `calculateCommissionFromPlanForSale` + pool rules + eligibility where possible — do not duplicate ad hoc formulas in widget.
- **Phase A (minimum):** `GET /api/commissions/weekly` (or new `GET /api/commissions/estimate`) returns:
  - `estimatedWeekCommission` from **live eligible jobs** + comp plans (not legacy `commissions` table only).
  - `officialWeekToDate` from locked period payout lines if current week period locked.
  - `label: 'estimate' | 'official'`.
- **Phase B:** Update `CommissionWidget`:
  - Show “Estimated this week” vs “From pay statement” when official exists.
  - Link to Pay statement (exists).
  - For hourly/hybrid: include hours-to-date if period open (from `payroll_rep_hours` or projected hours).
- Keep legacy `commissions` reads only as fallback during migration with UI disclaimer.

**Acceptance**

- Closer on percentage plan: dashboard estimate within documented tolerance of export preview for same week.
- Widget never shows $0 for hybrid rep solely because plan type was “unsupported” while statement shows hourly.

**Do not:** Remove CommissionWidget; reps depend on it for motivation.

---

### Workstream 7 — QA, collateral, ship gate (OWNER: quality)

**Mission:** No production surprises.

**Tasks**

- Automated tests: `scaleCommissionsToPool`, `collectParticipants`, `payrollTierKey`, `buildPayrollStatement` fixtures, `computeHourlyEarnings`.
- Manual matrix: 15 scenarios in `payroll-statement-9-10-spec.md`.
- Collateral sweep: export route, weekly worksheet, ops job detail commission snapshot, `CommissionWidget`, dashboard weekly fetch.
- Feature flag: `payroll_statement_v2_enabled` per org optional.
- Rollback doc: disable email send + hide statement link.

**Ship gate checklist**

- [ ] Lock → lines → statement non-empty
- [ ] Admin edit → preview → lock → email → rep receives
- [ ] Hybrid + hourly on same statement
- [ ] Dashboard estimate labeled; no false $0
- [ ] Cross-org 403 on statement API
- [ ] No browser Supabase on payroll tables
- [ ] Type-check + payroll tests green

---

## Dependency graph

```
WS1 Lock backfill ──┬──► WS2 Statement builder ──┬──► WS4 Rep UX
                    │                            ├──► WS5 Email
WS3 Admin edit ─────┘ (preview uses WS2)         └──► WS7 QA

WS6 Dashboard estimate (parallel; consumes WS2 math helpers when ready)
```

**Merge order:** WS1 → WS2 → WS3 + WS4 + WS5 (parallel) → WS6 → WS7 sign-off.

---

## Reference: desire paths (human workflows)

### Payroll admin — weekly cycle

1. Create/open pay period.
2. Enter hours for hourly/hybrid reps (`/admin/payroll/[periodId]/hours`).
3. Review/edit statements per rep (`/admin/payroll/statements`) — overrides, preview recalc.
4. Run weekly worksheet for exceptions (`/admin/payroll/weekly`).
5. **Lock** period (snapshots written).
6. **Email statements** to all reps; handle failures.
7. Mark period **paid**.

### Rep — day to day

1. Dashboard: **estimated** earnings (accurate pipeline).
2. When payroll sends email: open link → **official** statement for period.
3. Understand each deal line + hourly + chargebacks → net pay.

### Manager

1. `/commissions/team` → view report statement (read-only, no email send).

---

## Prompt to paste for each coder/agent (Cursor)

```text
You are coder [N] on the payroll statement program for arx-internal-crm.
TOOL: Implement in Cursor. Escalate design questions to Claude. Codex only for surgical fixes per executive.

READ BEFORE CODING:
- docs/payroll-statement-execution-prompt.md (this program)
- docs/payroll-commission-transparency-desire-paths.md
- docs/payroll-statement-9-10-spec.md

BRANCH: feat/payroll-statement-v2 only. No merge to main.

YOUR WORKSTREAM: [paste WS1–WS7 section]

RULES:
- Service client for all payroll_* reads/writes in APIs.
- Never put hourly or manager roles into scaleCommissionsToPool inputs incorrectly.
- Admin statements must be editable before lock.
- Reps need clarity, not spreadsheet jargon from a reference image.
- Dashboard CommissionWidget stays; improve estimate accuracy and labeling.

DEFINITION OF DONE: [paste acceptance bullets from your workstream]

Before PR: run npm run type-check and payroll-related jest tests; list collateral files touched.

Flag BLOCKER if you need schema changes — coordinate migration number with team (next after 136).

Handoff to Claude: paste PR diff + "WS[N] acceptance criteria" for hard reasoning review before merge.
Handoff to Codex: only tasks scoped as "change file X, behavior Y, no new dependencies."
```

## Prompt to paste for Claude (design / review)

```text
You are reviewing the payroll statement program for arx-internal-crm (branch feat/payroll-statement-v2).

Read: docs/payroll-statement-execution-prompt.md, payroll-commission-transparency-desire-paths.md, payroll-statement-9-10-spec.md.

You do NOT own implementation. Provide:
- Invariants and edge cases for [WS1 lock backfill | WS2 statement totals | WS5 email | WS6 dashboard estimate]
- BLOCKER / CONCERN / SUGGESTION on the attached diff or design
- Acceptance criteria pass/fail

Guardrails: pool cap order, no browser Supabase on payroll_*, hourly excluded from pool, admin edit pre-lock only unless specified.
```

## Prompt to paste for Codex (surgical)

```text
Surgical fix only in arx-internal-crm, branch feat/payroll-statement-v2.

Scope: [one file or one test file]
Task: [exact behavior change]
Do NOT: change collectParticipants, scaleCommissionsToPool, migrations, or multi-file architecture.

Run type-check after edit. Return minimal diff.
```

---

## Open decisions for product/executive

1. **Email timing:** Only after lock, or allow “preview email” (watermarked)?
2. **Post-lock edits:** Forbidden entirely vs `manual_adjustment` audit + line delta?
3. **Period cadence:** Weekly only or respect `orgs.settings.payroll_schedule` (weekly vs semi-monthly)?
4. **PDF required for v1** or HTML + in-app link sufficient?
5. **Dashboard estimate:** Live pipeline only vs blend with last locked period?

Resolve these before WS5 ships.
