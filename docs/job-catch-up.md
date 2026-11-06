# Job catch-up (v1)

Why (Nathan, 2026-11-06): office staff liked Asana for seeing every project at a glance. The CRM already knows what
happened on a job, so it can say where each one stands without anyone typing a status.

## What it shows
- **Board line** (card + list column "Where it stands"): `owner · next step · age`, e.g. `Steve · Waiting on permit · 2d`.
  Amber with "Stuck ·" when stuck; **"No owner" in red** when nobody owns the job. Built-in list views **Stuck**
  (longest idle first), **My jobs** and **No owner**, plus Stuck and Owner filters.
- **Job page box "Where this stands"** (both bodies): owner (tap to change), stage, next step, why it's stuck, last
  customer contact, last 3 updates, link to the full thread.
- **Red "No owner — assign one" banner** at the very top of the job page (both bodies) while the job has no owner, with
  the owner picker in it for people who can edit jobs. Gone once an owner is set.
- Everything above shows only while catch-up is ON; off = the board and job page render exactly as before.

## Rules (one derivation: `lib/job-catch-up.ts`, loader `lib/job-catch-up-db.ts`)
- Next step, first match: cancelled / collected / on hold → complete (Mark collected · Waiting on payment · Close out)
  → all crews done (Mark job complete) → crew past its last day → crew on site → crew done without photos → permit
  → materials (`job-materials-state`) → crews to schedule → next crew date → the stage.
- Owner: ONLY the explicit `production_jobs.owner_user_id` (Nathan, 2026-11-06 — never guessed). Set by anyone with
  `jobs:edit` (existing gate) via `PUT /api/ops/jobs/[id]/owner` (`lib/job-owner.ts`); candidates are active office /
  production users (no field roles, closers, sales reps or subs). Job edits aren't audited today, so neither is this.
  Migration `202611060020_production_jobs_owner.sql` (nullable, indexed, no backfill). Until it is applied the owner
  is UNKNOWN: no "No owner", no banner, no owner on the line; a save answers 409.
- Materials: the Materials tab's own answer (`loadJobMaterialsState` in `lib/supplier-orders.ts`: supplier plan first,
  stored status fallback) for each sold / materials / scheduled job — the one per-job read (it needs the job's run-sheet
  lines; batching that would be a second run-sheet implementation). Failure → the stored status.
- Stuck: any ops-visible Needs-you problem (`lib/data-health.ts`, shaped with `shapeNeedsYou('ops')`), or no MOVEMENT
  for N **working days** (Mon–Fri, business time zone; holidays count as working days). Collected, cancelled and
  on-hold jobs are never stuck (on hold shows "On hold" as the step).
- Movement = people and real job events: notes / logged calls-texts-emails-visits by our people, status-change rows,
  named job timestamps (created, materials ordered, financing submitted, started, completed, closed with balance,
  cancelled), crew rows (scheduled / done / removed; not a failed invite sync), supplier order sends and receipts,
  payments (only for viewers who see payments), photos, signed change orders. NOT `production_jobs.updated_at`
  (automated writes such as `syncJobScheduleFromTrades` and the materials mirror bump it), not automated notes, not
  inbound customer messages (shown as "Customer", but a customer chasing us doesn't mean the job moved).
- Age shown is calendar days (`ymdInBusinessTz` + `daysBetweenDateOnly`); stuck counts `workingDaysBetweenDateOnly`.
  Both are date-only, DST-safe.
- Crews, payments and signed change orders are read once by `loadDataHealthWithRows` and reused (fixed query count).
- Notes pass through `visibleActivities`; Sales-audience notes are left out; pricing-flagged or pricing-looking notes
  are named, never quoted. No dollar amounts. Paid / waiting words only where the viewer sees collection today.
- Customer contact = activities of type call / text / email / visit. When none are logged, the box says so and shows
  the latest note.

## Settings
A card on the Settings page (`/admin#job-catch-up`; the hub's "Job catch-up" entry links to it): on/off
(`orgs.settings.job_catch_up_enabled`, default off) and N working days (`job_catch_up_stuck_days`, default 7, 1–60).
Everyone who opens Settings sees it; admins/owners edit — `PATCH /api/admin/settings` `type: 'job_catch_up'`, written
with `mergeOrgSettings` (SQL `merge_org_settings`, migration `202611060010`, falls back to read-merge-write until
applied). The generic `type: 'settings'` save strips these keys.

## Deploy order (migrations are NOT applied)
1. Merge + deploy the code (works without any of the migrations).
2. Apply `202611060010_merge_org_settings.sql` and `202611060020_production_jobs_owner.sql`.
3. Only after step 1 is live: apply `202611100010_drop_merge_org_brand_settings.sql`.

## v2 ideas (out of scope)
- "Follow a job": notify me when a job I follow moves or goes stuck.
- AI "catch me up": a short written summary of the thread + events.
- Log calls/texts from the job page so "last customer contact" is always real contact.
- Show the line on the Today screen and in the morning update (ops focus).
