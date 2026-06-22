# Canvass Weather Overlay — UI Specification (Final Pass)

**Status:** Design spec only. No application code is changed by this document.
**Scope:** The field-rep Canvass PWA map (`app/(canvass-app)/canvass/components/CanvassMap.tsx`). This spec governs the **front-end UI** for the additive, feature-flagged weather overlay described in `docs/canvass-weather-overlay-design.md` and `docs/prompts/canvass-weather-overlay-implementation.md`.
**Audience:** Implementer (the engineer adding the toggle/layer), product owner (Nathan), reviewer.
**Constraint inherited from the design docs:** additive only, separate `google.maps.Data` layer, pins always on top, low swath opacity, `requireAuthApi()` on the route. This UI spec must not require violating any of those.

> Every numeric threshold in this document (hail buckets, wind buckets, opacities, default window) is a **design recommendation to confirm**, not an established fact. Data sources are limited to those the design doc establishes: NWS Alerts API (live warning polygons), SPC storm reports (historical points), and — Phase 2 — MRMS MESH (true swaths). No other data source is assumed.

---

## 1. Design Principles

The user is a rep standing on a sidewalk, in direct sun, holding a phone in one hand, deciding which door to knock next. Every decision below serves that person, in that moment.

1. **The map is the hero; chrome is a guest.** The rep's job is reading the neighborhood, not operating a weather console. The overlay must add at most one persistent affordance when idle (a single button) and one thin status line when active. Anything more steals the limited phone canvas that the pins live on.

2. **Glanceability over completeness.** A rep will look at the screen for ~1 second between knocks. The overlay must answer one question in that second: *"was this block hit hard, yes or no, and roughly how hard?"* Precision (exact MESH value to the hundredth of an inch) is a tap away in the detail sheet, never forced into the glance.

3. **One-thumb operation.** All primary controls live in the natural thumb arc of a right- or left-handed grip — the lower third and the existing left control stack. Nothing critical sits in the top corners where a thumb can't comfortably reach mid-walk. Tap targets are ≥44px.

4. **Sunlight legibility first.** On a hybrid/satellite basemap in bright sun, low-saturation pastels vanish. Color choices, opacities, and the legend are all tuned for a washed-out screen outdoors, not a designer's monitor indoors. We lean on **lightness contrast and saturation steps**, not hue alone.

5. **Never compete with the knock workflow.** The overlay is assistive. It must never block a pin tap, never cover a pin, never modify a disposition, and never add a step to logging a knock. If the weather data is wrong, slow, or absent, the canvass app must still feel exactly like today.

6. **Ships dark, degrades soft.** Feature-flagged off by default; when on, every failure mode (no data, offline, slow) resolves to a calm, non-blocking state — never an error wall over the map.

---

## 2. Component Inventory

All sizes in CSS px (logical/device-independent). Z-order is given both as map-stack (Google Maps `zIndex`) and DOM overlay stack (Tailwind `z-*`). The existing controls use `z-10` overlays and `w-12 h-12` (48px) white circles in a left stack at `bottom-24 left-4`.

