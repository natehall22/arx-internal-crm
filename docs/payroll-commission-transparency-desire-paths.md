# Payroll & commission transparency — desire paths

Human workflows first; implementation must route pay data through **server APIs + service client**, never browser Supabase on `payroll_*` tables (org-wide RLS).

## Rep: “What am I getting paid?”

1. Dashboard → **Pay statement** (Commission widget).
2. Pick pay period → read-only statement: deals, hourly, chargebacks, net pay, deficit banner.
3. Deal row shows **Held till Install** when NTP’d but not installed.

**Route:** `/commissions/statement/[periodId]`  
**Data:** `GET /api/commissions/statement?period_id=&user_id=` (self only unless manager/admin).

## Admin: “Run payroll for this period”

1. Admin → Payroll hub → **Pay periods** — create period (label, cutoff, pay date).
2. **Hours entry** — enter reg/OT for hourly/hybrid reps; Save All.
3. **Statements** — pick consultant + period; review; inline override amounts; lock when ready.
4. Mark period **paid** when complete.

**Routes:** `/admin/payroll/periods`, `/admin/payroll/[periodId]/hours`, `/admin/payroll/statements`  
**Data:** `/api/admin/payroll/periods`, `/api/admin/payroll/[periodId]/hours`, `/api/commissions/statement`, `/api/admin/payroll/deal-commission-roles`.

## Manager: “How is my team doing?”

1. **Team pay** — list direct reports → open same statement layout read-only.

**Route:** `/commissions/team`  
**Access:** `canViewPayrollStatement` (hierarchy walk, level ≥ 50).

## Guardrails

- Pool-scaling roles stay in `collectParticipants()`; manager roles are additive after `scaleCommissionsToPool()`.
- Hourly earnings never enter the 18% pool cap.
- Lock sets period status + snapshot header; full job snapshot backfill from `collectParticipants()` is a follow-up when payout lines are empty.
