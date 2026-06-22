# Canvass Weather Overlay — Risks & Mitigations (Pre-Mortem)

**Status:** Pre-mortem / design review only. **No application code is changed by this document.**
**Scope:** The planned hail/wind weather overlay on the field-rep Canvass PWA map, as described in
`docs/canvass-weather-overlay-design.md`, `docs/canvass-weather-overlay-ui-spec.md`,
`docs/canvass-weather-refresh-job-spec.md`, and `docs/prompts/canvass-weather-overlay-implementation.md`.
**Audience:** Product owner (Nathan), implementing engineer, reviewer.

> **Honesty contract.** Every numeric, pricing, legal, plan-limit, and third-party-pipeline claim in this
> document is a **recommendation to verify**, not a confirmed fact. The public-domain status of NOAA/NWS
> data is my **understanding to confirm with counsel**, not legal advice. Where I describe how a commercial
> vendor (e.g. HailTrace) sources data, that is an **inference from public marketing**, not verified fact.
> I am an engineer, not a lawyer; everything in §B (Legal/Compliance) must be reviewed by counsel before launch.

---

## 0. Top risks to resolve BEFORE any code is written

These are the decisions/spikes that change the architecture or expose real liability. Resolve them first;
they are cheap on paper and expensive after code exists.

| # | Risk | Why it must be settled first | Hard blocker? |
|---|---|---|---|
| **T1** | **MRMS GRIB2 → GeoJSON cannot run in a Vercel lambda** (GDAL/pyhail native binaries, memory, >60s, no Python). The refresh-job spec already flags this. If Phase 2 is in scope at all, the *processing host* must be chosen before anyone designs the table/feed contract. | Picking the wrong host (Vercel cron) means the swath pipeline silently can't ship, and the table schema/feed contract may be wrong. | **Blocker for Phase 2.** Not a blocker for Phase 1. |
| **T2** | **Sales-ethics / bad-faith claim risk.** Reps telling homeowners "NOAA says your roof has 1.75″ hail damage, file a claim" based on **radar-estimated** data is the single largest *business* risk: it invites storm-chasing/claims-inflation scrutiny and could expose ARX to bad-faith or state-solicitation complaints. | This shapes the **UI copy, the per-home sheet language, and rep training** — all of which are designed *now*. Cannot be bolted on later. | **Blocker.** Counsel + scripted rep language required pre-launch. |
| **T3** | **Auth correctness.** The existing Roof Radar routes use raw `supabase.auth.getUser()` (forbidden by CLAUDE.md) in **three** files (`scan`, `storm-lookup`, `sources`). The new code path must not inherit this. | One copy-paste reintroduces a known violation. Must be a stated constraint and a verification gate. | **Blocker.** Verify unauth → 401 via `requireAuthApi()`. |
| **T4** | **Expectation gap: Phase 1 ≠ HailTrace.** Reps imagine continuous "hail path painted on the map" (swaths). Phase 1 delivers sparse SPC **points** + live NWS **warning polygons** — visibly different and far less impressive. | If reps are told "we have HailTrace now," Phase 1 lands as a disappointment and gets abandoned before Phase 2. Set expectations *before* showing it. | Not a code blocker, but a **launch-comms blocker.** |
| **T5** | **Behavioral risk to the 444 door-count metric.** If the overlay makes reps knock only inside hit zones, total doors knocked drops and the Sisu 444 program (400 doors/week) suffers — directly hitting the core business metric. | The overlay's framing ("sort priority, don't subtract coverage") must be designed in from day one. | Not a code blocker, but a **product-design blocker** for how priority is presented. |

If T1, T2, T3 are not resolved, do not write code. T4 and T5 must be resolved before *launch*, not before code.

---

## A. Data accuracy & trust

### A1. Radar-estimated hail (MESH) is not ground truth
- **Description.** MRMS MESH is a *radar-derived estimate* of maximum hail size, not a measurement of what
  actually fell on a given roof. It is known (my understanding, to verify against NSSL/MRMS docs) to over- and
  under-estimate locally, can be biased by beam height/distance from radar, and is a grid cell value, not a
  per-address value. A "1.75″" swath cell does **not** mean every roof in it took 1.75″ stones.