| # | Component | Placement | Size | Z-order | Notes |
|---|---|---|---|---|---|
| A | **Collapsed weather button** | Left control stack, top of stack (above refresh) at `left-4`, vertically in the `bottom-24` column | 48×48 circle (`w-12 h-12`) | DOM `z-10` | Matches existing white control circles exactly. Cloud/storm glyph. Default and "Off" state. |
| B | **Expanded segmented control** | Replaces A in place (same anchor), expands rightward/upward | Height 48px; each segment min 56px wide (Off / Hail / Wind) + 44px locked RE segment. Total ~212px wide | DOM `z-20` (above other controls so it can overlap them while open) | White rounded pill, segmented. Slides/scales out of the button. |
| C | **Status strip (pill)** | **Top-center**, pinned below the safe-area inset, `top: max(16px, env(safe-area-inset-top))`, horizontally centered | Height 32px; width = content, max 92vw; single line | DOM `z-10` | Thin. The one persistent "key number" line. Must never overlap pins — top-center band is above the densest pin area at typical zoom and away from the bottom sheet. |
| D | **Legend chip** | Bottom-left, just **above** the left control stack (`bottom-44 left-4` region), only when a layer is active | ~150×auto, max 3 swatch rows | DOM `z-10` | Compact color→magnitude key. Collapses to a 2-line gradient bar on small phones. |
| E | **Swath layer** | The map itself | full bounds | Map `zIndex: 1` (above territory polygons at `0`, **below** all markers) | Separate `google.maps.Data` instance per the design doc. `fillOpacity ~0.30`. Feathered nested bands (see §6.4). Never clickable in a way that blocks pins (see §4.4). |
| F | **Door pins** | The map | n/a | Map default marker stack (above `Data`); sold badges `zIndex 700`, user marker `1000` | **Unchanged.** Always on top, always tappable. The whole point. |
| G | **Existing controls** | Left stack: refresh, map-type, locate, compass. Top-left search. Top-right disposition filter. | unchanged | DOM `z-10` | The weather control must coexist; see §2.1 for collision handling. |
| H | **Bottom detail sheet** | Bottom, slides up from `bottom: 0` over safe-area | Peek 30vh; full 70vh | DOM `z-30` (above everything) | Existing knock/disposition flow, **augmented** with a storm-context block when a layer is active. See §5. |
| I | **Mini toast** (transient) | Bottom-center above sheet handle, `bottom-28` | auto | DOM `z-20` | For "Refresh area," "Offline — showing last data," RE-locked tap. Auto-dismiss 2.5s. |

### 2.1 Coexistence with existing controls (collision rules)

- The collapsed weather button (A) **joins** the existing left stack as a new top item. Stack order top→bottom: **Weather, Refresh, Map-type, Locate, Compass.** This keeps weather (a "mode" control) at the top, separated from navigation controls.
- When expanded (B), the pill grows but stays anchored to the same top-of-stack origin; it briefly overlaps nothing because it expands into empty map space to the right. On very narrow phones it may overlap the top-left search affordance — in that case the search auto-collapses (it already collapses to an 11px circle) and the pill renders above it at `z-20`.
- The **status strip (C)** is top-center; the **disposition filter (G)** is top-right; the **search (G)** is top-left. Three corners, no collision. The strip is centered and narrow enough to clear both at ≥360px width; if it would touch the filter, it truncates with an ellipsis before overlapping.
- The **legend (D)** sits above the left control stack and below the status strip's vertical zone; it never overlaps the stack because it occupies the gap between `bottom-24` (stack top ~ y=stack) and mid-screen.

---

## 3. States & Transitions

### 3.1 State matrix

