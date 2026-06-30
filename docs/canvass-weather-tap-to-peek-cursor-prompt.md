# Cursor Prompt — Canvass Weather Overlay: tap-to-peek + light-gray storm pins

> Paste everything below the line into Cursor (Composer / agent mode) with the
> ARX CRM repo open. It is scoped to the canvass weather overlay only.

---

You are working in the ARX Roofing Next.js 14 / TypeScript CRM. This task touches the
**canvass weather overlay** (hail/wind storm data on the field-rep canvassing map).
The overlay is behind the `NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY` flag — **leave that flag
behavior unchanged; it stays OFF in prod.** All changes must be additive and nullable-safe;
the app is live and in daily use.

## Project rules you must follow
- Auth: any API route uses `requireAuthApi()` (throws → wrap in try/catch → 401). Never use raw `supabase.auth.getUser()`.
- **Text/contrast is a recurring problem in this build.** Use explicit dark text (`#2c2c2a`) on light surfaces. Never place text or low-contrast marks directly on the satellite map without a solid/opaque background. Target WCAG AA; assume a cheap Android in direct sunlight.
- Keep all storm copy **claims-safe**: always "est.", "may have been impacted", "free inspection". Do not assert confirmed damage. Reuse the existing strings — do not invent new claims language.

## Files in scope
- `app/(canvass-app)/canvass/lib/weather-overlay.ts` — styling + `lookupPinStorm()` + legends (pure logic, no React).
- `app/(canvass-app)/canvass/components/CanvassMap.tsx` — Google Map, base-map click listener (~line 544), `weatherDataRef` Data layer (~line 459), `applyWeatherDataStyle`.
- `app/(canvass-app)/canvass/components/LeadModal.tsx` — currently renders the per-house storm card (~lines 337–385) via `lookupPinStorm`.
- `app/(canvass-app)/canvass/page.tsx` — owns `weatherContext` state, `weatherOverlayEnabled`, `handleMapClick` (~line 247), renders `<CanvassMap>` and `<LeadModal>`.

---

## CHANGE 1 — Storm report pins become light gray (de-camouflage from canvass pins)

**Problem:** In knocked areas the colored storm *report dots* (hail warm-ramp; wind orange/red)
look like the colored canvass disposition teardrop pins, so reps can't find the storm dots.

**Do this in `weather-overlay.ts → weatherFeatureStyle()`** (only the `report` / point-icon
branches — do NOT change the `swath` polygon or `warning` polygon fills, which are area
shapes, not pins):

- Make **all storm report dots a uniform light gray fill** with a darker-gray stroke so they
  stay legible on satellite imagery in sun. Use:
  - fill `#D1D5DB` (light gray), `fillOpacity` `0.9`
  - stroke `#374151` (dark slate gray), `strokeOpacity` `1`, `strokeWeight` `1.5`
- **Keep severity readable without color** by scaling dot **size** with magnitude (and you may
  bump `strokeWeight` slightly for the most severe). Suggested `scale` ramp:
  - hail: `<1″` → 5, `1–1.75″` → 6.5, `≥1.75″` → 8
  - wind: `<58 mph` → 5, `58–70` → 6.5, `≥70` → 8
  - wind-damage reports (no measured value): 5.5 (this already renders gray — unify it to the same `#D1D5DB`/`#374151` values so all report dots match)
- This makes `hailBucket()` / `windBucket()` colors no longer drive the **dot** fill. Those
  buckets are still used by the **swath** polygons — leave that usage intact. Only the
  point/icon styling switches to gray.

**Update the legends accordingly** (`HAIL_LEGEND`, `WIND_LEGEND`, and the legend UI in
`CanvassMap.tsx` that reads them, ~lines 983–1000):
- The **dot** legend should now communicate "storm report = gray dot, bigger = stronger"
  rather than a per-severity color swatch. A simple, honest version: one gray-dot row labeled
  "Storm report (bigger = stronger)" plus, for hail only, keep the swath color ramp rows since
  the *swath polygons* still use the warm ramp.
- Do not leave legend color swatches that no longer match what's drawn on the map.

**Acceptance:** With Hail or Wind selected over a knocked street, every storm *report dot* is
the same light gray with a dark outline, visually distinct from the colored canvass teardrop
pins, and the strongest reports are clearly larger. Legend matches what's on the map.

---

## CHANGE 2 — Tap-to-peek storm popup in unknocked areas (decouple storm view from pins)

**Problem:** To read a specific house's storm history a rep must open the full New Pin / Edit
Pin sheet. Storm dots are `clickable:false`. So scouting an unknocked street for hits is clumsy.

**Desired behavior (locked with product owner):**
- **Tap a house (empty ground) OR a storm dot** while the overlay is ON → show a **lightweight,
  read-only storm peek popup** (bottom sheet) for that point. **No pin is created on tap.**