- **Severity:** High. **Likelihood:** High (it *will* be wrong somewhere, every storm).
- **Mitigation (this stack):**
  - UI already mandates redundant communication (color + text + legend) and a freshness/date label — keep that.
  - Add an explicit **"estimated" qualifier** to every magnitude the rep sees: status strip and the per-home
    sheet must read *"est. up to 1.75″"* / *"radar-estimated"*, never a bare number. This is a copy change in the
    UI spec, not new architecture.
  - Never render swaths as hard-edged certainty; the UI spec's feathered/translucent bands (§6.4) already help —
    keep opacity ≤0.34 and soft edges so it *reads* as an estimate, not a survey.
  - Add a one-time interstitial/tooltip the first time a rep enables the layer: "Estimates from public weather
    radar. Confirm damage with an inspection before discussing claims." (Ties to T2.)
- **Pre-launch?** **Yes** — the "estimated" language is cheap and is the cornerstone of T2 mitigation.

### A2. SPC point sparsity (Phase 1's actual data)
- **Description.** SPC storm reports are **human-reported points**, not coverage. A neighborhood that got hammered
  may have **zero** reports (no one reported it); a single report does not bound the affected area. Phase 1's
  hail layer is therefore sparse and biased toward populated/reported areas. The existing
  `lib/roofradar-open-data.ts` already treats these as points within a radius.
- **Severity:** Med. **Likelihood:** High.
- **Mitigation:**
  - The empty state must say **"No *recorded* hail in this area"** (the UI spec already does this) — never imply
    "no hail occurred." Absence of a point is absence of a *report*, full stop.
  - Do **not** interpolate or buffer SPC points into fake "swaths" that imply continuous coverage; the UI spec's
    soft-disc buffering (§6.4) is acceptable only as a *visual softening of a point*, and the legend/strip must
    keep calling them point reports, not swaths. Resist the temptation to make Phase 1 look like Phase 2.
  - Surface report **count** so a single isolated report doesn't read as a confirmed storm corridor.
- **Pre-launch?** Yes (copy + not faking swaths). Cheap.

### A3. NWS warning polygons ≠ where hail fell
- **Description.** A Severe Thunderstorm/Tornado **warning polygon** describes *where a warned storm may occur over
  a time window*, drawn generously by a forecaster. It is **not** a hail footprint and routinely covers areas that
  saw nothing. The implementation prompt pipes these straight onto the map as the "live" layer.
