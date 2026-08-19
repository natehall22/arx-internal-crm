# Build prompt — Admin comp plan editing, org rates, and per-job overrides

Context established by a CFO-style audit of the live system on 2026-08-07. Read this whole
file before writing code. Everything below was verified against prod (`anzqkklwcgaoeunzpqjh`)
and the working tree on `main`.

## Non-negotiables (this is a LIVE payroll system in daily use)

- Auth: `requireAuthApi()` in API routes, `requireAuth()` in pages. Never `supabase.auth.getUser()`.
  `requireAuthApi()` **throws** on failure — wrap in try/catch and return 401.
- Gate every write on `isPayrollAdminRole(profile.role)` from `lib/payroll-admin-access.ts`.
  `PAYROLL_ADMIN_ROLES = ['admin','owner','operations']` — never expand this set.
- All schema changes must be nullable/additive. No destructive DDL, no column drops, no
  backfills that overwrite existing values.
- Apply migrations with the Supabase MCP `apply_migration` tool, NOT `supabase db push`
  (CLI is blocked by migration-history drift). Name files `YYYYMMDDNNNN_description.sql`
  matching the existing convention in `supabase/migrations/`.
- Every mutation that can change what someone gets paid must require a free-text
  `change_reason` and record who did it. Follow the existing pattern in
  `assign_primary_comp_plan` / `assign_management_comp_overlay` RPCs.
- UI contrast: explicit dark ink `#2c2c2a` on light surfaces, never generic gray. The page
  already defines `const INK = '#2c2c2a'` — use it. Aim for WCAG AA.
- **Mandatory change review, no exceptions:** after implementing, run a proactive bug-bot
  review plus a full collateral-impact sweep (edge cases, and every other feature touching
  the same tables/routes), then `/code-review` and `/security-review`. Do this without
  being asked.

## The map (verified, do not re-derive)

Rate resolution for the three derived commission lines:
- `lib/job-derived-commission-lines.ts`
  - `loadDerivedCommissionRateHistory()` (~line 168) reads `org_derived_commission_rates`.
  - `resolveDerivedCommissionRatesForSaleDate()` (line 68) picks the latest row with
    `effective_from <= saleDate`, else returns `null`.
  - `buildAdditiveParticipantsForJob()` (~line 260) turns `null` rates into zero lines.
- `orgs.inspection_commission_rate` / `.manager_override_commission_rate` /
  `.self_gen_commission_rate` are the *current* values; an AFTER UPDATE trigger
  (`record_org_derived_commission_rates`, migration `202608050002`) writes a new
  `org_derived_commission_rates` row dated **tomorrow** (America/New_York) on any change.
- Only editable rate today: inspection, via `PATCH /api/admin/payroll/inspection-rate`
  (rendered by `app/admin/payroll/InspectionCommissionRateCard.tsx`). Note it writes the
  `orgs` column, so the trigger forces a tomorrow effective date — there is no way to
  choose or backdate one.

Comp plans:
- Admin UI: `app/admin/comp-plans/page.tsx` (2,247 lines — read the sections you touch).
- CRUD: `app/api/admin/data/route.ts`, `resource=comp_plans` (GET), `comp_plan` (POST/PUT/DELETE),
  `user_comp_plan` (POST/DELETE).
- **PUT `comp_plan` hard-409s when the plan has any `user_comp_plans` or
  `user_management_comp_overlay_assignments` row** (route.ts ~line 516). All 8 prod plans
  are assigned, so no plan is editable at all.
- `comp_plans` rows have NO version history. `user_comp_plans` IS effective-dated.

Overlays:
- `app/api/admin/comp-plan-overlays/route.ts` — POST/PATCH/DELETE, all require `change_reason`,
  all delegate to RPCs. POST requires a `comp_plans` row with
  `plan_purpose='management_overlay'` and a valid `base_percentage`.
- Prod has **zero** overlay-purpose plans and **zero** overlay assignments.

Per-job overrides:
- `deal_commission_roles` (org_id, job_id, role, user_id, override_amount, override_percent,
  premier_pricing_amount, created_at, updated_at). **No created_by, no reason column.**
