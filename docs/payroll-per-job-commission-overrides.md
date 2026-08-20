# Per-job commission overrides (`deal_commission_roles`)

How a payroll admin changes what one person earns on one job, and what each role
name actually does when payroll runs.

## The bug this replaces

`deal_commission_roles` accepted rows for every role in its CHECK constraint, but
payroll only ever read the **additive** subset (`ADDITIVE_DEAL_COMMISSION_ROLES`).
A row with `role = 'setter'` or `role = 'closer'` was validated, written, and
written to `payroll_override_audit` — then silently ignored at materialization.
Nothing told the admin.

Two production jobs were paid from the wrong split as a result:

| Job | Comp base | Pool cap (18%) | Intent | What paid |
|---|---|---|---|---|
| 26-0035 Kavita Pachalla | $21,052.71 | $3,789.49 | Tim $900, Nathan $1,444.75, Evan $1,444.75 | Tim's `setter` override dropped → he kept his plan line; Nathan drew a plan line **and** his custom line |
| 26-0036 Debra Lynn Gullette | $19,976.71 | $3,595.81 | Nathan 9%, Evan 9%, nobody else | Nathan's `sales_rep` and Evan's `setter` plan lines still fired and diluted both custom lines |

The pool cap held in both cases, so this was a **misallocation, not an
overpayment** — but it needed a manual SQL correction against
`payroll_payout_lines` and `payroll_job_snapshots` after the fact.

Note the second failure: 26-0036 used only `custom` rows, which worked exactly as
designed and *still* paid the wrong people. Rejecting `setter`/`closer` at the API
would not have prevented it. The missing capability was the ability to take a
producer **off** a deal.

## The two kinds of row

Every `deal_commission_roles` row is one of exactly two things. The sets are
disjoint and a test enforces that they stay so.

### Producer overrides — REPLACE a line

Roles: **`setter`, `closer`**

These correspond to the participants `collectParticipants()` derives from job and
opportunity attribution, whose pay normally comes from their comp plan:

| Participant role | Source | Stored as |
|---|---|---|
| `sales_rep` | `production_jobs.salesperson_id` | `closer` |
| `owner` | `opportunities.owner_user_id` | `closer` |
| `setter` | `opportunities.setter_user_id` | `setter` |

`sales_rep` and `owner` both fold onto `closer` because the table has never had
separate names for them. That is safe: `collectParticipants()` dedupes by user id,
so one person holds at most one of the two on a job, and a `closer` row therefore
still resolves to exactly one line. The mapping lives in
`producerStorageRoleForParticipant()` (`lib/payroll-export.ts`) and is used by
**every** side — payroll, the API's validation, and the statement display join — so
the two halves cannot drift.

A producer override **replaces** what that person's comp plan would have paid on
that job. Their plan is not consulted at all.

- `override_amount` (flat dollars) wins over `override_percent`, matching the
  additive rule.
- **A row with neither value is not an override.** It is the shape the UI writes
  when an override is cleared, and payroll falls back to the comp plan. Reading it
  as `$0` would unpay someone who was only ever meant to fall through. Prod job
  26-0033 holds exactly such a row.
- **An explicit `0` is a real override.** This is how a producer is taken off a
  deal whose commission is being re-split. The payout line is still written, at
  `$0`, because "paid nothing on this deal" is an auditable fact and a missing row
  is indistinguishable from a bug.

### Additive rows — ADD a line

Roles: `inspector`, `field_manager`, `senior_manager`, `setter_manager_override`,
`closer_manager_override`, `self_gen`, `custom`

These pay a **separate** line on top of the standard split. They are not
double-pay: they go to a different role, and one person can legitimately hold two
(closing a job and inspecting it), which is why `poolKey()` is `user|role` rather
than user alone.

## Everything scales inside the pool cap

Producer overrides, additive lines and plan-computed lines all enter `rawByUser`
**before** `scaleCommissionsToPool()`. If a job's total sales pay would exceed its
18% cap, every line scales down together. An override sets a line's share of the
pool, not a guaranteed dollar amount.

