# Executive prompt: Roof measure — Google/Solar polygons not visible

**Role:** Worker agent(s) under **Head of Dev**. User reported: **satellite map loads but roof section polygons are missing** (or inconsistent). **Do not ship a guess** — reproduce, root-cause, fix, verify on **production URL** and locally.

**Out of scope for v1:** Waste math, proposal builder, integrations admin.

**Master context:** [roof-measure-in-house-capability-prompt.md](../roof-measure-in-house-capability-prompt.md) — desire path #1 expects auto **satellite outline** after address search.

---

## Expected behavior (what “good” looks like)

| State | What user should see on map |
|-------|---------------------------|
| **After address search** (no saved measure) | Auto call `detectRoofWithAI(true, 'solar')` → **blue semi-transparent facets** (draft) or **solid colored facets** if auto-accepted |
| **Pending draft** | Dashed blue boundary (`aiDraftSections` with `status: 'pending'`) — `page.tsx` ~1222–1260 |
| **Accepted sections** | Filled polygons per facet in `polygonsRef` — colors from `FACET_COLORS` |
| **Reload outline from satellite** | Same as detect; replaces drafts |
| **Saved measurement reload** | Facets restored from DB + polygons re-drawn on map |

**Not Google’s native building layer** — our overlays are **Maps JavaScript API `google.maps.Polygon`** fed by `/api/ai/detect-roof` (Google **Solar API** backend), not KML from Google alone.

**User confusion to rule out:** They may see **sidebar metrics + Notes** (overlap warnings) while **overlays are missing** — that means API returned data but **map render path failed**.

---

## Repro matrix (workers must fill in PASS/FAIL)

Test on **`arx-internal-crm.vercel.app/tools/roof-measure`** (logged in) **and** `localhost:3000` (single dev server on :3000 only).

| # | Steps | Polygons visible? | Console / Network notes |
|---|--------|-------------------|------------------------|
| A | Fresh URL with `?address=` + `opportunity_id=` (e.g. Greenway) | | |
| B | Hard refresh (Cmd+Shift+R) on same job | | |
| C | Click **Reload outline from satellite** | | |
| D | Job with **existing saved** `measurement_id` in URL | | |
| E | Zoom in/out after load; pan map | | |
| F | Second tab / port conflict (3000 vs 3001) — use **one** server | | |

Capture screenshots + HAR for `/api/ai/detect-roof` on failure.

---

## Architecture map (where to look)

```
Address search → map idle → detectRoofWithAI(solar)
  → POST /api/ai/detect-roof  (app/api/ai/detect-roof/route.ts)
  → facet_source: solar_mask_plane | solar_bbox | vision | …
  → setAiDraftSections OR autoAcceptAllDrafts → setFacets + polygonsRef

Map prerequisites:
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  Libraries: drawing, geometry, places (hasRequiredGoogleMapMeasureLibraries)
  google.maps.geometry for area on accept

Render paths:
  Draft: useEffect [aiDraftSections] — only status === 'pending'
  Accepted: acceptDraftItem → polygonsRef.set(facetId, polygon)
  Clear: clearAllMeasurements / clearAIDraftOverlays
```

**Race hypotheses (prioritize):**

1. **`googleLoaded` / `mapReady` false** — detect runs before map ref ready; or detect completes before overlay effect runs.
2. **Auto-accept clears drafts** — `autoAcceptAllDrafts: true` accepts facets but **polygon attach fails** (invalid coords, area &lt; 10 sqft, geometry library missing).
3. **`facet_source` = `solar_bbox` only** — notes say “rough boxes” / no clean outlines; UI may show **no polygons** if API returns empty segments.
4. **Effect cleanup** — `clearAIDraftOverlays` on `[aiDraftSections]` dependency runs and removes overlays unexpectedly.
5. **Production env** — Solar API key, Maps key restrictions (HTTP referrer), billing, or Vercel env vars missing/different from local.
6. **Stale state** — `facets.length > 0` blocks auto-detect; loaded measurement with **facets in state but polygons not redrawn** after navigation.
7. **Z-index / opacity** — polygons drawn with `fillOpacity: 0.15` / stroke 0 — invisible on certain imagery (unlikely if boundaries also missing).

---

## Worker assignments

| Worker | Task | Deliverable |
|--------|------|-------------|
| **W1 — Repro** | Run matrix A–F on prod + local; compare working vs broken session | Filled table + screenshots |
| **W2 — API** | Trace `detect-roof` for failing address: `facet_source`, segment count, coordinates validity | JSON redacted sample + status codes |
| **W3 — Client** | Debug `page.tsx`: timing of `detectRoofWithAI`, `acceptDraftItem`, `polygonsRef`, `aiDraftSections` | Root cause with file:line |
| **W4 — Env** | Verify Vercel/local: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, Solar-related server keys, Maps API enablement, referrer restrictions | Checklist PASS/FAIL |
| **W5 — Fix** | Minimal fix + regression test or script note | PR-ready diff |
| **W6 — QA** | Re-run launch checklist map steps only; sign QA note | `docs/roof-measure-qa-YYYY-MM-DD.md` snippet |

**Parallel OK:** W1+W2+W4 first; W5 only after confirmed root cause.

---

## Head of Dev acceptance (sign-off before merge)

- [ ] Reproduced failure OR documented **environment-specific** flake with fix.
- [ ] **Fresh address** on prod: polygons appear within **10s** of search without manual draw.
- [ ] **Reload outline from satellite** always shows overlays when API returns segments.
- [ ] **Saved measurement** reload draws polygons matching sidebar section count.
- [ ] No regression: `npm run roof-measure:prelaunch` + `npm run build`.
- [ ] Console clean on happy path (no silent `acceptDraftItem: skipped` for all facets).
- [ ] If API returns `solar_bbox` only: UI shows **actionable** message (not empty map with metrics).

---

## Copy-paste worker kickoff

```
You are a worker under Head of Dev. Read docs/prompts/roof-measure-missing-google-polygons.md.

Problem: User does not see Google/Solar roof polygons on /tools/roof-measure (map may load; sidebar may show sections/notes).

Do NOT change waste math or proposal builder.

1. Reproduce on arx-internal-crm.vercel.app and localhost (matrix A–F).
2. Trace POST /api/ai/detect-roof → aiDraftSections / facets → google.maps.Polygon on map.
3. Find root cause (timing, env, API empty segments, accept skip, missing geometry library, no redraw on load).
4. Fix minimally; verify polygons on fresh address + reload satellite + saved measurement reload.
5. Report: root cause, files changed, before/after screenshots, prelaunch PASS.

Stop and escalate to Head of Dev if production env keys are missing (no code fix possible without secrets).
```

---

## Reference: prior signals

- Browser QA historically blocked on login / **port conflicts** (multiple `npm run dev`).
- Overlap notes (“drawn sections 21% over Solar footprint”) imply **facets existed in state** at least once — distinguish **data present / overlay missing**.
- User screenshot (numbered sections 1–13 on map) may be a **working** session — clarify which URL/session fails vs succeeds.

---

## Non-goals

- Do not conflate with EagleView/Roofr/Aurora integrations.
- Do not rewrite detect algorithm unless API returns valid segments that client drops.
- Do not change MIN_WASTE or material order in this task.