- `app/api/admin/payroll/deal-commission-roles/route.ts`, consumed only by
  `app/admin/payroll/statements/page.tsx`.

Prod state as of 2026-08-07 (ARX org `9089d4ad-f46c-405b-9798-6751d45a7051`):
- inspection 1.50%, manager override 0.00%, self-gen 0.00%.
- `org_derived_commission_rates`: exactly one row, `effective_from = 2026-08-07`.
- 8 comp plans, all `plan_purpose='primary'`, all assigned. 9 user assignments.
- `payroll_payout_lines`: 1 row total. `deal_commission_roles`: 1 row.

---

# PHASE 1 — Org derived-rate editor in `/admin/comp-plans` (DO THIS FIRST)

**Why it matters:** two published pay lines (self-gen 6%, manager override 1%) are set to 0
with no way to enable them, and a deliberate retroactive inspection decision was silently
voided by the effective-dating change. Both are fixed by one surface.

### 1.1 Migration

Add audit columns to `org_derived_commission_rates` (all nullable — existing rows predate this):

```sql
ALTER TABLE org_derived_commission_rates
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS change_reason TEXT,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
```

Add an RPC `upsert_org_derived_commission_rates(p_org_id, p_inspection, p_manager_override,
p_self_gen, p_effective_from, p_created_by_user_id, p_change_reason)` that:
- Upserts on the existing `UNIQUE (org_id, effective_from)` constraint.
- Requires a non-empty `p_change_reason` (RAISE EXCEPTION otherwise).
- Rejects any rate `< 0` or `> 25` (matches the existing `MAX_INSPECTION_RATE` guard) and
  any value with more than 2 decimals.
- **Also syncs the three `orgs` columns when `p_effective_from <= today`**, so the "current"
  values and the versioned history cannot drift. Guard against the AFTER UPDATE trigger
  creating a duplicate tomorrow-dated row — set a `SET LOCAL` flag or have the trigger skip
  when the incoming row already matches; whichever you choose, prove it with a test that
  saves a same-day rate and asserts exactly one new row appears.
- `SECURITY DEFINER` with `SET search_path = public`, following
  `assign_management_comp_overlay`.

Do NOT change `resolveDerivedCommissionRatesForSaleDate`'s null-on-no-match behavior. Returning
zero for an unpriced historical date is the correct conservative default; the fix is to let an
admin insert a backdated row deliberately, with a reason.

### 1.2 API — `app/api/admin/comp-rates/route.ts` (new)

- `GET` → the full `org_derived_commission_rates` history for the caller's org (ascending by
  `effective_from`), plus the current `orgs` values and today's date in America/New_York.
- `POST` → body `{ inspection_rate, manager_override_rate, self_gen_rate, effective_from,
  change_reason, confirm_disable?, confirm_backdate? }`. Calls the RPC.
  - Reuse the **`confirm_disable` pattern** from `app/api/admin/payroll/inspection-rate/route.ts`:
    if any rate goes from `> 0` to `0`, reject with `code: 'confirm_disable_required'` unless
    `confirm_disable === true`. Read that file and mirror its error text and validation
    (finite, non-negative, `<= 25`, max 2 decimals) exactly.
  - If `effective_from` is in the past, require `confirm_backdate === true` and return
    `code: 'confirm_backdate_required'` otherwise. Backdating rewrites what unlocked periods
    will pay — the admin must say so out loud.
  - **Refuse to backdate into a locked or paid period.** Query `payroll_periods` for the
    caller's org; if any period with `status IN ('locked','paid')` (check the actual enum
    values in the table before coding this) covers `effective_from` or later, reject with a
    message naming the period label. Locked history is not editable, full stop.
- All rates are percents (e.g. `1.5` means 1.5%), matching the existing columns.

### 1.3 UI — new card in `app/admin/comp-plans/page.tsx`