## Re-splitting a deal: the worked recipe

To pay an arbitrary set of people on one job and nobody else — the 26-0035 /
26-0036 case:

1. For each default producer you want removed, save a `setter` / `closer` override
   of **`0`**.
2. For each person who should be paid, save a `custom` override with the agreed
   amount or percent.
3. Suppress any derived line that would still fire (below).
4. Confirm against `GET /api/admin/payroll/export` **before** locking — the
   preview uses the same functions the lock does.

## Derived lines are independent — suppress them separately

`buildAdditiveParticipantsForJob()` derives the inspection, manager-override and
self-gen lines from `salespersonId` / `setterUserId` **regardless** of whether that
producer's own line was overridden. This is deliberate: those are distinct roles
with distinct rates, and zeroing someone's closer line should not silently revoke,
say, the manager override their upline earns on the deal.

It does mean a re-split job can still emit a derived line. Each has its own
suppression mechanism, all following the same rule — **any explicit row of the
matching role suppresses the derived line, including one with no amount, which then
pays nothing**:

| Derived line | Suppressed by an explicit row of role | Watch for |
|---|---|---|
| Inspection | `inspector` | — |
| Manager override (setter lane) | `setter_manager_override` | — |
| Manager override (closer lane) | `closer_manager_override` | — |
| Manager override (both lanes) | `field_manager` or `senior_manager` | Legacy generic rows suppress **both** lanes |
| Self-gen | `self_gen` | Credited to the **same person** as the `sales_rep` line — additive by design (7% close + 6% self-gen), auto-suppressed when a separate setter exists (`selfGenSetterConflict`) |

A manager who produces their own deal earns the overlay on their own production
(`source: 'own_production'`, gated on having at least one effective direct report),
so they hold both a plan-driven producer line and an additive manager line. That is
intended, and each is overridden independently.

## What an override does NOT change

- **Monthly volume accumulation.** `buildMonthlyVolumeMaps()` credits the job's
  comp base to each participant's month for volume-bonus tiers, and an override
  does not touch it. The rep did sell the job; changing their pay on it must not
  silently restate the tier they hit on *other* jobs that month. Overrides stay a
  per-job operation with no cross-job ripple.
- **Job attribution.** `salesperson_id` / `setter_user_id` are untouched, so
  dashboards, sit metrics and canvass attribution are unaffected.
- **The monthly flat volume bonus** is not attached to an overridden line, and the
  once-per-month slot stays unconsumed, so it can still land on another job in the
  same month. A rep whose only job that month is overridden does not receive it.

## Guardrails

- **`PATCH /api/admin/payroll/deal-commission-roles` rejects a `setter`/`closer`
  override for a user who holds no such producer role on that job**
  (`code: 'not_a_producer_on_job'`). It resolves "who is a producer here" with
  `collectParticipants()` — the same function payroll uses, dedupe rule included —
  so a row that payroll could not act on can no longer be created. Use `custom` to
  pay someone who is not the job's setter or closer.
- Settled pay stays settled: a job with payout lines in a `locked` or `paid` period
  is rejected (`code: 'locked_period'`). Checked before the producer check, so an
  already-paid job reports that first.
- Every write requires a non-empty reason and is audited; if the audit insert
  fails, the override is rolled back and the request 500s.

## Known gap — the write UI is hard to reach

`/admin/payroll/statements` renders its override inputs from
`payroll_payout_lines`, which only exist **after** `materializePayrollPeriod()`,
which only runs at **lock**. But once a job is snapshotted, materialization skips
it (`alreadySnapshotted`, keyed by job id across all periods), and the API rejects
overrides on locked/paid periods.

So the practical sequence is: set overrides via the API *before* the period is
locked, and verify with the export preview. The incident overrides were set that
way. Making the statement page usable pre-lock — or making a re-lock re-materialize
a corrected job — is a separate piece of work and is **not** addressed here.