- The popup shows the same storm readout already produced by `lookupPinStorm()`:
  the headline, the claims-safe talk-track line, and an expandable "Details". It must also
  handle the `kind: 'none'` case (show the existing claims-safe empty message + talk track —
  an empty spot must never read as "skip this house").
- The popup has a **secondary** action **"Drop pin / Knock"** that escalates to the existing
  New Pin flow at that lat/lng (i.e. opens `LeadModal` as today). Peek first, pin optional.
- A close/dismiss control that creates nothing.
- **When the overlay is OFF (`weatherLayer === 'off'` or flag off), behavior is unchanged** —
  tapping empty ground opens New Pin directly as it does today. Do not regress that path.
- Existing-pin taps still open Edit Pin via `onPinClick` — unchanged.

### Implementation guidance

1. **Extract the storm card into a shared component** so peek + LeadModal stay in sync and
   claims-safe copy is single-sourced. Create
   `app/(canvass-app)/canvass/components/StormCard.tsx` that takes a `PinStormSummary` (import
   the type from `weather-overlay.ts`) and renders exactly the existing markup from
   `LeadModal.tsx` lines ~337–385 (both the `kind !== 'none'` and `kind === 'none'` blocks,
   including the `stormExpanded` Details toggle). Replace that block in `LeadModal.tsx` with
   `<StormCard summary={stormSummary} />`. No visual change to LeadModal.