A "Company commission rates" card at the top of the page, above the plan list:
- Three labeled number inputs: Inspection %, Manager override %, Self-generated %.
- An effective-date picker, defaulting to today.
- A required "Reason for change" textarea. Save is disabled until it has content.
- A history table below: effective date, the three rates, who changed it, the reason.
  Mark the row currently in effect.
- Confirmation dialogs for the disable and backdate cases, wired to the two `code` values
  the API returns. The disable dialog must state plainly that the line switches off for the
  whole org.
- Show current values inline next to each input so the delta is visible before saving.

Leave `InspectionCommissionRateCard.tsx` on the payroll page working, but have it link to the
new comp-plans card as the canonical place. Do not delete it in this phase.

### 1.4 Tests

Add to the existing test setup (see `__tests__/payroll-period-materialization.test.ts` for the
pattern):
- `resolveDerivedCommissionRatesForSaleDate` with a backdated row now resolves historical sales.
- Saving a same-day rate produces exactly one history row (trigger does not double-insert).
- A rate change from 1.5 → 0 without `confirm_disable` is rejected.
- A backdate into a locked period is rejected.
- Non-payroll-admin roles get 403 on POST.

### 1.5 Verify against prod data, do not guess

**`payroll_periods` has NO start date** — only `cutoff_at`. `materializePayrollPeriod`
(lib/payroll-period-materialization.ts ~line 186) selects `production_jobs` with
`sale_date <= cutoff_at`, status in ('complete','collected'), not already paid — **no lower
bound**. A period sweeps every previously-unpaid eligible job however old. So "does a period
cover this date" is not a well-formed question.