| State | Trigger | Collapsed button (A) | Segmented control (B) | Status strip (C) | Legend (D) | Swath layer (E) | Notes |
|---|---|---|---|---|---|---|---|
| **off-collapsed** (default) | Initial; or user selects Off | Visible, neutral (cloud glyph, gray stroke) | Hidden | Hidden | Hidden | Empty/none | Map identical to today. |
| **expanded-off** | Tap collapsed button | Becomes the pill | Visible; "Off" segment selected (highlighted) | Hidden | Hidden | Empty | Awaiting layer choice. |
| **loading** | Hail or Wind selected; fetch in flight | — | Pill stays; chosen segment shows inline spinner | Strip shows skeleton "Checking this area…" with subtle shimmer | Hidden until data arrives | Previous layer (if any) stays until new data loads, then swaps | Never blank the map while loading. |
| **hail-active** | Hail data returned, ≥1 feature in view | — | Pill, Hail selected (blue→red active accent) | "Up to 1.75″ · 14 homes in path · May 14" | Hail ramp visible | Hail bands rendered, opacity ~0.30 | Strip number = max magnitude in current viewport. |
| **wind-active** | Wind data returned, ≥1 feature in view | — | Pill, Wind selected (green→red accent) | "Up to 70 mph · 3 storm areas · May 14" | Wind ramp visible | Wind areas rendered | |
| **empty (no data in view)** | Layer active, fetch ok, 0 features in bbox | — | Pill, layer selected | "No recorded hail in this area" (muted) | Hidden (nothing to key) | None | Calm, not an error. Encourage panning. |
| **stale-data** | Data older than freshness threshold, or served from cache while offline | — | Pill, layer selected | Strip prefixes a small ⓘ + "as of [date]" emphasized; subtle amber dot | Visible | Rendered | See §3.3. |
| **error / offline** | Fetch failed OR navigator.offline | — | Pill, layer selected, segment shows a small ⚠ | Strip: "Offline — last data shown" or "Couldn't load — tap to retry" | Last-known if cached, else hidden | Last-known cached features if present, else none | Map never breaks; offline queue unaffected. |
| **RE-locked tap** | Tap the locked Real-estate segment | — | Pill stays in current state | unchanged | unchanged | unchanged | Fires mini-toast (I): "Real estate maps — coming soon." Lock segment does a tiny shake (reduced-motion: no shake, toast only). |

### 3.2 Transitions & motion

All motion is short, GPU-friendly (`transform`/`opacity` only — never animating the map or `fillOpacity` of features per-frame), and respects `prefers-reduced-motion`.

| Transition | Effect | Duration | Easing |
|---|---|---|---|
| Collapse → Expand (A→B) | Pill scales from the circle origin (`transform: scaleX` + width), segments fade in | 180ms | `cubic-bezier(0.2, 0, 0, 1)` (decelerate) |
| Expand → Collapse (B→A) | Reverse | 140ms | `cubic-bezier(0.4, 0, 1, 1)` (accelerate) |
| Layer on (swaths appear) | Data layer added, then container `opacity 0→1` | 220ms | ease-out |
| Layer off / swap | Old features `opacity 1→0` (120ms) then removed; new added and faded in | 120ms out / 200ms in | ease |
| Status strip in/out | Slide-down from top + fade, 12px travel | 160ms | decelerate |
| Legend in/out | Fade + 8px rise | 160ms | ease-out |
| Loading shimmer | Skeleton shimmer | 1200ms loop | linear |
| RE-lock shake | ±3px x-translate, 2 cycles | 240ms | ease-in-out |
| Bottom sheet | Existing sheet motion; storm block fades in within it | inherit | inherit |

**Performance / streaming note:** swaths can be many polygons. Fade the **container/overlay**, not each feature. If MESH (Phase 2) returns large FeatureCollections, render in a single `addGeoJson()` call and style synchronously in `setStyle` (a function), so there is one paint, not N. Do not animate feature opacity individually. Debounce viewport refetch (§4.3) so panning never thrashes the layer.

### 3.3 Stale-data definition (recommendation)

Recommend a **freshness threshold of 6 hours for live (NWS warning) data** and **"event date" labeling for historical (SPC/MRMS)** — historical hail isn't "stale," it's dated, so we always show the event date rather than a staleness warning. The amber stale indicator appears only when: (a) we're offline and serving cached features, or (b) a live-warning fetch is older than the threshold. *Confirm thresholds with product owner.*

---

## 4. Interaction Flows