2. **Make storm dots clickable.** In `weather-overlay.ts → weatherFeatureStyle()`, set
   `clickable: true` for the **report** point features (and optionally swath/warning polygons —
   either is fine since we read the click's own latLng, not the feature). In `CanvassMap.tsx`,
   after `weatherDataRef.current = new google.maps.Data(...)` (~line 459), add a Data-layer
   click listener: `weatherDataRef.current.addListener('click', (e) => { if (e.latLng) onStormPeekRef.current?.(e.latLng.lat(), e.latLng.lng()) })`. Guard it so it only fires when
   the overlay is enabled and `weatherLayer !== 'off'`.

3. **Route empty-ground taps through peek when overlay is on.** In `CanvassMap.tsx` base-map
   click listener (~line 544): if `weatherOverlayEnabled && weatherLayer !== 'off'`, call the
   new `onStormPeek(lat, lng)` callback instead of `onMapClick(lat, lng)`. Otherwise call
   `onMapClick` as today. Add `onStormPeek?: (lat: number, lng: number) => void` to
   `CanvassMap` props and keep it in a ref like `onMapClickRef`.

4. **Render the peek in `page.tsx`** (it already owns `weatherContext` and `lookupPinStorm`):
   - Add state `const [peekLocation, setPeekLocation] = useState<{lat:number;lng:number}|null>(null)`.
   - Pass `onStormPeek={(lat,lng) => setPeekLocation({lat,lng})}` to `<CanvassMap>`.
   - Compute `const peekSummary = useMemo(() => (weatherContext && peekLocation) ? lookupPinStorm(weatherContext.layer, weatherContext.features, peekLocation.lat, peekLocation.lng) : null, [weatherContext, peekLocation])`.
   - Render a new `StormPeekSheet` (bottom sheet) when `peekLocation` is set: it shows
     `<StormCard summary={peekSummary} />`, a **"Drop pin / Knock"** button that runs
     `handleMapClick(peekLocation.lat, peekLocation.lng)` then `setPeekLocation(null)` (this
     opens the existing New Pin LeadModal pre-located), and a close button that just
     `setPeekLocation(null)`.
   - The sheet must be a solid opaque surface (not transparent over the map) with `#2c2c2a`
     text — contrast rule.

5. Do **not** add any new network calls. Peek reuses the already-fetched `weatherContext`
   (the same viewport `/api/canvass/weather` payload). No API/route changes, no schema changes.

**Acceptance:**
- Overlay ON, tap an unknocked house with no storm dot → peek sheet appears with the
  claims-safe "no dot ≠ no damage" message + talk track + a "Drop pin / Knock" button; nothing
  is created until the rep taps that button.
- Overlay ON, tap a storm dot → peek sheet shows that location's hail/wind readout.
- "Drop pin / Knock" opens the existing New Pin sheet at the tapped location.
- Overlay OFF → tapping empty ground opens New Pin directly (unchanged). Existing pins still
  open Edit Pin (unchanged).
- LeadModal storm card looks identical to before (now sourced from shared `StormCard`).

---

## CHANGE 3 — Reassign pin ownership to the re-knocking rep (stale pins, 14+ days)

**Problem:** When rep B saves a knock on a pin owned by rep A, `owner_user_id` is never
changed, so the pin keeps showing the original rep. Example: Evan knocks (not home); two weeks
later Nathan knocks, has a real conversation → go-back; the pin still shows "Setter: Evan."

**Locked product decision:**
- Reassign ownership **only when the prior knock is 14+ days old** (a stale pin). A fresh
  re-knock by another rep does NOT steal credit.
- **Move `owner_user_id` ONLY — do NOT write `pin_attributed_user_id`.** Verification found
  `pin_attributed_user_id` is **frozen by a DB trigger (migration 106)** as the permanent
  original-canvasser/comp attribution, and 444 + dashboard + commission counts key off it
  (`pin_attributed_user_id ?? owner_user_id`, windowed by `created_at`). Writing it would fight
  the trigger and could retroactively shift door credit within a pay period. So: the new rep
  becomes the **working owner** (this is what the pin's "Setter" / LAST KNOCK card displays,
  via `owner_user_id` → `owner_name`), while **comp attribution stays with the original
  canvasser** by design. This fixes the visible "still owned by Evan" bug without touching money.
- **Do NOT attempt full comp handoff here.** Crediting the new rep in 444/commissions is a
  separate, deliberate project that requires changing the counting logic first — out of scope.
- **Log the original**: record the prior `owner_user_id` + timestamps in an additive audit
  field so the ownership move is fully traceable.

### This is a money-affecting, server-authoritative change
- All of this happens **server-side** in `app/api/canvass/lead/route.ts` (the update branch,
  ~lines 515–541), using the authenticated `profile.id` from `requireAuthApi()`. Never trust a
  client-supplied owner id (the create path already guards this — keep that posture).

### Schema (additive + nullable only — system is live)
Add a migration that adds these **nullable** columns to `leads` (no backfill, no NOT NULL):
- `ownership_reassigned_at timestamptz null` — when the last reassignment happened (quick filter).
- `ownership_history jsonb null` — append-only audit log; each entry:
  `{ from_user_id, from_pin_attributed_user_id, to_user_id, reassigned_at, prior_knock_at }`.

Run the migration as additive/nullable so it's safe on the live DB. Regenerate Supabase types.

### Logic (update branch only)
1. Extend the existing pre-update `select` (currently only fetches `rep_lat`) to also fetch
   `owner_user_id, pin_attributed_user_id, updated_at, created_at, ownership_history`.
2. Compute:
   - `const REASSIGN_AFTER_DAYS = 14` (named constant).
   - `lastKnockAt = existing.updated_at ?? existing.created_at` (the app already treats
     `updated_at || created_at` as "last knock" in the LeadModal LAST KNOCK card).
   - `isDifferentRep = !!existing.owner_user_id && existing.owner_user_id !== profile.id`.
   - `isStale = lastKnockAt && (Date.now() - new Date(lastKnockAt).getTime()) >= REASSIGN_AFTER_DAYS * 864e5`.
3. If `isDifferentRep && isStale`, add to `updatePayload` (note: **`owner_user_id` only** —
   never write `pin_attributed_user_id`; it is trigger-frozen by migration 106):
   ```
   owner_user_id: profile.id,
   ownership_reassigned_at: new Date().toISOString(),
   ownership_history: [
     ...(existing.ownership_history ?? []),
     {
       from_user_id: existing.owner_user_id,
       to_user_id: profile.id,
       reassigned_at: new Date().toISOString(),
       prior_knock_at: lastKnockAt,
     },
   ],
   ```
   Otherwise leave all owner/attribution fields untouched (current behavior).
4. Make sure no `owner_user_id` / `pin_attributed_user_id` from the request body can flow into
   `updatePayload` except through this server-side block. Confirm the migration-106 trigger
   still leaves `pin_attributed_user_id` untouched after this update runs.

### RLS / permissions
- Verify the update path's Supabase client + RLS policy allows a rep to set `owner_user_id`
  on a lead they don't yet own (the route already updates other reps' leads scoped by
  `org_id`, so org-scoped update is expected — confirm the policy covers this column). Do not
  weaken RLS; if a policy blocks it, adjust the policy additively and keep
  `PAYROLL_ADMIN_ROLES` untouched.

### Frontend reflection
- After a successful save that reassigned ownership, the pin's "Setter / LAST KNOCK" should
  show the new rep. The API returns the updated row and `page.tsx` bumps `refetchTrigger`, so
  the viewport refetch will refresh `owner_name` — confirm it does. Optional nicety: a small
  toast like "This pin is now assigned to you."

### Edge cases to honor
- New-pin create: unchanged (creator is owner).
- Same rep re-knocks own pin: no reassignment.
- Different rep but prior knock < 14 days: no reassignment (protect fresh setter credit).
- Offline/unsynced local-only saves don't hit the API, so reassignment applies once it syncs —
  acceptable; don't try to reassign client-side.

