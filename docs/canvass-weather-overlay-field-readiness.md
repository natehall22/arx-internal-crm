# Canvass Weather Overlay — Field Readiness Review

**Status:** Design review only. No application code is changed by this document.
**Reviewer lens:** Senior product designer who has shadowed door-to-door reps. This is a field-realism stress test of the overlay specced in `docs/canvass-weather-overlay-ui-spec.md` and `docs/canvass-weather-overlay-design.md`, against how the Canvass PWA actually behaves today (`app/(canvass-app)/canvass/`).
**Verdict up front:** The overlay is *conditionally* field-ready. The chrome decisions are mostly right and the additive architecture is genuinely low-risk. But three things will make or break rep adoption — sunlight legibility of translucent swaths, an offline story that does not yet exist in the spec the way the spec implies it does, and a real risk that the feature *quietly suppresses knock volume*. All three are fixable in design. Details below.

> **Standing caveat — assumptions to validate.** I have not interviewed ARX's reps. Every claim about rep behavior (glance time, one-hand grip, cherry-picking instinct, what they say at the door) is a designer's field-shadowing prior, not ARX-specific data. Each is flagged `[ASSUMPTION]`. The single highest-value next step is putting a clickable mock in front of 2-3 setters for 30 minutes. Nothing here substitutes for that.

---

## 0. What today's app actually does (grounding facts)

These are the load-bearing facts the review rests on, read from the code:

- **The whole map is a single-finger, greedy-pan, satellite/hybrid map** (`CanvassMap.tsx`: `gestureHandling: 'greedy'`, `mapTypeId: 'hybrid'`). Reps navigate by rooflines, not street labels. A translucent overlay competes with a *photographic* background, not a flat one. This is the central legibility problem.
- **The core loop is brutally short.** Tap map / tap FAB → `LeadModal` opens → pick a disposition chip → save → next door. The disposition chips are emoji + color (`LeadModal.tsx`). The pin-drop FAB is bottom-right (`page.tsx`, `bottom-24 right-4`).
- **Pins load by viewport, debounced 400ms, only at zoom ≥ 10** (`useViewportLeads.ts`). The map already fires `idle` constantly during a walk and refetches pins. Weather piggybacking on that same `idle` would double request volume mid-walk — the spec already calls this out and recommends explicit refresh. Confirmed correct.
- **Offline is real and load-bearing.** `offlineStore.ts` (Zustand + `persist` to localStorage) queues pin creates while offline and replays them on the `online` event. `isOnline` comes from `navigator.onLine`.
- **CRITICAL: the service worker does NOT cache API responses.** `public/canvass-sw.js` line 46: `if (url.pathname.startsWith('/api/')) return;` — every `/api/*` GET is left to "fail naturally." So when a rep loses signal, the *only* reason pins still show is that `useViewportLeads` keeps them in React state + a `sessionStorage` tile cache. **The weather overlay gets zero help from the service worker.** Any "show last storm data offline" behavior must be built at the app layer (sessionStorage/IndexedDB), exactly mirroring `useViewportLeads`. The UI spec §10 promises "cached weather GeoJSON should survive a relaunch" — that persistence does not exist for free and must be specced as real work. This is the biggest gap between the spec's promises and the codebase's reality.
- **Inspection scheduling already hard-blocks offline** (`page.tsx`: alerts if `!isOnline`). So reps already understand "some things need signal." Weather can lean on that existing mental model.
- **Territory polygons already render under pins at `fillOpacity 0.13`, `zIndex 0`** — living proof the under-pin tinted-layer pattern works. Weather at `~0.30` will be ~2.3× denser than territories. Worth eyeballing both on at once (see knock-volume + legibility).

---

## 1. Field-context stress test

Conditions a setter actually works in, against the proposed UI (collapse-when-off button, top-center status strip, bottom-left legend, feathered translucent swaths under pins, augmented bottom sheet).