### 4.1 Turning it on
1. Rep taps the collapsed weather button (A). Pill expands (expanded-off).
2. Rep taps **Hail**. Segment selects; **loading** state; fetch for current bbox + window.
3. Data returns → **hail-active**: bands fade in beneath pins, status strip slides down, legend fades in.
4. Pill stays expanded (per locked decision #2) so switching layers is one tap.

### 4.2 Switching layers
- Tap **Wind** while hail is active: hail bands fade out, wind areas fade in (swap motion §3.2), strip/legend re-key to wind. Single fetch; cached if recently fetched for the same bbox.
- Tap **Off**: layer clears, strip + legend animate out, **pill collapses back to the circle** (locked decision #2).

### 4.3 Panning / refetch — **recommendation: explicit "Refresh area," not auto-debounce**

The design doc leaves this optional. **Recommendation: do NOT auto-refetch on every `idle`.** Reasons specific to this app:
- The map already fires `idle` for pin viewport loading; piggybacking weather on every idle doubles request volume and can stutter the pin clusterer during a walk.
- Reps pan constantly while walking; silent layer churn under the pins is visually noisy and burns data/battery.

Instead:
- On layer activation, fetch once for the current bbox.
- When the user has panned/zoomed such that a meaningful fraction (recommend **>40% of viewport area**) is outside the last fetched bbox, surface a small, non-blocking **"Refresh storm data ↻"** chip on the status strip (tap to refetch). This reuses the mental model of the existing "Refresh area" button.
- Optionally also refetch automatically on the **first idle after the layer turns on** to align the bbox, then go quiet.
- Debounce any programmatic refetch at **600ms** trailing.

*Assumption to confirm: data volume/cost tolerance. If requests are cheap and cached server-side (they are, per the route's in-memory cache), a gentle auto-refetch (debounced 600ms, only when >40% panned) is acceptable as a follow-up — but explicit refresh ships first.*

### 4.4 Tapping a swath area
- Swath features are **rendered but effectively non-interactive for selection** by default, so a tap "through" a swath always hits the pin or drops a new pin exactly as today. This protects the core workflow (locked decision: pins always tappable).
- **Optional enhancement (recommend behind the same flag, off until validated):** a tap on a swath *where there is no pin and not in pin-drop intent* shows a tiny inline callout: "≈1.5″ hail here · May 14." Because the existing map's click handler drops/creates pins, we must NOT intercept that. Safer pattern: keep `Data` features `clickable: false` and instead read the swath magnitude at the tapped point from the loaded FeatureCollection only inside the **bottom sheet context** (§5), where it's unambiguous. **Default: swaths are visual only; magnitude surfaces in the strip (viewport max) and the per-home sheet.**

### 4.5 Tapping a pin inside vs outside a hit zone
- **Pin tap is unchanged** — opens the existing bottom sheet for that home.
- If a layer is active, the sheet gains a **storm-context block** (§5). For a pin **inside** a hit zone: the block shows that home's hail size / event and a priority treatment. For a pin **outside** any swath: the block shows a muted "No recorded hail at this address" so the rep knows the absence is data, not a bug.

### 4.6 Dismissing
- Off collapses everything (§4.2).
- Opening the bottom sheet does not dismiss the layer; the strip/legend remain (sheet is `z-30` above them; strip is top-center, sheet is bottom, no overlap).
- Backgrounding/returning the PWA: the existing visibility-change refetch handles pins; the weather layer should re-render from cache and, if a layer was active, re-validate with one fetch (respecting §4.3).

---

## 5. Bottom Sheet — Per-Home Storm Context

The sheet is the **existing** knock/disposition sheet. We add a single bordered **storm-context block** at the top of the sheet body, visible only when a weather layer is active. It must not push the primary actions below the fold on a small phone — keep it to ~3 compact rows.

### 5.1 Content (priority order)
1. **Headline magnitude at this location** — e.g. **"1.5″ hail"** (hail) or **"68 mph wind"** (wind), with the layer's color swatch as a leading dot. If the home is outside any swath: muted "No recorded hail at this address."
2. **Last event date** — "May 14, 2026" (the storm date). For live warnings: "Active warning until 4:15 PM."
3. **Roof age (if known)** — surfaced only if the CRM already has it for this lead/parcel (do not invent). "Roof age: ~14 yrs" → strong claim signal; "Roof age: unknown" otherwise. *Source must be existing CRM data; flagged assumption that this field is sometimes available.*
4. **Claim status (if known)** — "No claim on file" / "Claim filed" if the lead record carries it. Helps the rep avoid re-pitching a homeowner already in process.

### 5.2 Priority treatment
A single, glanceable **priority tag** computed from magnitude (and roof age if present), rendered as a colored chip at the top-right of the storm block:
- **"Knock first"** (hot) — large hail (≥1.5″ rec.) or hail + older roof.
- **"Worth a look"** (warm) — moderate hail (1.0–1.5″ rec.).
- **"Low signal"** (cool) — small/none.

This is a *suggestion*, never a gate. *Thresholds are recommendations to confirm.* This deliberately mirrors, but does not replace, the disposition colors — it lives in the sheet, not on the pin, so it never competes with the on-map disposition color (§6.3).

### 5.3 Primary actions
**Unchanged and primary:** the existing **Log knock / set disposition** and **Inspect / schedule** actions stay exactly where they are and remain the dominant tap targets at the bottom of the sheet. The storm block is context that informs the decision; the action row is the decision. No new required step.

---

## 6. Visual System

### 6.1 Hail color ramp (by estimated size, inches) — recommendation

> ⚠️ **SUPERSEDED VALUES — build from the implementation prompt, not this table.** The hue *family* below (teal→violet→magenta, colorblind-aware) is the keeper. The exact fills/opacities here are the early pastel version; the field-readiness review showed they vanish in sunlight. The **final, build-canonical** ramp lives in `docs/prompts/canvass-weather-overlay-implementation.md` §7.1 (saturated buckets, opacity floor 0.35 / ceiling 0.40, stroke as primary read). If the two disagree, the implementation prompt wins.

Tuned for a dark satellite basemap and colorblind-awareness: a **single-hue-family, increasing-saturation/decreasing-lightness** ramp from teal→violet→magenta. We deliberately **avoid the green→red ramp for hail** to reserve red for the highest tier *and* to not collide with the green "scheduled/sold" pins. Hail reads as a cool→hot violet/magenta family, distinct from any disposition pin color.

| Bucket (inches) | Meaning | Fill color | Fill opacity | Stroke |
|---|---|---|---|---|
| 0.75–1.00 | Marginal (penny–quarter) | `#5EEAD4` (teal-300) | 0.28 | `#2DD4BF` 0.6, 1px |
| 1.00–1.25 | Notable (quarter–half$) | `#818CF8` (indigo-400) | 0.30 | `#6366F1` 0.7 |
| 1.25–1.75 | Significant (golf ball) | `#C084FC` (violet-400) | 0.32 | `#A855F7` 0.75 |
| ≥1.75 | Severe (tennis ball+) | `#F0508C` (magenta) | 0.34 | `#E11D74` 0.85, 1.5px |

Rationale: teal and magenta are distinguishable under the most common color-vision deficiencies (deutan/protan), and the **lightness step** carries the signal even when hue is lost. Opacity rises slightly with severity so the worst-hit cores read as denser without exceeding ~0.34 (pins still read through).

### 6.2 Wind color ramp (by estimated speed, mph) — recommendation

Wind is conceptually different and should look different from hail at a glance. Use an **amber→orange→red sequential** ramp (warm family), which is intuitive for "wind speed" and is held visually separate from the violet hail family.

| Bucket (mph) | Meaning | Fill color | Fill opacity | Stroke |
|---|---|---|---|---|
| 45–58 | Strong | `#FCD34D` (amber-300) | 0.26 | `#F59E0B` 0.6 |
| 58–70 | Severe (warning criteria) | `#FB923C` (orange-400) | 0.30 | `#F97316` 0.75 |
| ≥70 | Damaging | `#EF4444`→ but see §6.3 mitigation | 0.32 | `#DC2626` 0.85 |

### 6.3 Avoiding clash with disposition pin colors (critical)

The hard problem: a **red `hot_lead` pin (#EF4444)** sitting on top of a **red hail core** must remain instantly distinguishable. Mitigations, layered:

1. **Different shapes, different layers.** Pins are opaque teardrops/badges with a white (or amber) stroke at full opacity, floating above a translucent (~0.30) area fill. A solid bordered teardrop on a washed pastel field reads as foreground vs background even at matching hue. This is the primary mitigation and largely solves it.
2. **Reserve hue families.** Hail uses the **violet/magenta** family (§6.1), which does not appear in the disposition palette at all (dispositions are red/amber/grays/green/indigo/stone/zinc). So hail never matches a pin hue. **This is the strongest mitigation — prefer it.**
3. **Wind's top tier is the only risk** (red ≥70 vs red hot_lead pin). Mitigation: render the wind ≥70 tier as a **hatched/diagonal-stripe fill** (via a repeating pattern on the Data feature, or a darker `#B91C1C` at 0.30 with a 1.5px dashed stroke) rather than a flat red field. The texture + the pin's solid white-ringed teardrop keeps them separate. *Recommend the darker-red + dashed-stroke option first (simpler with `google.maps.Data` styling); upgrade to a true hatch pattern only if validation shows confusion.*
4. **Always-on white pin stroke.** The existing pins already carry a white (synced) or amber (unsynced) 2–3px stroke; this halo is what guarantees separation against any swath. Do not let swath strokes use pure white.
5. **Opacity ceiling 0.34.** Hard cap so the satellite texture and pins always read through.

### 6.4 Feathered / organic swaths (locked decision #5)

Render each magnitude band as **nested translucent corridors** rather than one hard polygon:
- For point-derived data (Phase 1 SPC), buffer each report into a soft disc and render **2–3 concentric bands** (core at full bucket opacity, an outer band at ~0.5× opacity, optional faint halo) to read as a feathered blob, not a hard dot.
- For warning polygons (NWS) and MESH contours (Phase 2), render the contour plus an **inner inset contour** one bucket brighter to create a layered, organic-edge look. Soften visual edges with low stroke opacity (0.6–0.85) rather than hard 1.0 lines.
- Keep strokes thin (1–1.5px) and slightly translucent so corridors feel like weather, not vector borders.

### 6.5 Opacity & layering summary
- Territory polygons: existing `fillOpacity 0.13`, `zIndex 0` — **unchanged**, sits below.
- Weather swaths: `fillOpacity 0.35–0.40` (final, per implementation prompt §7.1; the `0.26–0.34` figures elsewhere in this doc are superseded), `zIndex 1` — above territories, below all markers.
- Pins/markers: default marker stack (above Data); sold `700`; user `1000`. **Unchanged.**

---

## 7. Legend & Magnitude Communication

The rep must read hail size in <1s. Two mechanisms:

1. **Status strip (the glance):** the single most useful number — **viewport maximum** — phrased plainly: **"Up to 1.75″ · 14 homes in path · May 14."** Hail in inches with the `″` symbol; wind in mph. "Homes in path" = count of pins intersecting swaths in view (assistive, computed client-side from already-loaded pins; *confirm definition*). The date anchors recency.
2. **Legend chip (the key):** a compact 3–4 row swatch→label list using the §6 ramps. Labels use **real-world size anchors**, which reps internalize faster than decimals: "1″ Quarter," "1.25″ Half-dollar," "1.75″ Golf ball." On small phones, collapse to a single horizontal gradient bar with min/max endpoints labeled.

Magnitude is therefore communicated three ways for redundancy under sunlight/CVD: **color (band), position (legend order), and text (strip + sheet)** — never color alone.

---

## 8. Accessibility

- **Tap targets ≥44px.** Collapsed button 48px; each segment ≥44px tall and ≥56px wide; strip refresh chip ≥44px hit area (visual can be smaller with padding).
- **Contrast on satellite.** All text chrome (strip, legend, sheet) renders on **solid white/near-white rounded surfaces** (matching existing controls) — never text directly on the map. White surface + `text-gray-900` clears WCAG AA on any basemap. Swatch dots get a 1px `rgba(0,0,0,0.15)` ring so pale teal/amber stays visible on white.
- **Color independence (CVD):** every color is paired with text (§7); the active segment shows a checkmark/label, not just a tint; priority chips carry words ("Knock first"), not just color.
- **Screen-reader labels:**
  - Collapsed button: `aria-label="Weather overlay, off. Tap to choose hail or wind."`
  - Segmented control: `role="radiogroup" aria-label="Weather layer"`; segments `role="radio" aria-checked`. RE segment `aria-disabled="true" aria-label="Real estate, coming soon"`.
  - Status strip: `role="status" aria-live="polite"` so the magnitude is announced when it changes (and on empty/offline states).
  - Swaths: decorative to SR (the per-home magnitude is announced via the sheet, which is the meaningful, navigable surface).
- **Reduced motion:** `prefers-reduced-motion: reduce` → no shimmer, no shake, no slide; instant opacity swaps only.
- **One-handed reach:** primary controls in the lower-left thumb arc and the bottom sheet. The top-center strip and top-right filter are read-only/secondary; nothing requiring a thumb-stretch to the top corners mid-walk.
- **Hit-test priority:** pins must win hit-testing over swaths (swaths `clickable:false`), so a SR/switch user or a thumb always reaches the pin.

---

## 9. Responsive Notes

- **Small phones (≤360px wide, e.g. iPhone SE):** expanded pill may exceed comfortable width with all four segments; **drop segment labels to icons + the active one keeps its label**, or stack RE under as the lock-only mini-segment. Legend collapses to the gradient bar. Status strip max 92vw, truncates "homes in path" first, keeps the inches + date.
- **Large phones / tablets:** more breathing room; keep the same layout (do not balloon chrome). Status strip stays compact, left-aligned content centered.
- **Landscape:** the bottom sheet should peek shorter (sheet competes with reduced height); strip stays top-center; left stack may need to compress vertical gaps. Ensure the pill doesn't collide with the now-wider top bar — anchor it left and let it expand right.
- **Notch / safe areas:** strip uses `top: max(16px, env(safe-area-inset-top))`; bottom sheet and any bottom toast use `env(safe-area-inset-bottom)`. Left stack already uses `left-4`; keep clear of `env(safe-area-inset-left)` in landscape.
- **PWA specifics:** standalone display (no browser chrome) means the strip is the topmost UI — give it the safe-area top inset. Honor the offline-first model: cached weather GeoJSON should survive a relaunch where possible so a rep who lost signal still sees the last swaths.

---

## 10. Edge Cases & Failure Modes

| Case | UI behavior |
|---|---|
| **No storm data in view** | empty state (§3.1): muted strip "No recorded hail in this area," no legend, no swaths. Not an error. Suggest panning is implicit (rep just moves the map). |
| **Slow network** | loading state with skeleton strip; previous layer (if any) stays until new data swaps in; never blank. Spinner inside the active segment. |
| **Offline (offline-first app)** | If cached features exist: render them, strip shows "Offline — last data shown" with amber dot (stale). If none: muted "Offline — no stored storm data," no swaths. **The canvass offline queue and knock logging are completely unaffected** — weather failing must never touch the queue. |
| **Fetch error (5xx / network)** | Route is designed to fail soft (empty FeatureCollection, 200). If a true error reaches the client: strip shows "Couldn't load — tap to retry," tap refetches. Map stays interactive. |
| **Overlapping swaths (multiple events)** | Bands stack with multiply-like translucency; cap effective opacity (don't let stacking exceed ~0.5 visually). Strip reports the **max** magnitude. Sheet for a home in overlap shows the **most recent** event's magnitude with a "+older events" affordance (recommendation; confirm). |
| **Dense pin cluster over a swath** | Pins/clusters render on top (unchanged). The clusterer circle (`fillOpacity 0.9`) sits clearly above the ~0.30 swath. No change needed; verify the clusterer's indigo/purple/red circles stay legible over violet hail — if the red 100+ cluster collides with magenta hail, that's acceptable because the cluster is opaque and labeled with a count. |
| **RE-locked tap** | mini-toast + lock shake (§3.1). No navigation, no logic. |
| **Stale live warning** | amber "as of [time]" prefix on strip. |
| **Tiny viewport with many features (Phase 2 MESH)** | single `addGeoJson` + function-based `setStyle`; cap rendered features by simplifying low-magnitude bands first if perf suffers. Never block the main thread mid-walk. |
| **Layer on, user logs a knock** | Sheet's storm block informs; action row works identically. Disposition saved through the existing flow; swath unaffected. |

---

## 11. Recommended Default View & Time Window

**Recommendation (to confirm with product owner):**

- **Default layer when turned on:** **Hail.** ARX is storm/insurance roofing; hail drives the majority of insurable roof claims, and "did this block get hammered by hail" is the rep's central question. (Off remains the default *state*; Hail is the default *layer* the first time a rep taps in or the last-used layer thereafter — recommend remembering last-used per device.)
- **Default time window:** **last 12 months (365 days)** — matches the design doc's default and balances relevance against typical insurance claim windows (many carriers limit claims to ~1 year from date of loss). This keeps the map focused on *actionable, still-claimable* storms rather than ancient events.
  - Offer a quick window switch later (e.g., "Last storm / 12 mo / 24 mo") as a Phase 1.5 enhancement inside the expanded pill or strip — **not required for v1**; v1 ships fixed 365 with the date always shown so recency is never ambiguous.
- **Default basemap:** unchanged (hybrid/satellite) — reps already navigate by rooflines; swaths are tuned for that basemap.

**Assumptions flagged:**
- That the typical actionable claim window is ~12 months. (Carrier-dependent; confirm with Andrew/back office.)
- That hail > wind in default priority for ARX's market. (Confirm; if a recent wind event dominates the operating area, last-used memory covers it.)
- That data coverage is adequate around the current operating area (Cabarrus County NC per Roof Radar) — the design doc itself flags coverage as TBD. UI degrades to the empty state where coverage is thin, so this is safe but should be validated in-field.

---

## 12. Open Questions for the Product Owner

1. **"Homes in path" definition.** Should the strip count = pins (existing leads) intersecting swaths, or *all parcels* in the swath? Phase 1 only knows about loaded pins. Recommend pins-in-view for v1; confirm wording so it isn't read as "total addressable homes."
2. **Default layer & window.** Confirm Hail + 12 months, and whether to remember last-used per device.
3. **Live vs historical emphasis.** When an active NWS warning *and* historical SPC data both exist in view, which wins the strip headline — the live warning ("storm now") or the max historical hail? (Recommend: live warning takes the strip when active; historical fills the swaths.)
4. **Swath tap behavior.** Ship swaths as visual-only (recommended), or invest in a non-pin-blocking inline magnitude callout?
5. **Roof age / claim status availability.** Does the lead/parcel record reliably carry roof age and claim status for the sheet's storm block, or is that aspirational? Drives whether §5.1 rows 3–4 ship in v1.
6. **Refetch policy.** Approve explicit "Refresh storm data" over auto-refetch for v1?
7. **Priority-tag thresholds.** Confirm the hail buckets and the "Knock first / Worth a look / Low signal" cutoffs — these are sales-judgment calls, not data facts.
8. **Wind ≥70 styling.** Approve darker-red + dashed-stroke (vs a true hatch pattern) as the clash mitigation for v1?
9. **Last-event affordance in overlap.** Show "+older events" in the sheet, or only the most recent?
10. **Window switcher.** Is a time-window selector wanted in v1, or deferred to Phase 1.5?

---

*End of spec. This document specifies UI only and assumes the additive, feature-flagged, separate-`google.maps.Data`-layer, pins-on-top, `requireAuthApi()` implementation already defined in the design and implementation docs. No application code is modified by this deliverable.*
