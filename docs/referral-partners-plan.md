# Referral Partners — build plan (2026-10-20)

Reps network with agents/builders/etc. Each partner belongs to one rep; that rep is paid on jobs the partner sends.
Wording is fixed: **Referral Partners**, **Assigned To**, **Company Relationship**, **Called / Texted / Emailed / Visited**. Never "claim".

## Findings from the live DB that shaped the design
- `pg_trgm` is available but **not installed** → migration creates it in `extensions`.
- `deal_commission_roles.role` live CHECK already allows `setter_manager_override` / `closer_manager_override` (the older migration files are stale). The widening keeps every live value and adds `partner_owner`.
- `activities_entity_check` requires lead/opportunity/project/customer → widened to accept `referral_partner_id`.
- Payroll pays an additive role **only** when the row has `override_amount` or `override_percent`. No rate exists for `partner_owner` anywhere (inspector's rate is an org column). So the sale writes the row with **no rate → pays $0** until Nathan names one. Attribution is recorded correctly now; the rate is a one-line follow-up.
- Writes to partner tables go through API routes on the service client (ownership/admin checked there); RLS gives org members SELECT only. Direct client writes are denied by default.
- No global "+" quick-add exists in the web app → added one to the nav shell.
- Production jobs are created in two near-identical blocks in `contracts/sign` (Known Redundancy #12) → the `partner_owner` row is written by an **AFTER INSERT trigger on `production_jobs`** (one implementation, catches every creation path), plus the same SQL function is called when Referred By is set on an opportunity whose job already exists.

## Data model
`referral_partner_types`, `referral_partners`, `referral_partner_assignment_log` (audit; written by a trigger so no path can skip it; reason/actor pass via `set_config`), `activities.referral_partner_id`, `opportunities.referral_partner_id`.
DB-enforced: `status='assigned' ⇔ assigned_user_id IS NOT NULL` (exactly one owner), unique `(org_id, phone_digits)`.

## Permissions
`referral_partners:view` (every role, incl. setters/canvassers/custom roles) and `referral_partners:manage` (admin: reassign, Company Relationship, import, types). "Edit/log touches" = assigned rep or manage.

## Pay
`partner_owner` row = partner's Assigned To **as of the sale date**, from the audit log (later reassignment can't change past jobs). If the owner is also that job's closer/setter/owner → **no row written**, admins notified to decide.
