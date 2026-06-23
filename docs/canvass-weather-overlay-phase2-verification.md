# Canvass Weather Overlay — Phase 2 Verification & Sign-off

Date: 2026-06-22. Branch: `feat/canvass-weather-overlay-phase2` (commit `22e6ab5` + post-review hardening). Verifies the Phase 2 build (MRMS hail swaths) against the design, via code review, a bug-hunt pass, and live Supabase MCP checks. No production data was modified; the additive migration was already applied.

## What Phase 2 added
- **MRMS MESH hail swaths**: a GitHub Action (`.github/workflows/weather-mrms-ingest.yml`) installs GDAL, runs `scripts/weather-mrms-worker/contour_mesh.py` to contour NOAA MRMS MESH (from the public `noaa-mrms-pds` S3 bucket) into hail-size polygons, and POSTs them to an ingest route. **Heavy GRIB2/GDAL work runs in the Action, not Vercel** — as designed.
- **Durable storage** (`lib/weather-storage.ts`): tables `weather_cache` (reports/warnings), `weather_swaths` (MESH polygons), `weather_refresh_runs` (observability).
- **Daily pre-warm cron** (`app/api/cron/weather-refresh/route.ts`, Vercel `0 9 * * *`) warms `weather_cache` from IEM + NWS.
- **Ingest route** (`app/api/cron/weather-swaths-ingest/route.ts`) receives the Action's POST (service-role write).
- **Rep route** now reads `weather_cache` + `weather_swaths` (hail) + live NWS in parallel, **falls back to live IEM** when cache is empty, returns the same `FeatureCollection` shape plus a `stale` flag (>36h old).
- Swath polygons render via the overlay lib's `kind:'swath'` branch; pins stay on top (`clickable:false`).
- (Bundled, unrelated) a "report a field issue" feature — see Scope note.

## Supabase MCP verification (project `anzqkklwcgaoeunzpqjh`)
- `weather_cache`, `weather_swaths`, `weather_refresh_runs` **exist**, all **RLS-enabled**, 0 rows (migration already applied; pipeline not yet run).
- Policies confirmed via `pg_policies`: each table has exactly one **SELECT** policy for role `authenticated`; **no INSERT/UPDATE/DELETE policies** → writes are service-role only. Matches the design rule (reps read public geo, only the cron/worker writes).
- Migration file is additive (`CREATE TABLE IF NOT EXISTS`, nullable `org_id`, RLS on). Note: it is **not recorded in `supabase_migrations` history** (tables were created directly), so a future `supabase db push` is harmless (IF NOT EXISTS) but the history is out of sync — see Open items.

## Bug-bot review — findings & resolution
A read-only bug-hunt agent audited the commit. Result: architecture sound, auth/flag-off/SSRF posture correct. One must-fix and several cleanups; status below.

| # | Sev | Issue | Status |
|---|-----|-------|--------|
| 1 | High | Ingest endpoint inserted **unbounded/unvalidated** payloads with the service role (DoS/bloat). | **FIXED** — body-size cap (8 MB), max 1000 features, max 6000 vertices/feature, magnitude ≤ 8″; over-limit features skipped (counted in response), oversized batch → 413. |
| 2 | Med | `clampWindowDays(730)` no-op / misleading in retention delete. | **FIXED** — uses a clear `730`-day literal with comment; removed unused import. |
| 3 | Med | `responseCache` grew unbounded (raw-float bbox keys, no eviction). | **FIXED** — bbox rounded to 2 dp in the key; expired entries pruned when size > 200. |
| 8 | Low | Swath `count` query not wrapped in try/catch → could 500 the cron after work succeeded. | **FIXED** — wrapped; pushes to `errors[]`. |
| 9 | Low | `errors.length >= 5` → 'failed' was arbitrary. | **FIXED** — 'failed' only when all 4 data-fetch steps (iem/nws × hail/wind) error; prune/count errors stay 'partial'. |
| 4 | Med | Cached NWS warnings could be served stale if NWS is down (age guard). | **Deferred** (fast-follow) — warnings carry `expires`; UI handles it. |
| 5 | Med | `contour_mesh.py` could silently emit empty output if the MRMS grid CRS/lon-convention mismatches (no-data looks like a clear day). | **Deferred** — add a valid-pixel check in the worker; surface in Action logs. |
| 6 | Low | Per-request `createServiceClient()`; reads bypass RLS. | Deferred — acceptable; reads are intentionally service-role. |
| 7 | Low | `maxIsoTimestamp` lexical sort assumes uniform ISO format. | Deferred — works for current formats. |
| 10 | Info | `weather_refresh_runs` SELECT exposes run `error` strings to all authenticated users. | Deferred — consider restricting to admin/owner/operations. |

