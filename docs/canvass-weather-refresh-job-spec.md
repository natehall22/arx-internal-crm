# Canvass Weather Refresh Job — Design Spec

**Status:** Design only. No application code is changed by this document.
**Author context:** Nathan (ARX). Companion to `docs/canvass-weather-overlay-design.md` and `docs/prompts/canvass-weather-overlay-implementation.md`.
**Scope:** A server-side scheduled job that pre-warms/refreshes the canvassing weather-overlay data **once each morning** so the first field-rep request of the day is a cache hit, not a cold upstream fetch.

> Honesty note: every numeric threshold, cron limit, rate limit, and pricing statement below is a **recommendation to verify**, not a confirmed fact. Where I infer a platform limit (Vercel cron count, max execution duration, NWS politeness), it is flagged. Verify against your current Vercel plan and the live NWS/NOAA docs before relying on it.

---

## 0. TL;DR recommendation

- **Mechanism:** **Vercel Cron** hitting a new Next.js route, because the repo *already* runs three Vercel crons (`vercel.json` + `app/api/cron/*`) with an established, working pattern. Do not introduce pg_cron or an edge function — that would be a second scheduling system to operate for no benefit.
- **Time:** Run at **09:00 UTC** (cron `0 9 * * *`), which is **05:00 America/New_York during EDT** (summer) / **04:00 during EST** (winter). Reps start the day after this. DST is handled by choosing a UTC time that stays comfortably before the workday in both offsets — see §1.3.
- **Security:** Reuse the existing **`Authorization: Bearer ${CRON_SECRET}`** check (identical to `app/api/cron/sync-444/route.ts`). **Not** `requireAuthApi()` — there is no user/session on a machine cron. Reject everything that isn't the secret.
- **Storage:** Persist results in a **new, additive, nullable, RLS-enabled Supabase table `weather_cache`** (Phase 2 adds `weather_swaths`). The current in-memory `Map` cache in `lib/roofradar-open-data.ts` is **insufficient for serverless** (per-instance, dies on cold start) — a daily job that writes to one lambda's memory does not help the lambda that serves the first rep. The DB is the shared cache.
- **Degradation:** The read path always serves **last-good** rows and surfaces `refreshed_at` so the UI can show a "data as of …" / stale badge. A failed run never blanks the map.

---

## 1. Scheduling mechanism

### 1.1 Options considered

| Option | Fit for this stack | Verdict |
|---|---|---|
| **Vercel Cron → Next.js route** | The app is Next.js 14 on Vercel and **already has `vercel.json` crons** (`promote-insurance-follow-ups`, `cleanup-inspection-photos`, `sync-444`) plus the `CRON_SECRET` Bearer pattern. Zero new infra, one more line in `vercel.json`, one new route file. | **CHOSEN.** |
| **Supabase `pg_cron` + edge function** | Would let the schedule live next to the data and run the GRIB2/MESH work in Deno. But: (a) it's a *second* scheduler to monitor; (b) GRIB2 → GeoJSON contouring (Phase 2) needs `gdal`/Python tooling that does not run cleanly in a Deno edge function; (c) the team has no existing edge-function deploy/observability muscle, whereas Vercel cron logs are already where Nathan looks. | Rejected — adds operational surface for no upside. |
| **External trigger** (GitHub Actions cron, cron-job.org, Upstash QStash) hitting the same route | Useful as a **backup trigger** or if Vercel cron count is exhausted (see §1.2). Same endpoint, same secret. | Keep as fallback only; not primary. |

**Decision:** Vercel Cron, matching the three crons already in `vercel.json`. The MESH/GRIB2 heavy lifting (Phase 2) that doesn't fit a serverless function should be a **separate worker** (see §3.3) whose *output* this job (or its own cron) writes to the same table — but Phase 1 needs no such worker.

### 1.2 Vercel cron limits — VERIFY

- Hobby/Pro/Enterprise plans historically differ on (a) **number of cron jobs** and (b) **minimum granularity** and (c) **max function duration**. This repo already runs **3** crons; adding a 4th may or may not be within plan limits. **Verify the current plan's cron count and per-invocation duration cap before merging.** Do not assume.
- If the plan caps cron *count*, the cleanest workaround is to **fold this into an existing daily cron** or use an **external trigger** (GitHub Actions `schedule:`) hitting the same secured route. The route design is identical either way.