| Condition | Holds? | Why / where it breaks | Fix |
|---|---|---|---|
| **One hand, thumb-only** | Mostly | Collapsed button joins the existing left stack (`bottom-24 left-4`) — squarely in the left-thumb arc. Good. The **status strip is top-center** and the **disposition filter is top-right** — both out of thumb reach mid-walk. Strip is read-only (fine). But the spec puts the **"Refresh storm data ↻" affordance on the top-center strip** (§4.3) — that's a *required tap in an unreachable place*. | Move the refresh action to the existing **bottom-left refresh button** (it already exists, `onRefreshArea`) or to a chip near the bottom sheet / left stack. Never put a tap target a walking thumb can't hit top-center. |
| **Walking between doors** | Partial | Reps glance for ~1s `[ASSUMPTION]`. A *thin strip with one number* is glanceable. **Feathered nested bands under a satellite photo are not** — multiple translucent corridors over roofs/trees/shadows is visual soup at a glance while moving. The legend helps decode it but you can't read a legend mid-stride. | Lean harder on the **strip number** as the primary signal and treat swaths as ambient "is there color here at all." Consider a coarser 2-tier color treatment at low zoom and only reveal the 4-band feathering when stopped/zoomed in. |
| **Bright direct sun, cheap screen** | **Breaks** | This is the #1 risk. Translucent pastels (teal-300, amber-300, indigo-400) at 0.26–0.34 over a *bright satellite photo* on a dim, glare-washed budget Android are the first thing to disappear. The spec acknowledges this (§Principle 4) but then specifies low-saturation pastels anyway. Lightness-step logic is sound in theory; in practice 0.28 teal over sunlit gray shingle ≈ invisible. | (a) **Raise the floor**: minimum effective opacity ~0.35 and bias toward **higher saturation + darker** for the low buckets, not pastel. (b) Add a **thin saturated stroke** (already specced) but make it the primary read — a 1.5px solid edge survives sun better than a fill. (c) Offer a **"high-contrast swaths" toggle** that bumps opacity/saturation for bright conditions. (d) Validate on an actual $150 Android outdoors, not a Mac. `[ASSUMPTION: budget Android + glare is the modal device/condition]` |
| **Spotty LTE** | **Breaks without new work** | The SW skips `/api/*`. First weather fetch on a weak signal will hang on the loading skeleton; pins still work (good) but the weather UI looks broken. The spec's "previous layer stays until new data swaps" only helps if there *was* a previous layer this session. | Build app-layer caching for weather GeoJSON keyed by bbox+window (mirror `useViewportLeads` tile cache). Short fetch timeout (~6-8s) then fall to cache or the calm empty/offline state. Never an indefinite spinner. |
| **Gloves / cold hands** | Mostly | 48px button and ≥44px segments meet the bar. The **locked RE segment** is dead space a cold thumb will fat-finger and get a "coming soon" toast — mild annoyance, repeated. | Consider hiding the RE segment entirely until it ships (the design doc already says RE is hidden behind a flag by default — honor that in v1; don't render a locked teaser that eats thumb space and fires toasts). |
| **Fast pace, many doors/hr** | At risk | The feature adds a *decision* ("should I weather-check this block?") to a loop optimized for zero decisions. If it's friction, reps turn it off and never turn it back on. | Make it **set-and-forget**: remember last-used layer per device (spec already recommends), default sensible, and make the strip self-update silently as they walk. The rep should never *operate* it after the first tap of the day. |
| **Nighttime / dusk knocking** | Untested | Storm-roofing reps knock into the evening. Pastel-on-satellite at dusk with auto-dimmed screens is a different legibility regime than noon. | Validate at the two extremes (noon glare, dusk dim). The high-contrast toggle covers both. |

**Net:** chrome placement is ~80% right (one real bug: refresh on the strip). The two genuine breakers are **sunlight legibility of the chosen pastel ramp** and **offline weather caching that doesn't exist yet**.

---

## 2. Workflow integration: does it help the loop or interrupt it?

The loop today: **see pin → walk to door → set disposition → next door.** Weather must ride *alongside* this, never inside it.

**What integrates well:**
- The overlay is a *background tint* + a *strip*. It informs the "which way do I walk / which block first" decision that happens *between* loops, which is exactly the right insertion point. It does not sit inside the knock itself.
- Pins stay on top and stay tappable (`Data` features `clickable:false`). The pin-drop map-click handler is untouched. The disposition chips in `LeadModal` are untouched. This is the single most important thing the design got right: **the knock is sacred and the design treats it that way.**
- The bottom-sheet storm-context block is *additive context on a sheet the rep already opens* — zero new navigation. Good.

**Where it risks adding friction:**
1. **The bottom-sheet storm block can push the disposition chips below the fold.** `LeadModal` already carries name/phone/address/disposition grid/notes/schedule. Adding a 3-row storm block at the *top* shoves the primary action (disposition chips) down on a small phone. The spec warns about this (§5) but the mitigation ("keep to 3 rows") is not enough on an iPhone SE with the keyboard up. **Fix: put the storm block as a single collapsible one-line banner at the top ("⛈ 1.5″ hail · May 14 ▸"), expandable on tap — not a 3-row block by default.** The disposition chips must remain the first thing the thumb lands on.
2. **The "decision to check weather" is itself friction** (see §1). Mitigated by set-and-forget defaults.
3. **Switching layers (Hail↔Wind) mid-walk** is a deliberate operation. Fine as an occasional thing; it should never be required to log a knock.

**Verdict:** integrates cleanly *if* the bottom sheet keeps disposition chips as the dominant, top-most action and the storm block is a collapsed one-liner. As specced (3-row block on top), it risks demoting the actual job.

---

## 3. Knock-volume risk + design response (the most important section)

**The risk is real and under-weighted in the current spec.** ARX's economics and the 444 program reward *volume*: 400 doors + 4 inspections/week per setter (`CLAUDE.md`). The overlay's entire pitch is "knock where it was hit." Those two incentives are in direct tension. A naive rep seeing a hail overlay will rationally conclude: *skip the blocks with no color, only knock the colored cores.* That:

- **Cuts total doors knocked** → directly attacks the 444 Week-1/Week-2 thresholds and total coverage.
- **Leaves money on the table.** Storm data is *probabilistic and sparse* — SPC reports are points, not truth; MESH is an estimate; a "no recorded hail" block can absolutely have claimable roofs (wind, prior storms, hidden damage). Cherry-picking only the reddest cores means walking past sellable houses.
- **Creates dangerous false confidence.** A rep who trusts the overlay too much stops *looking at roofs*, which is the actual skill.

**Why this matters more here than for a generic SaaS:** the comp stack (setter 5%, 444 bonuses tied to door counts) means suppressed volume hits rep paychecks *and* company pipeline simultaneously. This is not a UX nicety; it's a business-model risk.

**Design responses (these should be locked in, not optional):**

1. **Frame it as "knock-first," never "knock-only."** Language matters. The bottom-sheet priority tag already says **"Knock first" / "Worth a look" / "Low signal"** (UI spec §5.2). Keep that wording — it implies *everything gets knocked, in an order*. **Never** ship a label like "skip" or "no opportunity." A "Low signal" house still gets the rep at the door.
2. **Never hide or grey out non-hit pins or non-hit areas.** The overlay tints *positively* (where it was hit) and leaves everything else as normal map. Absence of color must read as "no data here," not "don't knock here." The empty-state strip wording ("No recorded hail in this area") is decent but should be explicitly paired in onboarding with "— still knock it; data is incomplete."
3. **Keep door-count front and center.** The bottom nav already shows `todayCount` (`page.tsx`). Consider surfacing the 444 progress (doors today vs target) somewhere the rep sees it *while* the weather layer is on, so the volume goal stays psychologically present and competes with the cherry-pick instinct. `[ASSUMPTION: 444 counts are derivable client-side; verify.]`
4. **Manager guardrail (data, not UI):** managers should be able to see *coverage* (doors knocked across a territory) independent of hit zones, so a rep who's only knocking cores shows up as a coverage gap. (See §6.)
5. **Onboarding talk-track, not just UI:** the single most effective lever is how reps are *trained* to read it. One slide: "The overlay tells you where to *start*, not where to *stop*. Full street, every time. The map is a tiebreaker for which street first." `[ASSUMPTION: training is owned by Nathan per CLAUDE.md — yes.]`

**Bottom line:** ship the overlay as a *prioritization* tool layered on top of a *coverage* expectation, and instrument coverage so the cherry-pick failure mode is visible to managers. If the design instead lets reps treat color as a knock/skip gate, it will measurably hurt 444 attainment.

---

## 4. Offline behavior spec (the pin/disposition flow must NEVER be blocked)

**Hard rule, restated:** weather is a guest. If weather is loading, errored, offline, stale, or absent, the rep can still drop a pin, open the sheet, set a disposition, and (online only, as today) schedule. Weather code must be unable to touch `offlineStore`, the FAB, the map-click handler, or `LeadModal`'s actions. This is architecturally true today only if the weather layer stays fully separate — enforce it in code review.

**Required offline behavior (this is real work, not free from the SW):**

| Situation | Pins / disposition flow | Weather overlay behavior |
|---|---|---|
| Online, layer on, data present | Normal | Render swaths + strip + legend as specced. |
| **Goes offline mid-street, layer was on** | **Fully unaffected** — pins in memory render, FAB drops pins, disposition saves to offline queue (`addLead`), exactly as today. | Keep showing the **last-fetched GeoJSON from the in-session cache.** Strip switches to "Offline — last storm data shown · [date]" with the amber dot. No spinner. No error wall. No layer flicker. |
| Offline, no weather ever fetched this session | Fully unaffected | Muted strip: "Offline — no stored storm data." No swaths. The collapsed button still works (tapping it just can't fetch). |
| Offline, app relaunched (PWA cold start) | Pins refetch when signal returns (existing visibility-change handler). | **Spec promises persisted GeoJSON survives relaunch — it won't unless built.** Either (a) persist last weather GeoJSON to IndexedDB/localStorage keyed by bbox+window, or (b) honestly degrade to "Offline — no stored storm data" on cold start. Pick one and spec it; do not imply persistence that isn't there. |
| Weak signal, fetch in flight | Fully unaffected | Skeleton strip for max ~6-8s, then timeout → fall to cache or calm empty/offline state. **Never an indefinite spinner**, never a modal, never anything covering the map. |
| Weather route 5xx | Fully unaffected | Route is designed to fail-soft (200 + empty FeatureCollection). If a hard error reaches the client: "Couldn't load — tap to retry" on a *reachable* control (not the top-center strip alone). |

**Implementation notes for the offline cache (mirror `useViewportLeads`):**
- Cache weather GeoJSON in `sessionStorage` (in-session) and optionally IndexedDB (cross-relaunch), keyed by `bbox + windowDays + layer`, same TTL philosophy as the tile cache.
- The weather fetch must use its **own AbortController** and **own debounce**, never share state with the pin viewport fetch, so a stalled weather request can't delay pin loading.
- Add a hard fetch timeout. The pin path has no timeout because the SW lets it fail naturally and the queue absorbs it; weather has no such safety net, so it needs an explicit one.

**One-line guarantee to put in the implementation prompt:** *"If `navigator.onLine === false`, the weather layer renders from cache or shows a calm offline strip and otherwise does nothing; it must not call any function in `offlineStore`, must not block `LeadModal`, and must not intercept map clicks."*

---

## 5. What a rep actually needs at the door (sheet content)

At the door, in the 2-3 seconds before someone answers, the rep is deciding *how to open*. The storm data is only useful if it becomes a **talk-track hook**. Three questions, in order:

1. **Did THIS house get hit?** (binary, glanceable)
2. **How big?** (size anchor a homeowner understands — "golf-ball size")
3. **How recent?** (drives urgency + claim-window relevance)

Plus, if and only if the CRM already has it: **roof age** and **claim status** (don't re-pitch someone mid-claim; an old roof + hail = strong open).

**SHOW (collapsed one-liner by default, expandable):**
- `⛈ 1.5″ hail · May 14, 2026` — size in real-world anchor + date. The size anchor ("golf ball," "quarter") matters more than the decimal `[ASSUMPTION: homeowners relate to objects, not inches — standard storm-sales practice].`
- A one-tap **talk-track hook** when expanded: e.g. *"Your street took golf-ball-size hail on May 14 — we're inspecting roofs in the area free."* This is the single highest-value addition the sheet can make and is **not in the current spec.** It turns data into a sentence the rep can say. `[ASSUMPTION: reps want a scripted opener — validate; some closers hate scripts.]`
- Priority tag: "Knock first / Worth a look / Low signal" (keep — it's coaching, not a gate).
- Roof age / claim status **only if present** in the lead record. Never fabricate; show nothing rather than "unknown" clutter.

**DON'T SHOW (noise at the door):**
- Exact MESH value to the hundredth of an inch. "1.5″" is plenty; "1.4732″" is false precision and unreadable mid-knock.
- Multiple historical events stacked. Show the **most recent claimable event**; bury "+older events" behind a tap (it almost never changes the opener).
- Wind *and* hail simultaneously in the sheet unless both are material. Lead with whichever is the stronger claim signal for that address.
- Data provenance / source / confidence intervals. Reps don't pitch radar methodology.
- Anything that requires scrolling past the disposition chips. The chips win.

**The sheet's job:** turn "this house, this storm" into one sayable sentence and one priority word, in the top inch, collapsed by default, never above the disposition action.

---

## 6. Manager / setter-manager view

**Yes, there's real value — but it's a different surface, and it's mostly about coverage, not just hit zones.** Territory features already exist (`app/admin/canvass-territories/`, `assignedTerritories` rendered as polygons). Two distinct manager needs:

1. **Territory assignment / planning (high value):** A manager drawing or assigning work areas genuinely benefits from seeing hit zones overlaid on territory polygons — "assign the team to the corridor that took 1.75″ on May 14." This is a *planning* view, can be richer/slower than the rep view, and lives in the territories editor or an ops/reports surface, not the rep PWA. Recommend exposing the same weather GeoJSON layer (read-only) in the territories editor for managers.
2. **Coverage-vs-hit accountability (the guardrail from §3):** The manager view should overlay **where reps actually knocked** (pin density) against **hit zones**. This catches the cherry-pick failure mode: a hot zone with thin pin coverage = a coaching conversation; full coverage of a cold zone = a rep doing the right thing. This is the manager-side answer to the knock-volume risk and is arguably more valuable than the rep overlay itself.

**Recommendation:** rep overlay ships first (it's the requested feature), but spec a **manager weather layer in the territories/ops view** as a fast follow, explicitly framed around coverage + assignment, not just "pretty hit map." `[ASSUMPTION: managers want this — validate with Evan/Steve who own setting + in-field ops.]`

---

## 7. Prioritized UX recommendations

Keeping the locked decisions (minimal chrome, collapse-when-off, pins-on-top, thin strip). Ordered by impact on rep adoption.

**P0 — adoption blockers, fix before ship:**
1. **Re-tune the color ramp for sunlit satellite.** Raise opacity floor (~0.35), make low buckets *saturated and darker* rather than pastel, make the saturated stroke the primary read, add a **high-contrast toggle.** Validate on a budget Android in noon sun. (§1)
2. **Build real offline weather caching** (sessionStorage + optional IndexedDB), own AbortController + own debounce + hard timeout. The SW gives nothing here. Don't ship the spec's "survives relaunch" claim without building it. (§4)
3. **Move the refresh affordance off the top-center strip** to a thumb-reachable control (reuse the bottom-left refresh button). (§1)
4. **Bottom-sheet storm block = collapsed one-liner, not a 3-row block.** Disposition chips stay the top-most, dominant action. (§2, §5)

**P1 — make it actually useful:**
5. **Add a talk-track hook line** to the expanded sheet — the data-to-sentence step is what converts a feature into sales value. (§5)
6. **Lock the anti-cherry-pick framing:** "Knock first" language, never hide non-hit pins, pair empty-state with "still knock it." (§3)
7. **Surface 444 / door-count progress while the layer is on** so volume stays salient. (§3)
8. **Default Hail, remember last-used per device, set-and-forget** so reps never operate it after the morning tap. (§1, §2)

**P2 — fast follows:**
9. **Hide the RE segment entirely in v1** (don't ship a locked teaser that eats thumb space + fires toasts). (§1)
10. **Manager coverage-vs-hit layer** in territories/ops view. (§6)
11. **Coarse-at-low-zoom, feathered-when-zoomed-in** swath rendering for glanceability while walking. (§1)
12. **Size anchors over decimals** everywhere homeowner-facing. (§5)

---

## 8. Walkthroughs

### 8.1 First 5 minutes of a rep's day

1. Rep parks, opens the Canvass PWA (installed, standalone). Map loads to last position; pins for the area stream in by viewport as today.
2. Rep taps the **weather button** at the top of the left control stack once. Because last-used is remembered, it comes up on **Hail** immediately (no menu hunt). Bands fade in under the pins; the **top-center strip** reads *"Up to 1.75″ · May 14"*.
3. One glance tells the rep: yes, this neighborhood got hit, golf-ball-plus, recent enough to be claimable. The colored corridor shows it concentrated two streets north.
4. Rep decides the *order*: start on the north corridor (knock-first), then sweep south to cover the rest of the assigned territory — **all of it**, because the door-count target is right there in the bottom nav and the cold blocks still have claimable roofs.
5. Rep pockets the phone and walks to the first door. **The overlay is never touched again** unless they switch neighborhoods. It's a morning orientation tool, not a per-door console. Total weather interaction: one tap, one glance, ~3 seconds.

### 8.2 At-the-door

1. Rep walks up to a house in the hit corridor, taps its pin (or taps the map to drop a new one). The **bottom sheet** slides up — same sheet as always.
2. Top inch shows a collapsed banner: **`⛈ Golf-ball hail · May 14 ▸`** with a small **"Knock first"** chip. Directly below it, unchanged and dominant: the **disposition chips** (🔥 Hot Lead, 🔄 Go Back, etc.).
3. The door opens. The rep taps the banner once to expand the talk-track hook and opens with: *"Hey — your street took golf-ball-size hail back on May 14, we're inspecting roofs in the neighborhood at no charge."* Homeowner engages.
4. Rep sets the disposition (Hot Lead), the existing flow saves it — online via API, or queued offline via `offlineStore` if signal dropped. **The weather data played no part in the save path.**
5. Two houses later, signal drops (rural edge of the subdivision). Pins still drop and save to the queue. The weather strip quietly switches to *"Offline — last storm data shown · May 14"* with an amber dot. Swaths stay on screen from cache. Nothing breaks; the rep doesn't even slow down.
6. A "Low signal" (no-recorded-hail) house mid-street: the rep **still knocks it** — the priority tag ordered the street, it didn't gate it. The sheet shows "No recorded hail at this address — data is incomplete," and the disposition flow is identical.

---

## 9. Open items to validate with real reps (consolidated)

1. Is a budget Android in direct sun the modal device/condition? (drives the entire color-ramp decision)
2. Do reps actually glance ~1s, and is a 4-band feathered swath readable in that time while walking?
3. Will reps cherry-pick hit cores and drop door volume? (the 444 risk — measure it in a pilot)
4. Do reps want a scripted talk-track hook, or will closers reject scripts?
5. Are roof age / claim status reliably present in lead records? (drives sheet rows)
6. Are 444 / door-count progress numbers derivable client-side to surface alongside the layer?
7. Do managers (Evan/Steve) want the coverage-vs-hit territory layer?
8. Is "homes in path" (pins-in-view) a useful number or a confusing one to reps?

*End of review. UI/design only; no application code is modified by this document.*