Post-fix lint: `npx eslint` clean on all three edited routes. (Full `tsc --noEmit` / `next build` to be run in the dev environment — sandbox can't complete it in time.)

## Pre-existing security advisory (NOT weather — surfaced for awareness)
Supabase advisors flagged a **critical, pre-existing** issue unrelated to this work: `public.contract_events` and `public.estimate_line_items` have **RLS disabled** (exposed to anon/authenticated). This predates the weather feature. Remediation is a product decision (enabling RLS without policies blocks all access), so it is **not** auto-applied here:
```sql
ALTER TABLE public.contract_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_line_items ENABLE ROW LEVEL SECURITY;
```
Recommend the team review and add appropriate policies. Ref: https://supabase.com/docs/guides/database/postgres/row-level-security

## Scope note
Commit `22e6ab5` also bundles an unrelated "report a field issue" feature (`CanvassReportIssue.tsx`, `app/api/feedback/submit` recipient change `nathan@`→`info@arxroofing.com`, settings entry). Harmless but not weather — ideally a separate commit/PR. The feedback-recipient change is easy to miss in a weather review.

## Deploy prerequisites (Phase 2 produces no swaths until these are set)
1. Migration already applied to `anzqkklwcgaoeunzpqjh` (confirmed). Reconcile migration history if you use `supabase db push`.
2. **GitHub repo** vars/secrets: `CRON_SECRET` (secret), `WEATHER_SWATHS_INGEST_URL`, `WEATHER_FOOTPRINT_N/S/E/W`, and var `NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY=true` (the Action step is gated on it).
3. **Vercel**: now **4 crons** — verify the plan allows a 4th; set `CRON_SECRET` in Vercel env.
4. Run `npm run build` in CI/dev to confirm the full type-check passes.
5. Gate before field use: counsel sign-off on claims-safe copy (carried from Phase 1).

## Verdict
Phase 2 is **code-complete and safe to merge** after the must-fix (#1) — now fixed — and a `npm run build` pass. Remaining items are fast-follows. The pipeline will populate swaths once the GitHub/Vercel config above is in place.

---

## Post-merge Bugbot triage (2026-06-22) — RESOLVED in PR #5 (pending merge)

PR #3 (Phase 2) and PR #4 (`95ca488`, hardening: worker crop guard, expired-warning filter, admin-only `weather_refresh_runs` RLS) are merged to `main`. A Bugbot pass over the merged+hardened code surfaced the 8 items below (3 high). **All 8 are fixed in PR #5** (`feat/weather-phase2-bugfixes`); build compiled, eslint clean on changed files, flag still OFF. Status once PR #5 merges: no open weather-code items remain — only the human deploy checklist + counsel sign-off gate the prod flag.

| # | Sev | File | Issue | Planned fix |
|---|-----|------|-------|-------------|
| B1 | High | `lib/weather-storage.ts` (`replaceWeatherCacheSnapshot`, ~213) | Returns early when `rows` empty → a zero-active-alert NWS refresh never deletes prior warning rows; stale (early-cancelled, future-`expires`) warnings keep serving when live NWS fails. | Treat empty snapshot as authoritative: still delete prior `(source,layer)` rows when `rows` is empty. |
| B2 | High | `app/api/canvass/weather/route.ts` (catch) | Internal error returns 200 + empty FeatureCollection — indistinguishable from "no storms nearby." | Keep 200 but add `degraded:true`; `CanvassMap.tsx` shows "Couldn't load — tap to retry" on `degraded`, not the empty message. |
| B3 | High | `lib/weather-storage.ts` (swath read) | 2000-row read cap vs 730-day scope could truncate. | Ensure read is bbox + `event_date >= now-730d` filtered before the cap; order by `event_date desc, magnitude desc`; document the limit. |
| B4 | High | `app/api/cron/weather-swaths-ingest/route.ts` + `contour_mesh.py` | 1000-feature ingest cap may be smaller than a worker batch → silent truncation/413. | Chunk worker POSTs to ≤1000 features (same day/layer/source) or raise the cap to a documented max; the two must agree. |
| B5 | Med | `app/api/canvass/weather/route.ts` (~104) | 30-min `responseCache` returns prebuilt body without re-running the expiry filter → expired warnings served up to 30 min. | Re-filter warnings on cached read, or compute warnings fresh / exclude from cache. |
| B6 | Med | `lib/weather-storage.ts` (`replaceWeatherSwathsForDay`, ~248-268) | Delete-before-insert; failed insert leaves the day with no swaths. | Insert first then delete stale, or wrap in a transaction. |
| B7 | Med | `scripts/weather-mrms-worker/contour_mesh.py` (~281) | No-hail day exits without ingest → prior `eventDate` swaths orphaned. | POST an explicit `clear:true` (empty features); add a clear path in the ingest route. Keep distinct from the crop-error exit (PR #4). |
| B8 | Med | `app/api/cron/weather-swaths-ingest/route.ts` (~58) | 8 MB cap only triggers on a truthful `Content-Length`. | Read raw body text with a hard byte cap before `JSON.parse`. |

**All B1–B8 fixed in PR #5** (build/lint green, flag OFF). Verify the fixes on merge, then the prod flag is gated only by the human checklist below.

Also outstanding (non-weather, from collateral scan): confirm the global **feedback routing change** (`nathan@`→`info@`) and the canvass "Report Issue" UI bundled in commit `22e6ab5` are intended org-wide — product/ops decision, not a weather blocker.
