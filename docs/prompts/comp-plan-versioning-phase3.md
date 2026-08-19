# Phase 3 design — comp plan versioning (replacing the 409)

Status: **design only, awaiting sign-off.** No migration written, nothing applied.
Verified against prod (`anzqkklwcgaoeunzpqjh`) and `main` on 2026-08-19.

## The problem

`PUT /api/admin/data?resource=comp_plan` returns 409 for any plan that carries a
`user_comp_plans` or overlay assignment ([route.ts:516](../../app/api/admin/data/route.ts)).
All 8 prod plans are assigned, so **no comp plan is editable at all** — the 6% on the
Setter Manager card, the 7% on Closer, every tier and volume bonus.

The 409 exists because `comp_plans` rows are mutable with no history: payroll resolves a
user's plan by sale date through `user_comp_plans` (which *is* effective-dated) and then
reads the plan body **as it is today**. Editing 6% → 7% would silently restate what every
past job pays.

## What the 409 actually protects (this changes the risk story)

`materializePayrollPeriod` writes `payroll_payout_lines.comp_plan_snapshot` containing the
whole plan body and the calculation
([payroll-period-materialization.ts:491](../../lib/payroll-period-materialization.ts)).
So **a materialized period is already immune** to later plan edits — its lines carry their
own copy of the terms.

What is *not* immune is every surface that recomputes from live plans:

- `GET /api/admin/payroll/export` (the preview an admin approves)
- `lib/payroll-statement.ts` and `/admin/payroll/statements`
- `/api/commissions/weekly`, `components/CommissionWidget.tsx`, `/api/user/comp-plan`
- any period materialized *after* an edit, for jobs sold *before* it

And critically: per the payroll-periods audit, **6 periods marked paid have zero payout
lines and zero job snapshots** — nothing was ever materialized for them, so they have no
snapshot to fall back on. For those, live plan bodies are the only record of what was paid,
and they are already unreliable.

## Design

### 1. `comp_plan_versions` (new table, additive)

Holds the pay-affecting body; `comp_plans` keeps identity only.

```
id, org_id, comp_plan_id, effective_from DATE,
plan_type, base_percentage, flat_amount, hourly_rate, unit_rate, unit_type,
hybrid_components JSONB, tiers JSONB, volume_bonuses JSONB, team_overrides JSONB,
personal_sales_enabled, team_override_enabled,
created_at, created_by_user_id NOT NULL, change_reason TEXT NOT NULL (non-empty)
UNIQUE (org_id, comp_plan_id, effective_from)
```

Append-only, enforced by a trigger modelled on
`reject_management_overlay_version_mutation` (migration 202608070001). Identity fields
(`name`, `description`, `applicable_roles`, `readme`, `is_active`, `is_default`) stay on
`comp_plans` and remain editable in place — they do not change anyone's pay.

`is_manager_plan` is the one ambiguous field: it drives eligibility in
`buildAdditiveParticipantsForJob`, so it belongs in the version, not identity.

### 2. Backfill that provably changes nothing

One version per existing plan at `effective_from = DATE '2000-01-01'`, copying the current
body verbatim. Any sale date then resolves to exactly the body it resolves to today. Using
the earliest assignment date instead would leave a gap before it that resolves to null —
that is how the org-rate resolver already produces silent zeroes, and it is not worth
repeating here.

### 3. Resolution

`resolveCompPlanBodyForSaleDate(versions, planId, saleDate)` — latest version with
`effective_from <= saleDate`, mirroring `resolveDerivedCommissionRatesForSaleDate` and
`resolveOverlayRatePercent`. On no match, fall back to the live `comp_plans` row and log;
after the backfill that branch is unreachable, and a hard failure would take payroll down
over a data gap.

### 4. Writes

`PUT comp_plan` splits in two:

- identity-only edits → update `comp_plans` in place, no 409
- body edits → "amend": insert a new version with `effective_from` + required
  `change_reason`, via a `SECURITY DEFINER` RPC with `REVOKE … FROM PUBLIC, anon,
  authenticated` / `GRANT … TO service_role` (the pattern migration 202608070005 exists to
  enforce — every payroll RPC in this codebase must carry it)

Guards, reusing the rules already written for comp rates and per-job overrides:

- an `effective_from` in the past requires `confirm_backdate`
- reject when the amendment would reach jobs already paid out — the precise check now used
  in `deal-commission-roles` (payout lines in a locked/paid period), not a sale-date/cutoff
  comparison
- warn on later scheduled versions that would shadow the one being saved
  (`later_rows_shadow_warning`, same shape as `/api/admin/comp-rates`)

### 5. UI

Plan card shows the version in effect, its date, and "amend" instead of "edit"; a version
history table (date, rates, who, why); the effective-date + reason fields the other two
surfaces already use.

### 6. Proof gate before applying anything

A script that, for **every** job in the system, computes each participant's pay under the
current code and under the versioned resolver and asserts the numbers are identical. The
migration does not get applied until that diff is empty. This is the whole reason Phase 3
was held for sign-off.

## Also in scope (small)

- Delete or rename the inactive **"Setting Manager"** hybrid plan — it pays $0, is assigned
  to nobody, and sits one letter away from the live "Setter Manager" plan.
- Surface `comp_plans.readme` as the home for ladder/promotion criteria (already shipped in
  the Phase 1 branch; keep it in the amend editor).

## Open questions for Nathan

1. **The 6 paid-but-unmaterialized periods.** Versioning cannot reconstruct what they paid;
   nothing was recorded. Do we leave them as-is (recommended — the ladder went live
   2026-08-04 and no backdating is happening), or reconstruct them from statements first?
2. **Amend vs. new plan.** Once amending is safe, do you still want the option to create a
   successor plan and re-assign people (useful when the ladder rung itself changes name),
   or should amend become the only path?
3. **Who may amend.** Same `PAYROLL_ADMIN_ROLES` set as everything else, or owner-only for
   plan bodies specifically?