**Acceptance:**
- Rep B saves any disposition on rep A's pin whose `updated_at` is ≥14 days ago →
  `owner_user_id` becomes rep B; `ownership_history` gains one entry; the pin's Setter/LAST
  KNOCK display shows rep B.
- `pin_attributed_user_id` is **unchanged** (still rep A) — confirmed both in the row and that
  the migration-106 trigger didn't fire/override.
- Same scenario but pin knocked 3 days ago → owner stays rep A.
- 444 door counts, dashboards, and commission attribution are **unchanged** by the reassignment
  (they follow the frozen `pin_attributed_user_id`).
- Original owner is still recoverable from `ownership_history`.

---

## Collateral & regression guardrails — do NOT skip

These edits touch lead creation and comp attribution, so trace cross-module effects before
finishing. Explicitly prove each of these is safe:

**No duplicate / doubled-up leads (Change 2 is the main risk):**
- Tap-to-peek must **create nothing** — no lead row, no Zustand/IndexedDB offline-queue entry,
  no optimistic pin. Only the "Drop pin / Knock" button creates, and it must run the **existing**
  `handleMapClick` → New Pin → single create path (do not add a parallel create).
- A single tap must fire **one** handler. Making weather features `clickable:true` means the
  Data-layer `click` and the base-map `click` can both fire for one tap — de-dupe so you don't
  open two peeks or a peek + a New Pin. Confirm taps inside a swath polygon still yield the
  tapped point and a single peek.
- Confirm the escalation can't double-submit (peek → Drop pin → New Pin save) into two rows.

**Attribution / comp collateral (Change 3):**
- **Sisu 444** (`program_444_enrollments`, door/inspection counts) and `app/api/admin/sisu/*`
  aggregate by `pin_attributed_user_id ?? owner_user_id`, windowed by `created_at` (NOT a
  frozen knock-time credit — date window yes, attribution live). Because Change 3 now writes
  **`owner_user_id` only** and leaves the trigger-frozen `pin_attributed_user_id` alone, door
  counts stay with the original canvasser and cannot shift between reps. Confirm this holds:
  reassignment must not change any 444 count, dashboard total, or qualification flag.
- **Commissions / payroll** (`app/commissions/`, `app/admin/payroll/`): a reassignment must not
  claw back or duplicate an already-`paid`/`approved` `bonus_status`. Confirm comp is taken at
  sale/approval time, so moving ownership on a stale not-home pin can't alter settled payouts.
- **Opportunities**: `opportunity.owner_user_id` is set from `closerUserId || leadRow.owner_user_id || profile.id`. Since Change 3 mutates `leadRow.owner_user_id`, confirm a re-knock that also
  schedules an inspection assigns the opportunity to the intended rep.
- **Dashboards**: verify a reassigned lead is counted for exactly one rep (ownership moves, the
  row is not duplicated) — no double counting in `app/dashboard/`.
- `ownership_history` append must be **idempotent** under retries/double-submit (don't append a
  duplicate entry for the same reassignment).

**General:**
- No change to `PAYROLL_ADMIN_ROLES`, the feature flag default, RLS posture (except an additive
  policy if strictly required for the owner-column update), or any cron.
- Migration stays additive/nullable; nothing backfilled.

## Required automated review (run on every edit)
Before declaring done, run automated review over the **full diff** and resolve findings:
1. **Cursor Bugbot** — run it on all changes; fix or explicitly justify each finding.
2. A second **collateral/regression review pass** (separate agent) specifically auditing the
   cross-module touchpoints listed above: lead duplication, Sisu/444 counts, commissions/payroll
   bonus status, opportunity ownership, dashboard aggregates, RLS.
3. The repo's own checks: `npm run lint`, typecheck, and any existing tests.
Report what each pass found and how it was resolved. Do not mark complete with unaddressed
Bugbot or collateral findings.

## Out of scope / do not touch
- The weather API route, cron jobs, `lib/roofradar-open-data.ts`, swath ingest, the 730-day window.
- The feature flag default (stays OFF) and any deploy/checklist items.
- Roof Radar admin routes.

## Verify before finishing
- `npm run lint` and `tsc --noEmit` (or the repo's typecheck) pass; Supabase types regenerated.
- Manually reason through: overlay-off tap path unchanged; peek creates nothing; gray dots
  legible over satellite; legend matches rendered dots.
- Confirm claims-safe copy is unchanged (reused, not rewritten).
- Ownership: a ≥14-day-old pin re-knocked by another rep flips `owner_user_id` only (NOT
  `pin_attributed_user_id`) and appends to `ownership_history`; a <14-day pin does not; same-rep
  and new-pin paths unchanged; 444/dashboard/commission numbers unchanged. Migration is
  additive/nullable. Owner change is decided server-side from `profile.id` only.
