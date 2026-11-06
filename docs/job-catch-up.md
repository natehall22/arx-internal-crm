# Job catch-up (v1)

Why (Nathan, 2026-11-06): office staff liked Asana for seeing every project at a glance. The CRM already knows what
happened on a job, so it can say where each one stands without anyone typing a status.

## What it shows
- **Board line** (card + list column "Where it stands"): `owner · next step · age`, e.g. `Steve · Waiting on permit · 2d`.
  Amber with "Stuck ·" when stuck. Built-in list view **Stuck** (longest idle first) and a Stuck filter.
- **Job page box "Where this stands"** (both bodies): owner, stage, next step, why it's stuck, last customer contact,
  last 3 updates, link to the full thread.

## Rules (one derivation: `lib/job-catch-up.ts`, loader `lib/job-catch-up-db.ts`)
- Next step, first match: cancelled / collected / on hold → complete (Mark collected · Waiting on payment · Close out)
  → all crews done (Mark job complete) → crew past its last day → crew on site → crew done without photos → permit
  → materials (`job-materials-state`) → crews to schedule → next crew date → the stage.
- Owner: the crew's company for crew steps, else the last person who wrote on the job, else "Office".
- Stuck: any ops-visible Needs-you problem (`lib/data-health.ts`, shaped with `shapeNeedsYou('ops')`), or no movement
  (job timestamps, crew rows, supplier orders, payments, visible notes) for N days. Collected/cancelled never stuck.
- Age is business-calendar days (`ymdInBusinessTz` + `daysBetweenDateOnly`), DST-safe.
- Notes pass through `visibleActivities`; Sales-audience notes are left out; pricing-flagged or pricing-looking notes
  are named, never quoted. No dollar amounts. Paid / waiting words only where the viewer sees collection today.
- Customer contact = activities of type call / text / email / visit. When none are logged, the box says so and shows
  the latest note.

## Settings
Admin → Settings → Job catch-up: on/off (`orgs.settings.job_catch_up_enabled`, default off) and N
(`job_catch_up_stuck_days`, default 7, 1–60). Admins/owners edit; written with `mergeOrgSettings` (per-key merge,
migration `202611060010_merge_org_settings.sql`, falls back to read-merge-write until applied).

## v2 ideas (out of scope)
- "Follow a job": notify me when a job I follow moves or goes stuck.
- AI "catch me up": a short written summary of the thread + events.
- An explicit job owner (assignee) instead of "last person who wrote".
- Log calls/texts from the job page so "last customer contact" is always real contact.
- Show the line on the Today screen and in the morning update (ops focus).