- **Severity:** Med-High (a rep could pitch an entire warning polygon as "damaged"). **Likelihood:** High.
- **Mitigation:**
  - Label warning features distinctly from historical data: *"Active warning area — storm in progress, not
    confirmed damage."* Different visual treatment (the UI spec already separates live vs historical; enforce the
    copy).
  - In the per-home sheet, a home inside *only* a warning polygon (no SPC report, no MESH) must show
    *"In an active storm warning — no confirmed/estimated hail yet,"* not a magnitude.
  - Decide the strip-headline precedence (UI spec open question #3): recommend **live warning wins the strip when
    active, but is always labeled "warning," and historical magnitude only shows when it exists.**
- **Pre-launch?** Yes.

### A4. Geocoding drift
- **Description.** `lib/roofradar-open-data.ts` geocodes addresses via the **US Census geocoder**, which can miss,
  mismatch, or place a point off by a parcel or more, especially rural/new-construction. For the overlay this
  matters less (overlay renders report lat/lng directly, not geocoded addresses), but the **per-home sheet's
  "hail at this address"** depends on associating a lead's location with nearby reports.
- **Severity:** Low-Med. **Likelihood:** Med.
- **Mitigation:**
  - Use the **pin's own lat/lng** (already captured precisely on the map / rep geo-tag) for the per-home magnitude
    lookup, not a re-geocode of the address string. This avoids Census drift entirely for the sheet.
  - Keep the existing radius model (`ROOFRADAR_STORM_RADIUS_MILES`, default 8 mi) honest by **showing distance**:
    "nearest report 3.2 mi away" so an 8-mile association doesn't masquerade as "at this address."
- **Pre-launch?** Yes if the per-home sheet rows ship; otherwise fast-follow.

### A5. "Homes in path" denominator is misleading
- **Description.** The UI spec's strip shows *"14 homes in path."* It is computed client-side from **loaded pins
  in the viewport** (existing leads), not all parcels. It will under-count (only existing leads) and could be read
  by a rep as "14 confirmed damaged homes."
- **Severity:** Med. **Likelihood:** High (reps will quote it).
- **Mitigation:**
  - Reword to remove the certainty: **"14 of your pins in this area"** or drop the metric for v1 (UI spec open
    question #1 already flags this). Recommend **dropping or rewording** — it is the most quotable, most
    misleading number on the screen.
- **Pre-launch?** Yes — reword/remove before reps see it.

---

## B. Legal / compliance / sales ethics
**All of §B is risk-flagging for counsel review, not legal advice. I am not a lawyer.**

### B1. Bad-faith / claims-inflation exposure (the T2 risk)
- **Description.** Roofing storm-chasing is under active regulatory and insurer scrutiny in many states. A rep
  using ARX's own map to tell a homeowner "you have damage, file a claim" — based on **estimated** radar data —
  could (my understanding, verify) contribute to allegations of inducing unwarranted claims, unlicensed adjusting,
  or deceptive solicitation.
- **Severity:** High. **Likelihood:** Med (low per-interaction, high cumulative across many reps).
- **Mitigation:**
  - **Scripted rep language**, trained and documented: the rep may say *"public weather data shows this area may
    have been hit — worth a free inspection to check,"* and **may not** say *"you have X inches of damage / you
    should file a claim."* The overlay is a **canvassing prioritizer, not a damage assessment or claims tool.**
  - The first-run interstitial (A1) doubles as a compliance acknowledgement.
  - The per-home "priority tag" (UI spec §5.2) must be framed as **knock priority** ("Knock first"), never as
    **damage likelihood** ("Likely damaged"). Confirm wording with counsel.
  - Keep an audit note: the data shown is third-party public-domain estimate, displayed for canvassing
    prioritization.
- **Pre-launch?** **Blocker.** Counsel sign-off + rep script.

### B2. Data licensing / attribution
- **Description.** NOAA/NWS/MRMS/SPC data is, to my understanding, U.S.-government **public domain** and free to
  use. **Verify this** — and verify any **ArcGIS Hub "Northern Hail Project"** layers separately, which the design
  doc explicitly could not confirm coverage/licensing for and flagged as a reference pattern, not a turnkey feed.
- **Severity:** Med (low for NOAA proper; higher for third-party derived layers). **Likelihood:** Low for NOAA.
- **Mitigation:**
  - Add an **attribution line** in the legend/about ("Source: NOAA/NWS/SPC, public domain — verify"). Cheap.
  - Set the NWS-required **`User-Agent`** header (refresh-job spec §3.4 already calls this out) — omitting it can
    get ARX throttled/blocked and is also the polite/contractual expectation.
  - **Do not** integrate any ArcGIS/third-party derived layer until its license + coverage are confirmed in
    writing.
- **Pre-launch?** Attribution + User-Agent: yes. ArcGIS: don't ship it in Phase 1 anyway.

### B3. State roofing-solicitation regulation tied to storm data
- **Description.** Some states regulate post-storm roofing solicitation (cooling-off periods, prohibitions on
  offering to pay/waive deductibles, registration after declared disasters). Tying canvassing routes to storm data
  *may* intersect these. **Counsel must confirm for NC and any expansion state.**
- **Severity:** Med-High. **Likelihood:** State-dependent.
- **Mitigation:** Counsel review of NC + target states before launch; document allowed/forbidden rep behavior.
  This is policy, not code.
- **Pre-launch?** **Blocker** (counsel confirmation that current canvassing + this overlay is compliant in NC).

---

## C. Infrastructure / compute (the T1 priority)

### C1. MRMS GRIB2 → GeoJSON does not fit a Vercel serverless/cron lambda
- **Description.** Phase 2 contouring needs GDAL (`gdal_contour`) / `pyhail` / Python — native binaries and
  memory/CPU that **Vercel's Node lambdas do not provide**, plus likely >60s runtime. The refresh-job spec already
  reaches this conclusion; this pre-mortem confirms it and makes it the **#1 architecture decision**.
- **Severity:** High. **Likelihood:** Certain (it simply won't run in-lambda).
- **Mitigation (concrete, ranked):**
  1. **GitHub Actions scheduled workflow** (cron) running a container with GDAL+Python that fetches yesterday's
     MRMS, contours by hail-size band, emits GeoJSON, and **upserts directly into Supabase** (`weather_swaths`)
     via the service role. **Recommended:** free for this volume, no new always-on infra, logs in one place,
     idempotent re-run. This is the cleanest fit for a small team.
  2. A **small scheduled container** (Fly.io / Render / Railway / a cheap VM cron) doing the same. More control,
     small cost, more to operate.
  3. **Supabase Edge Function (Deno) only if** a Deno+GDAL path is proven in a spike — the refresh-job spec
     doubts this; treat as unlikely.
  - In all cases: **the Vercel cron route never touches GRIB2.** Its only Phase 2 job is to *verify freshness* /
    record the run / optionally snapshot live NWS. The heavy worker writes `weather_swaths`; the rep-facing route
    reads it. This keeps the Vercel side within its limits.
  - **Idempotency:** upsert on `(event_date, layer, source, magnitude)` (per the spec) so re-runs don't duplicate.
- **Pre-launch (Phase 2)?** **Blocker for Phase 2.** Spike the GitHub Action contouring pipeline before building
  the table contract. **Phase 1 has none of this** — Phase 1 is the safe ship.

### C2. Vercel cron count / duration limits
- **Description.** The repo already runs **3** crons (`vercel.json`: two hourly, one daily at `0 3`). Adding a 4th
  may exceed the plan's cron count; the contouring (if ever in-lambda — see C1, don't) would exceed `maxDuration`.
  **Verify the current plan's cron count + duration cap — recommendation, not fact.**
- **Severity:** Med. **Likelihood:** Med.
- **Mitigation:** If cron count is capped, **fold the daily weather pre-warm into the existing daily cron**
  (`cleanup-inspection-photos` at `0 3`) or trigger the same secured route from the **GitHub Action** (C1) — one
  scheduler, no extra Vercel cron. The route design is identical either way (refresh-job spec §1.2).
- **Pre-launch?** Verify before merging the refresh job; not relevant to the Phase-1 *overlay UI* itself.

---

## D. Performance on field phones

### D1. Vertex-heavy polygons over satellite + clustering + offline app
- **Description.** The map already runs: a **MarkerClusterer** in viewport mode, imperative marker management,
  territory polygons, hybrid/satellite tiles, and a Zustand offline store. Adding a `google.maps.Data` layer of
  many MESH contour polygons (Phase 2 especially) on a mid-range Android in sunlight risks FPS drops, battery
  drain, and cellular data burn while a rep walks.
- **Severity:** Med-High (Phase 2), Low-Med (Phase 1 points). **Likelihood:** Med-High at scale.
- **Mitigation (this stack):**
  - **Geometry simplification server-side** before storage: simplify MESH contours (Douglas–Peucker / `gdal`
    `-simplify`) to a vertex budget per band; store the simplified GeoJSON in `weather_swaths`. Reps never receive
    full-resolution contours.
  - **Zoom-gating:** mirror `useViewportLeads`' `MIN_ZOOM_FOR_FETCH = 10` — don't fetch/render swaths below a
    minimum zoom; at low zoom show nothing or a coarse heat hint only.
  - **Payload cap:** the API route caps features returned per bbox (e.g. drop/merge the lowest-magnitude band
    first when over budget, per UI spec §10) and returns a `truncated` flag.
  - **Single paint:** `addGeoJson()` once + function-based `setStyle` (UI spec §3.2) — never per-feature animation.
  - **Debounce + explicit refresh:** UI spec §4.3 recommends explicit "Refresh storm data" over auto-refetch on
    every `idle`; **keep that** — the map already fires `idle` for pin loading (debounced 400ms in
    `useViewportLeads`), and piggybacking weather on every idle would double request volume and stutter the
    clusterer mid-walk. Debounce any programmatic refetch ≥600ms.
  - Consider **vector tiles** over raw GeoJSON only if Phase 2 volume proves GeoJSON too heavy — but that adds a
    tile server (infra), so defer unless measured.
- **Pre-launch?** Zoom-gating + payload cap + explicit-refresh: yes (cheap, in the route/UI). Simplification:
  required *for Phase 2* (part of the worker). Vector tiles: only if measured.

### D2. Cellular data / battery during a full canvassing day
- **Description.** Reps walk for hours on cellular. Repeated swath fetches + satellite tiles + GPS is heavy.
- **Severity:** Med. **Likelihood:** Med.
- **Mitigation:** explicit refresh (above), short server-side cache TTL so repeated bbox hits are cheap, and a
  **client-side cache of the last FeatureCollection** keyed by bbox so panning back doesn't refetch. Don't poll.
- **Pre-launch?** Yes — explicit refresh covers most of it.

---

## E. Endpoint fragility & maintenance

### E1. Free government endpoints change / outage / rate-limit silently
- **Description.** `api.weather.gov`, `spc.noaa.gov/wcm/data/*.csv`, MRMS, and the Census geocoder are free gov
  endpoints that can change format (column renames in SPC CSVs), go down, or throttle. The existing SPC parser is
  already defensive (`readCell` tries multiple header aliases; non-OK → cached empty array), which is good — but
  failures are currently **silent** (return `[]`).
- **Severity:** Med. **Likelihood:** Med (gov endpoints do shift; SPC CSV schema has changed historically).
- **Mitigation:**
  - **Monitoring/alerting:** the refresh-job spec's optional `weather_refresh_runs` table + failure email
    (Nodemailer, already configured) should be **promoted to required** — it's the only way to learn the morning
    feed broke before reps notice. Email `nathan@arxroofing.com` on `failed`/`partial`.
  - **Format-change resilience:** keep the alias-tolerant parser; add a sanity check (e.g. "parsed 0 rows from a
    non-empty CSV" → treat as failure, keep prior rows, alert) so a column rename doesn't silently zero the layer.
  - **Set the NWS `User-Agent`** (B2) to avoid being throttled in the first place.
  - **Fail soft, keep last-good:** the route returns 200 + empty FeatureCollection on upstream error (per the
    implementation prompt), and the read path serves last-good DB rows with a stale badge.
- **Pre-launch?** Monitoring/alerting + sanity check: yes (cheap, prevents silent rot). Promote the run-log table
  from "optional" to "ship it."

---

## F. Staleness & live-vs-cached seam

### F1. Once-daily refresh misses intraday storms
- **Description.** The refresh job runs once at ~09:00 UTC. A storm at 2 p.m. local isn't in the cache until next
  morning. For **hail history** that's fine; for **live warnings** it's a real gap.
- **Severity:** Med. **Likelihood:** High during storm season.
- **Mitigation:** Per the refresh-job spec §3.2 — **live NWS alerts are fetched at request time** (cheap, keyless,
  single request), the daily snapshot is only a fallback if NWS is down. So intraday warnings appear live;
  SPC/MESH history is the part that's daily, which is correct (historical data doesn't change intraday).
- **Pre-launch?** Yes — the read route must fetch NWS live, not rely on the daily snapshot for warnings.

### F2. Live vs cached showing different things / honest freshness labeling
- **Description.** Live NWS (request-time) and cached historical (daily) can disagree on screen; a rep needs to
  know which is which and how fresh.
- **Severity:** Med. **Likelihood:** High.
- **Mitigation:** The read path returns `refreshed_at` and the UI shows "as of {date/time}" + amber stale dot (UI
  spec §3.3). Recommend: **6h freshness threshold for live warnings; event-date labeling for historical** (don't
  call dated hail "stale," show the storm date). Visually separate warning features from historical features.
- **Pre-launch?** Yes — freshness labeling is core to honesty (ties to A1/A3).

---

## G. Offline-first conflict

### G1. Overlay behavior with no connectivity
- **Description.** The canvass app is offline-first: pins are queued in a **Zustand `persist` store**
  (`offlineStore.ts`) and synced when back online. Weather data requires network. Behavior offline must be defined
  and must **never touch the offline queue.**
- **Severity:** Med. **Likelihood:** High (reps lose signal constantly).
- **Mitigation:**
  - **Hard isolation:** the weather layer is a separate `google.maps.Data` instance and a separate fetch path.
    It must **never** read/write `useOfflineStore`, `pendingLeads`, `markersRef`, `markerClustererRef`, or
    `territoryPolygonsRef`. A weather fetch failure must not enqueue anything or block sync.
  - **Offline UX:** show last-known cached swaths if present ("Offline — last data shown," amber); if none, muted
    "Offline — no stored storm data." Map stays fully interactive; knock logging unaffected (UI spec §10 already
    specifies this).
  - **Caching mechanism nuance (real finding):** `offlineStore.ts` uses Zustand `persist` with the **default
    storage = `localStorage`**, *not* IndexedDB. The CLAUDE.md says "Zustand + IndexedDB," but the code persists to
    localStorage. **localStorage is small (~5MB) and synchronous** — do **not** persist weather GeoJSON there or
    you risk evicting/colliding with the pin queue and jank on the main thread. If you want offline weather
    survival across relaunch, use a **separate IndexedDB store** (e.g. `idb-keyval`) for the last FeatureCollection,
    completely separate from the pin queue. For v1, an **in-memory client cache** (lost on reload) is the safe,
    zero-risk choice; persistent offline weather is a fast-follow.
- **Pre-launch?** Isolation from the queue: **yes, hard requirement.** Persistent offline weather: fast-follow
  (in-memory cache for v1).

---

## H. Behavioral risk to the core metric (the T5 risk)

### H1. Overlay reduces total doors knocked / encourages cherry-picking
- **Description.** ARX's engine is *coverage* — door-to-door volume, codified in the Sisu **444** program (400
  doors knocked + 4 inspections set per week, per `program_444_enrollments`). If reps knock only inside hit zones,
  total knocks fall and 444 qualification drops — the overlay would *hurt* the core metric it's meant to help.
- **Severity:** High (it's the core business metric). **Likelihood:** Med-High (reps optimize to whatever the tool
  rewards).
- **Mitigation (product framing, designed now):**
  - Frame the overlay as **route prioritization, not a coverage filter**: "knock these *first*," never "skip the
    rest." The UI spec's "Knock first / Worth a look / Low signal" tags already do this — **keep "Low signal," do
    not relabel it "skip."**
  - **Never gate pins** behind the overlay; all pins always render and are always tappable (already a hard
    constraint). The overlay sorts, it doesn't subtract.
  - **Decouple incentives:** 444 counts doors regardless of weather; do **not** weight 444 door credit by hit
    zone. Keep the door-count program orthogonal to the overlay.
  - **Watch the metric:** after launch, monitor total knocks/rep vs pre-launch. If knocks drop, the framing is
    wrong — treat as a launch KPI, not an afterthought.
- **Pre-launch?** Framing + no-gating: **yes** (it's how the feature is presented). Metric monitoring: at launch.

---

## I. Auth correctness (the T3 risk)

### I1. New code path must not inherit raw `supabase.auth.getUser()`
- **Description.** Confirmed in code: `app/api/admin/roofradar/scan/route.ts:39`,
  `.../storm-lookup/route.ts:123`, `.../sources/route.ts:15` all use raw `supabase.auth.getUser()` — the pattern
  CLAUDE.md forbids. The new rep-facing route must use `requireAuthApi()`.
- **Severity:** High (security correctness + explicit project rule). **Likelihood:** High if copy-pasted from Roof
  Radar.
- **Mitigation:**
  - Rep-facing route `app/api/canvass/weather/route.ts`: **`requireAuthApi()`**, return 401 when absent
    (implementation prompt already specifies this).
  - Cron/refresh route `app/api/cron/weather-refresh/route.ts`: **`Bearer ${CRON_SECRET}`** check, *not*
    `requireAuthApi()` — a machine cron has no session cookie. Mirror `sync-444/route.ts` exactly (read confirms
    the 503-if-unset / 401-if-mismatch pattern). Writes via `createServiceClient()`.
  - **Verification gate:** the implementation prompt's required verification agent + `security-review` must
    explicitly assert unauth → 401 on the rep route and 401/503 on the cron route. Treat any finding as a blocker.
  - **Bonus:** consider fixing the three existing Roof Radar routes in a *separate* PR (don't bundle), but at
    minimum do not propagate the pattern.
- **Pre-launch?** **Blocker.**

---

## J. Data / storage growth & retention

### J1. Daily swath geometries accumulate
- **Description.** Phase 2 writes daily contoured polygons to `weather_swaths`; over a year that's hundreds of
  event-days × multiple magnitude bands × geometry. Plus `weather_cache` (SPC points/NWS snapshots) and the
  proposed `weather_refresh_runs` log. Unbounded growth bloats the DB and slows spatial queries.
- **Severity:** Low-Med. **Likelihood:** Med (slow burn).
- **Mitigation:**
  - **Retention policy aligned to the claim window:** the UI/design default is **365 days** (carrier claim windows
    ~1 year — *verify with Andrew/back office*). Prune `weather_swaths` / `weather_cache` rows older than the
    retention window in the same cron (or a monthly cleanup, mirroring `cleanup-inspection-photos`).
  - **Index for the read path:** index `(event_date, layer)`; if PostGIS is enabled, a GiST index on geometry —
    **verify the extension is on** (`list_extensions`); if not, store GeoJSON as `jsonb` and bbox-filter in app
    code (refresh-job spec §4.2 already covers this).
  - **Geometry simplification at write time** (D1) also caps per-row size.
  - All new tables **additive, nullable, RLS-enabled** per CLAUDE.md.
- **Pre-launch?** Retention + index: ship with Phase 2 (not relevant to Phase 1, which adds no tables).

---

## K. Expectation gap (the T4 risk)

### K1. Phase 1 (points/warnings) vs the swaths reps imagine
- **Description.** Reps picture HailTrace-style continuous swaths. Phase 1 = sparse SPC points + generous NWS
  warning polygons. Visibly less, and easy to dismiss as "broken" or "useless."
- **Severity:** Med-High (adoption risk). **Likelihood:** High.
- **Mitigation:**
  - **Name and frame honestly at launch:** "Phase 1 = free public storm *reports + live warnings* to help
    prioritize streets; true hail *swaths* are coming in Phase 2." Don't call Phase 1 "HailTrace."
  - **Lead with the live-warning value** (the part that *does* look good — real polygons during active storms) and
    the per-home context, not the sparse historical dots.
  - Tie launch comms to the empty-state copy (A2): "no *recorded* hail" teaches reps that points ≠ coverage.
  - Set a visible Phase 2 commitment so reps know swaths are coming, reducing "this is it?" abandonment.
- **Pre-launch?** **Launch-comms blocker** — set expectations before the first rep opens it.

---

## L. Decision checklist for the product owner

Tick these before code; the **bold** ones are hard blockers.

**Blockers (resolve before any code):**
- [ ] **(T2/B1)** Counsel sign-off on storm-data-driven solicitation; scripted, trained rep language ("may have
      been hit — free inspection" vs forbidden "you have damage / file a claim").
- [ ] **(B3)** Counsel confirms NC (and any expansion state) roofing-solicitation rules are satisfied.
- [ ] **(T3/I1)** Confirm rep route uses `requireAuthApi()`, cron route uses `CRON_SECRET`; verification agent +
      `security-review` assert unauth → 401. Do not inherit the Roof Radar `getUser()` pattern.
- [ ] **(T1/C1)** *If Phase 2 is in scope:* choose the contouring host (recommend GitHub Action + GDAL container
      writing `weather_swaths`); spike it before designing the feed/table contract. *Phase 1 needs none of this.*

**Launch-comms / product-design blockers (resolve before launch):**
- [ ] **(T4/K1)** Launch messaging sets Phase 1 ≠ HailTrace; Phase 2 swaths promised.
- [ ] **(T5/H1)** Confirm framing is "prioritize, don't filter"; pins never gated; 444 door credit stays
      orthogonal to hit zones; total-knocks-per-rep is a launch KPI.

**Data-honesty (cheap, do them):**
- [ ] (A1) Every magnitude reads "est." / "radar-estimated"; first-run interstitial about estimates + claims.
- [ ] (A2) Empty state says "no *recorded* hail"; Phase 1 points not dressed up as swaths.
- [ ] (A3) Warning polygons labeled "active warning, not confirmed damage."
- [ ] (A5) "Homes in path" reworded ("your pins in this area") or dropped for v1.
- [ ] (B2) NOAA public-domain status verified with counsel; attribution line added; NWS `User-Agent` set; no
      ArcGIS/third-party layer until license + coverage confirmed.

**Engineering hygiene:**
- [ ] (G1) Weather layer fully isolated from `useOfflineStore` / pin refs; weather failure never enqueues or blocks
      sync. v1 uses in-memory client cache (not localStorage); persistent offline weather via a *separate*
      IndexedDB store is a fast-follow.
- [ ] (D1) Zoom-gate (≥ existing `MIN_ZOOM_FOR_FETCH`), payload cap + `truncated` flag, single-paint styling,
      explicit "Refresh storm data" (no per-idle auto-refetch). Server-side simplification for Phase 2 swaths.
- [ ] (E1) Promote `weather_refresh_runs` + failure email from "optional" to required; add "parsed 0 rows from
      non-empty CSV → fail + keep last-good" sanity check.
- [ ] (F1/F2) Live NWS fetched at request time; historical from cache; `refreshed_at` returned; freshness labeled
      honestly (6h live / event-date historical — confirm).
- [ ] (J1) Retention policy (~365d, confirm with back office) + indexes; verify PostGIS before relying on
      `geography`/GiST.
- [ ] (C2) Verify Vercel cron count + `maxDuration` on the current plan, or fold into existing daily cron /
      trigger from the GitHub Action.

**Open product questions carried from the specs (confirm):** default layer = Hail; default window = 365d; remember
last-used layer per device; live-vs-historical strip precedence; swaths visual-only vs tappable callout; priority-tag
thresholds; wind ≥70 styling (dashed dark-red vs hatch); roof-age/claim-status availability in the lead record.

---

## M. Severity × likelihood summary (at a glance)

| Risk | Sev | Likelihood | Pre-launch? |
|---|---|---|---|
| A1 Radar estimate ≠ truth | High | High | Yes (copy) |
| A2 SPC point sparsity | Med | High | Yes (copy) |
| A3 Warning polygons ≠ hail | Med-High | High | Yes (copy) |
| A4 Geocoding drift | Low-Med | Med | Conditional |
| A5 "Homes in path" denominator | Med | High | Yes (reword) |
| B1 Bad-faith / claims-inflation | High | Med | **Blocker** |
| B2 Licensing / attribution | Med | Low (NOAA) | Yes (attribution/UA) |
| B3 State solicitation rules | Med-High | State-dep | **Blocker** |
| C1 MRMS not in lambda | High | Certain | **Blocker (Phase 2)** |
| C2 Vercel cron limits | Med | Med | Verify |
| D1 Polygon perf on phones | Med-High | Med-High | Yes (gate/cap) |
| D2 Data/battery | Med | Med | Yes (explicit refresh) |
| E1 Endpoint fragility | Med | Med | Yes (monitor) |
| F1 Daily refresh misses intraday | Med | High | Yes (live NWS) |
| F2 Live vs cached labeling | Med | High | Yes (freshness) |
| G1 Offline-first conflict | Med | High | Yes (isolation) |
| H1 Hurts 444 door count | High | Med-High | Yes (framing) |
| I1 Auth (`getUser()`) inheritance | High | High | **Blocker** |
| J1 Storage growth/retention | Low-Med | Med | Phase 2 |
| K1 Expectation gap | Med-High | High | Launch-comms blocker |

*End of pre-mortem. No application code was modified. All numeric, pricing, plan-limit, and legal statements are
recommendations to verify, not confirmed facts.*