### 1.3 Cron expression and timezone / DST

- **Vercel cron schedules are evaluated in UTC.** There is no per-cron timezone field; the existing crons (`0 3 * * *` etc.) are already UTC.
- We want the refresh to finish **before reps start** (assume ~6:30–7:00 a.m. local door-knocking prep). Eastern Time is the operating area (Cabarrus County NC).
  - EDT (summer) = UTC−4 → `0 9 * * *` fires at **05:00 EDT**.
  - EST (winter) = UTC−5 → `0 9 * * *` fires at **04:00 EST**.
- **Recommended expression: `0 9 * * *`** (09:00 UTC daily). It lands at 04:00–05:00 local year-round — always before the workday, with comfortable headroom even if the run takes several minutes or retries. This is the **opinionated pick**: anchor to UTC and accept the 1-hour seasonal drift rather than trying to chase local 05:00 exactly (Vercel can't express "05:00 America/New_York", and the drift is harmless because both times are pre-workday).
- If a hard local-time anchor is ever required, move scheduling to an external trigger that supports IANA timezones (QStash/GitHub Actions can't natively DST-shift either; cron-job.org can). Not worth it now.

`vercel.json` addition (illustrative — do not apply as part of this spec):
```json
{
  "path": "/api/cron/weather-refresh",
  "schedule": "0 9 * * *"
}
```

---

## 2. Endpoint / function design

### 2.1 Path & method
- **New file:** `app/api/cron/weather-refresh/route.ts`
- **Method:** `GET` (Vercel cron issues GET; matches the three existing cron routes).
- `export const dynamic = 'force-dynamic'` (no caching of the route itself).
- Consider `export const maxDuration = 60` (or the plan max) given upstream fetches + optional contouring — **verify the plan's allowed `maxDuration`.**

### 2.2 Security — why not `requireAuthApi()`

`requireAuth()` / `requireAuthApi()` resolve a **human session from the request cookie**. A Vercel cron invocation has **no user, no session cookie** — it is a machine calling its own backend. So `requireAuthApi()` would always fail (correctly: there's no user), making it the wrong tool. The established, correct mechanism in this codebase is a **shared secret in the `Authorization` header**, exactly as the three existing cron routes do:

```ts
const authHeader = request.headers.get('authorization')
const cronSecret = process.env.CRON_SECRET
if (!cronSecret) return 503  // not configured — fail closed
if (authHeader !== `Bearer ${cronSecret}`) return 401  // reject public calls
```

- Vercel automatically attaches `Authorization: Bearer $CRON_SECRET` to Vercel-Cron-triggered requests when `CRON_SECRET` is set as an env var — **verify this is configured in the project's env** (it must already be, since the other three crons rely on it).
- **Public calls are rejected** with 401; missing config fails closed with 503. No anonymous path can trigger the job or read its internals.
- Inside the route, all DB writes use **`createServiceClient()`** (service-role, bypasses RLS) — same as the existing crons. The job is trusted server code; RLS protects the *read* path (the rep-facing API), not the writer.

### 2.3 Skeleton (illustrative, do not implement here)
```ts
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // VERIFY against plan

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // optional: gate behind the feature flag so it no-ops while overlay ships dark
  if (process.env.NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY !== 'true')
    return NextResponse.json({ skipped: 'flag off' })

  const admin = createServiceClient()
  // ... fetch + upsert (see §3, §4) ...
}
```

---

## 3. What it fetches and computes per run

### 3.1 Area footprint determination
The operating area covers **Mecklenburg + Cabarrus** counties (Charlotte metro canvass zone). Drive the footprint from env vars so it can grow without code changes:

| Env var | Value | Notes |
|---|---|---|
| `WEATHER_FOOTPRINT_N` | `35.60` | North edge (~Lake Norman / north Mecklenburg) |
| `WEATHER_FOOTPRINT_S` | `35.00` | South edge (~south Cabarrus) |
| `WEATHER_FOOTPRINT_E` | `-80.30` | East edge (~east Cabarrus) |
| `WEATHER_FOOTPRINT_W` | `-81.10` | West edge (~west Mecklenburg) |

- **BBox spans:** lat 0.60°, lng 0.80° — both well under `MAX_WEATHER_BBOX_SPAN_DEGREES = 5` (`lib/weather-footprint.ts`).
- **Set on:** Vercel project env (Preview + Production for cron/refresh routes) **and** GitHub repo variables (for `.github/workflows/weather-mrms-ingest.yml`). Code default in `DEFAULT_WEATHER_FOOTPRINT` remains Cabarrus-only fallback when env is unset.
- **Legacy Cabarrus-only default** (`n 35.58, s 35.12, e -80.32, w -80.82`) misses Charlotte/Mecklenburg — do not rely on it in prod; always set the four env vars above.

**Recommended ZIP superset** (for documentation; bbox is authoritative): `28025,28027,28031,28036,28054,28078,28081,28082,28105,28107,28124,28202,28203,28204,28205,28206,28207,28208,28209,28210,28211,28212,28213,28214,28215,28216,28217,28226,28227,28262,28269,28270,28273,28277`.

- Derive a **single bounding box** that encloses those ZIPs (precompute the bbox once; geocode each ZIP centroid via the existing US Census geocoder used in `roofradar-open-data.ts`, or hardcode the verified bbox as `n/s/e/w`). The job pre-warms cache keyed by that bbox (and/or per-ZIP sub-bboxes that mirror what the rep-facing route will request).
- **Cache-key alignment is critical:** the rep-facing route (`app/api/canvass/weather/route.ts`) keys its cache by `bbox|layer|window`. The refresh job must pre-warm the **same keys** the read path will look up, or pre-warm a **superset bbox** that the read path queries against (preferred: store rows the read path filters spatially, so any rep bbox inside the footprint is a hit). Confirm the key contract with whoever builds the read route (§9).

### 3.2 Per-run work (Phase 1 — ships first)
1. **SPC storm reports (Tier B):** call the existing fetch/parse logic in `lib/roofradar-open-data.ts` (`fetchSpcReports(year, 'hail' | 'wind')` for `candidateYears()`), filter to the footprint bbox + window, and **upsert** the resulting normalized reports into `weather_cache` (see §4). This is the same code reps would otherwise trigger cold; running it at 09:00 UTC means the day's first request reads warm DB rows.
2. **NWS active alerts (Tier A):** fetch `https://api.weather.gov/alerts/active?status=actual&message_type=alert`, filter to warning polygons intersecting the footprint, and upsert as GeoJSON features.
   - **Note:** active alerts are *live and short-lived*; a once-daily pre-warm is of limited value for them (they change through the day). Recommended: still snapshot them at run time for a fast initial paint, but let the read path re-fetch active alerts live (they're cheap, key-less, single request). Treat the daily snapshot as a fallback if NWS is down at request time, not as the primary live source.

### 3.3 Per-run work (Phase 2 — MRMS MESH swaths)
- Regenerate **prior-day** MRMS MESH hail swaths: fetch the relevant MRMS GRIB2 grid(s) for the footprint, contour by hail-size threshold (`gdal_contour` / `pyhail`), export GeoJSON, and upsert into `weather_swaths`.
- GRIB2 contouring **does not fit cleanly in a Vercel serverless function** (needs GDAL/Python, heavy memory/CPU, possibly >60s). Options, in order of preference:
  1. **Separate worker** (small container / scheduled GitHub Action / a Supabase edge function only if Deno+gdal proves viable) that does the contouring and writes `weather_swaths` directly. The Vercel cron route then just *verifies freshness* / triggers/records the run.
  2. If kept inside Vercel, it must be a passthrough to a pre-contoured source (the ArcGIS-Hub-style derived GeoJSON noted in the design doc) — **coverage unverified**, so do not depend on it.
- **Idempotent by `(event_date, layer, source)`** so re-running for the same prior day overwrites rather than duplicates.

### 3.4 Free-API politeness / rate limits — VERIFY
- **NWS (`api.weather.gov`) requires a `User-Agent`** identifying the app and a contact, e.g. `User-Agent: ARX-CRM (nathan@arxroofing.com)`. Requests without it may be throttled/blocked. Set it on every NWS fetch.
- **SPC CSVs** (`spc.noaa.gov/wcm/data/{year}_{hail|wind}.csv`) are large static files; fetch each year **once per run**, not per ZIP. The existing in-memory cache already dedupes within a process — the daily job naturally fetches each CSV a handful of times (one per candidate year × hail/wind). This is well within polite use, but **don't fan out per-ZIP fetches**.
- **US Census geocoder** (if used for ZIP centroids): batch/limit calls; the existing code already has `ROOFRADAR_CENSUS_GEOCODE_LIMIT`. For the footprint, geocode the ~8 ZIP centroids **once** and cache the bbox, not every run.
- Add a small politeness delay between distinct upstream hosts if looping; total external calls per run should be a couple dozen at most. Free tiers; ~zero cost (§7).

---

## 4. Cache / storage strategy

### 4.1 Why in-memory is insufficient for a serverless daily job
`lib/roofradar-open-data.ts` uses module-level `Map`s (`reportCache`, `geocodeCache`) with `expiresAt` TTLs. That works for *request-time* warm reuse **within one lambda instance**, but:
- **Per-instance memory:** Vercel runs many isolated lambda instances. The instance that runs the 09:00 cron is almost certainly **not** the instance that serves the first rep at 07:00 local — so a cron that only warms in-memory caches warms *nobody's* cache.
- **Cold starts / eviction:** instances are recycled; memory is wiped between cold starts. The cache cannot be assumed to survive even minutes.
- **No cross-instance sharing & no durability:** a failed midnight upstream can't be "served from yesterday" if yesterday's data only lived in a since-recycled lambda.

**Therefore the daily job must persist to a shared, durable store — Supabase Postgres.** The in-memory `Map` stays as a *second-level* per-request cache in front of the DB (fast path), but the DB is the source the cron writes and the read path falls back to.

### 4.2 Tables (additive, nullable, RLS — per CLAUDE.md)

All new, no changes to existing tables. Migrations must be additive/nullable. Both tables `org_id`-scoped if the system is multi-org (it is — see `program_444`/`orgs`); if weather is global, keep `org_id` nullable and document it.

**`weather_cache`** — Phase 1 (SPC points + NWS alert snapshots):

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` default `gen_random_uuid()` PK | |
| `org_id` | `uuid` null | nullable; weather data is geographic, may be shared org-wide |
| `layer` | `text` | `'hail' \| 'wind'` |
| `kind` | `text` | `'report'` (SPC point) \| `'warning'` (NWS polygon) |
| `event_date` | `date` null | observation/alert date |
| `magnitude` | `numeric` null | inches (hail) or mph (wind) |
| `geometry` | `jsonb` (or PostGIS `geography` if available) | GeoJSON geometry; `jsonb` keeps it dependency-free, PostGIS enables spatial index |
| `bbox` | `jsonb` null | `{n,s,e,w}` footprint this row was fetched for, for read-path filtering |
| `source` | `text` | `'spc'` \| `'nws'` |
| `properties` | `jsonb` null | passthrough props (event name, etc.) |
| `refreshed_at` | `timestamptz` default `now()` | **freshness stamp** — drives staleness UI |
| `created_at` | `timestamptz` default `now()` | |

**`weather_swaths`** — Phase 2 (MRMS MESH):

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `org_id` | `uuid` null | |
| `event_date` | `date` | prior-day swath date |
| `layer` | `text` | `'hail'` (later `'wind'`) |
| `magnitude` | `numeric` null | swath contour band (inches) |
| `geometry` | `jsonb` / `geography` | contoured polygon GeoJSON |
| `source` | `text` | `'mrms_mesh'` |
| `refreshed_at` | `timestamptz` default `now()` | |
| `created_at` | `timestamptz` default `now()` | |

- **RLS enabled** on both. Read policy: authenticated users in-org (or all authenticated, if global). **Writes only via service role** (the cron) — no client write policy.
- **Idempotency keys / unique constraints:**
  - `weather_swaths`: unique `(org_id, event_date, layer, source, magnitude)` so re-runs upsert.
  - `weather_cache`: a natural key is harder for point reports; prefer a **delete-then-insert for the footprint+source+window** within a transaction (see §5), or a unique on `(source, kind, layer, event_date, geometry hash)`. Simpler and robust: **replace-by-footprint** (see §5.1).
- Recommended index: on `weather_swaths(event_date, layer)` and, if PostGIS is enabled, a GiST index on `geometry` for spatial filtering. **Verify whether the PostGIS extension is enabled** (`list_extensions`); if not, store GeoJSON as `jsonb` and filter in app code by bbox to stay dependency-free.

### 4.3 Read path serves stale-but-usable data
- The rep-facing route reads from `weather_cache` / `weather_swaths`, returns the rows **plus the max `refreshed_at`** in the response.
- If a run failed and rows are from yesterday (or older), the route **still returns them** — never an empty map. It includes `refreshed_at` so the UI shows the "data as of {date}" / **stale badge** state already specified in the UI spec.
- The route may still hit NWS live for active alerts (cheap), independent of the cache freshness.

---

## 5. Idempotency, retries, partial-failure, observability

### 5.1 Idempotency
- The job is **safe to re-run any number of times**. Per source/footprint it does a **replace** (transactional delete of the prior snapshot for `source + layer + footprint + window`, then insert), or an **upsert** keyed by the unique constraints in §4.2. Either way, a second run the same morning yields the same end state — no duplicate rows, no drift.
- Phase 2 swaths upsert on `(event_date, layer, source, magnitude)`.

### 5.2 Retries & partial failure
- Wrap **each source independently** in try/catch (mirrors the existing crons' per-iteration `try/catch`). If NWS fails but SPC succeeds, **commit SPC and report partial success** — do not abort the whole run.
- On a source failure, **do not delete the previous good rows for that source** (replace only after a successful fetch+parse). This guarantees degradation = "keep yesterday's data," never "blank the layer."
- Vercel cron does **not auto-retry** on failure (VERIFY). Mitigations:
  - The job runs daily; a one-day-old cache is acceptable for hail/wind history.
  - Optionally expose the same route to a **manual re-trigger** (curl with the secret) so Nathan can re-run on demand.
  - Optionally add a **second cron a few hours later** as a cheap retry (e.g. also `0 12 * * *`) — counts against the cron-count limit (§1.2), so verify first.

### 5.3 Logging / observability
- **Reuse the existing convention:** `console.log`/`console.error` with a `[cron/weather-refresh]` prefix (matches `[cron/sync-444]`, `cleanup-inspection-photos:` etc.). These show up in **Vercel function logs**, which is where Nathan already reads cron output, and in Supabase logs for DB errors.
- Return a **structured JSON summary** from the route (like the others do): `{ ok, ranAt, footprintZips, spc: {fetched, upserted}, nws: {fetched, upserted}, swaths?: {...}, errors: [...] }`. Vercel surfaces the response body/status per invocation.
- **Optional, recommended durable run log:** a `weather_refresh_runs` table (`id, started_at, finished_at, status 'ok'|'partial'|'failed', counts jsonb, error text`) the job writes once per run. Gives Nathan a queryable history ("did it run this morning, did it succeed") without scraping logs. Additive/nullable/RLS like the rest.
- **Alerting (optional):** on `failed`/`partial`, send a Nodemailer email (SMTP already configured) to `nathan@arxroofing.com`. Don't over-engineer; a daily summary or only-on-failure email is enough.

---

## 6. Failure modes & graceful degradation

| Failure | Behavior | Degradation |
|---|---|---|
| **NOAA/SPC CSV unreachable** | Existing fetch returns `[]` on non-OK (already handled in `roofradar-open-data.ts`). Job logs error, **keeps prior `weather_cache` SPC rows** (no replace on empty fetch). | Read path serves yesterday's points; UI shows stale-as-of date. |
| **NWS alerts API down / 5xx / missing UA throttle** | Job logs, keeps prior alert snapshot. Read path can also try live NWS and fall back to the snapshot. | Live warnings may be briefly missing; historical layer unaffected. |
| **GRIB2 / MESH processing failure (Phase 2)** | Worker logs failure; **does not overwrite** prior `weather_swaths`. Cron run marked `partial`. | Swath layer shows yesterday's swaths (still useful for "was this block hit"). |
| **Job didn't run at all** (cron skipped, plan limit, deploy gap) | No new rows; `refreshed_at` ages. Optional run-log/alert reveals the gap. | Map still renders last-good data with an honest "data as of …" badge. The overlay is **assistive** — a stale-but-present layer never blocks knocking. |
| **DB write failure / RLS misconfig** | Service-role write should bypass RLS; if a write errors, log and abort *that source's* replace (prior rows intact). | Same as above — last-good served. |
| **Footprint/bbox misconfigured** | Pre-warm misses the rep's actual bbox → cache miss → read path falls back to cold upstream fetch (slower but correct). | Graceful: correctness preserved, only speed lost. Caught by the read-path's own in-memory cache + monitoring. |

**Core principle:** the daily job is an **optimization, not a dependency**. The overlay must work (cold) even if every run fails; the job just makes the morning fast.

---

## 7. Cost / quota considerations

- **Expected cost: ~$0.** All data sources (NWS, SPC, Census geocoder, MRMS) are free U.S.-government feeds. One daily Vercel function invocation is negligible compute.
- **Vercel cron count & duration are the only real limits to check (VERIFY):** the repo already runs 3 crons; confirm the plan allows a 4th and that the run fits the `maxDuration` cap (Phase 2 contouring is the risk — push it to a worker if it can't fit).
- **Supabase:** a few hundred rows/day in two small tables is trivial storage; no quota concern on any tier.
- **Do not treat any of the above plan limits/pricing as fact** — confirm against the current Vercel plan dashboard and Supabase project before relying on them.

---

## 8. Rollout note

- **Same feature flag:** gate the job behind `NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY === 'true'` (see §2.3) so it **no-ops while the overlay ships dark**, then activates with the feature.
- **Additive only:** new route file + new tables (`weather_cache`, optional `weather_refresh_runs`, Phase 2 `weather_swaths`) — all nullable/additive, RLS-enabled, no changes to existing tables. One line added to `vercel.json`.
- **Own branch** off `main` (e.g. `feat/canvass-weather-refresh-job` or folded into `feat/canvass-weather-overlay`) — **not** `fix/proposal-squares-and-payroll-bonuses`.
- **Ship order:** Phase 1 (SPC + NWS snapshot into `weather_cache`) with the overlay; Phase 2 (MESH swaths worker → `weather_swaths`) later, no front-end rework.
- **Verification before merge:** confirm 401 on a no-secret call, 503 when `CRON_SECRET` unset, idempotent re-run produces no duplicate rows, and that a simulated upstream failure leaves prior rows intact.

### 8.1 Prod enable checklist (canonical: `canvass-weather-overlay-phase2-verification.md`)

Before setting `NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY=true` in Vercel Production:

1. Migration applied; reconcile `supabase_migrations` history if you use `supabase db push`.
2. GitHub + Vercel env: `CRON_SECRET`, `WEATHER_SWATHS_INGEST_URL`, `WEATHER_FOOTPRINT_N/S/E/W`; GitHub var `NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY=true` for the MRMS Action.
3. Vercel plan allows the 4th cron; `CRON_SECRET` and footprint vars set in Preview + Production.
4. `npm run build` green.
5. MRMS swath backfill run (e.g. `gh workflow run weather-mrms-ingest.yml -f backfill_days=730`).
6. Preview field QA: layers render, wider-window hint works, color ramp legible on a cheap Android outdoors.
7. Claims-safe copy verified in UI ("est.", "recorded", "may have been impacted"; never assert damage or instruct claims).
8. Flip prod flag only after 1–7.

---

## 9. Open questions for the product owner

1. **Exact footprint:** is the Cabarrus ZIP set `28025 28027 28036 28081 28082 28107 28124 28088` the canonical canvassing area to pre-warm, or should it be derived from active `canvass_territories` so it auto-expands as ARX grows? (Recommend territory-derived once it's stable; hardcoded ZIPs to start.)
2. **Cache-key contract:** will the rep-facing `app/api/canvass/weather/route.ts` filter rows spatially against a stored footprint (preferred), or look up exact `bbox|layer|window` keys? This determines whether the job stores a superset footprint or must mirror exact rep bboxes.
3. **Live alerts ownership:** should the daily job own NWS active-alert snapshots at all, or leave live alerts entirely to request-time fetch (since they change through the day)? Recommend: request-time primary, daily snapshot as fallback.
4. **Time window:** how far back should the pre-warmed SPC history go — last storm, 12 months, 24 months (`ROOFRADAR_STORM_YEARS`)? Drives row volume.
5. **Multi-org vs global weather:** is `weather_cache` shared globally (geographic) or scoped per `org_id`? Affects RLS read policy and the `org_id` column's nullability.
6. **Run-log + alerting:** does Nathan want the optional `weather_refresh_runs` table and/or a failure email, or are Vercel logs sufficient?
7. **Phase 2 worker placement:** where should GRIB2 contouring run — GitHub Action, small container, or a proven Deno+gdal edge function? (Needs a spike to confirm tooling.)
8. **Vercel plan limits:** confirm current plan allows a 4th cron and the needed `maxDuration` (blocking item before merge).