Guard definition: reject when `effective_from <= max(cutoff_at)` over periods with a settled
status ('paid', and 'locked' if that value exists — query the enum, don't assume). Open
periods must NOT block a save. Prod boundary today: newest paid period is 2026-W29,
cutoff_at 2026-07-12. Periods 2026-W27, 2026-30, 2026-W31, 2026-w32 are all still open.

### 1.6 Later-row shadowing (added after owner review)

`resolveDerivedCommissionRatesForSaleDate` picks the LATEST row with `effective_from <= saleDate`.
Prod already holds a row at `2026-08-07` with inspection 1.50 / override 0.00 / self-gen 0.00.
Saving new rates effective `2026-08-04` is therefore silently overridden from 08-07 onward —
the admin would think they enabled two pay lines and get three days of them.

The RPC upserts on `(org_id, effective_from)` and cannot fix this alone. Required:
- Block the save with a confirmation naming every later row, its date, and its rates.
- Offer an opt-in "also apply these rates to the N later row(s)", applied in one transaction
  with the same reason and actor.
- Return `code: 'later_rows_shadow_warning'` with the later rows in the body, same shape as
  the other two confirm codes.
- Test: save at D with a zero row at D+3, opt in, assert a sale at D+5 resolves to the new rates.

## Owner decisions (2026-08-07) — these are settled, do not reopen

- **No backdating of historical pay plans.** The ~$2,615 retroactive inspection line is NOT
  being restored. Pre-existing sales resolving to zero derived lines is CORRECT and intended.
  Do not change `resolveDerivedCommissionRatesForSaleDate`'s null-on-no-match behavior.
- **The new ladder goes live effective Monday 2026-08-04.** Nathan enters the values; ship the
  card with prod unchanged.
- **Closing seat:** Nathan stays on "Sales Manager". A future recruited closer goes on the
  "Closer" plan (7%, currently assigned to nobody). No plan changes needed now.

---

# PHASE 2 — Per-job commission override register and audit hardening

**Corrected 2026-08-08.** An earlier draft of this spec claimed `deal_commission_roles` writes
leave no record of who or why. That was wrong — verify before building. `payroll_override_audit`
already exists (`id, org_id, override_type, job_id, payroll_period_id, actor_user_id, reason,
before_value jsonb, after_value jsonb, created_at`) and
`app/api/admin/payroll/deal-commission-roles/route.ts` (~line 176) already inserts a row with
the actor, a reason, and before/after values on every override.

**Do NOT add `created_by_user_id` / `change_reason` columns to `deal_commission_roles`** — that
would duplicate the audit table and create two disagreeing sources of truth. The real gaps are
narrower:

1. **The reason is not actually required.** The route does
   `reason: body.reason?.trim() || 'Statement override'` — a blank reason silently becomes a
   meaningless default. Require a non-empty, non-default reason and 400 without one, matching
   the overlay RPCs.
2. **The audit write is fire-and-forget.** The insert's error is never checked, so if it fails
   the override still saves and the audit row silently doesn't exist. Check the error; on
   failure the override write must not stand unaudited (wrap both in an RPC, or roll the
   override back and 500).
3. **No locked-period guard.** Overrides can be written against jobs whose pay is already
   settled. Reuse the Phase 1 rule: reject when the job's `sale_date <=` the newest
   `cutoff_at` among periods with status `'locked'` or `'paid'`. Do not re-derive it — read
   how `app/api/admin/comp-rates/route.ts` does it and keep the two consistent.
4. **No read surface.** This is the main deliverable. Add an "Per-job overrides" section to
   `/admin/comp-plans` listing every `deal_commission_roles` row org-wide — job number, role,
   user, override amount/percent, premier pricing amount — joined to the latest matching
   `payroll_override_audit` row for actor/reason/when. Read-only, linking through to the job.
   Editing stays on the job/statement surface so there remains exactly one write path.
5. Surface the precedence rule in the UI copy: an explicit `deal_commission_roles` row beats
   the org rate for that job, **including a deliberate $0**.

Reference facts (verified 2026-08-08, do not re-derive): `deal_commission_roles` has
`UNIQUE (job_id, role, user_id)` and a role CHECK of `setter | closer | inspector |
field_manager | senior_manager | self_gen | setter_manager_override | closer_manager_override |
custom`. Prod holds exactly 1 row. The route is PATCH-only (upsert semantics) and is consumed
only by `app/admin/payroll/statements/page.tsx`.

# PHASE 3 — Comp plan versioning (replaces the 409)

Do not start until Phases 1 and 2 are merged. Design first, present the plan, get sign-off
before any migration — this one can rewrite paid history if it goes wrong.

The problem: `PUT comp_plan` 409s on any assigned plan, so no plan is editable, while the plan
body itself is a mutable row with no history. The 409 is load-bearing.

Sketch to evaluate, not to implement blindly:
- New `comp_plan_versions` table holding the plan body (`base_percentage`, `tiers`,
  `volume_bonuses`, `team_overrides`, `hybrid_components`, `flat_amount`, `hourly_rate`,
  `unit_rate`, `unit_type`) with `effective_from`, `created_by_user_id`, `change_reason`.
- `comp_plans` keeps identity only (name, description, roles, purpose, active flags).
- Payroll resolves the plan body by sale date, exactly as `org_derived_commission_rates` does.
- Backfill one version row per existing plan dated at the plan's earliest assignment
  `effective_from`, so no historical job changes what it pays. **Prove this with a
  before/after diff over every job in the system before applying.**
- Then the 409 becomes "amend creates a new version," and editing a live plan is safe.

Also in scope for Phase 3, both small:
- Creating a `plan_purpose='management_overlay'` plan is currently undiscoverable, and the
  overlay assignment form fails with an unhelpful error when none exist. Add an explicit
  "Create overlay plan" affordance and make the empty-state error say what is missing.
- `comp_plans.readme` is empty on all 8 plans, and the FM 2.0 / Setter / Senior FM ladder
  (3% / 5% / 6%) has no documented promotion criteria anywhere. Surface `readme` in the plan
  editor as the place that lives.

# Explicitly out of scope

- Do not change `PAYROLL_ADMIN_ROLES`.
- Do not modify locked or paid payroll periods, or any `payroll_payout_lines` row.
- Do not enable self-gen or manager override rates yourself. Build the control; Nathan sets
  the numbers.
- Do not touch `~/dev/arx-website/src/lib/comp-plan.ts` (separate repo, authoritative
  published ladder). Reconciling the two sources of truth is a separate decision.
