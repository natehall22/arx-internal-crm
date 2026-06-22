# Canvass Weather/Hail Overlay — Competitive Analysis

**Author:** Competitive research pass for the canvass weather-overlay feature
**Date:** 2026-06-18
**Companion docs:** `canvass-weather-overlay-design.md`, `canvass-weather-overlay-ui-spec.md`, `canvass-weather-refresh-job-spec.md`

## Purpose & method

How do the canvassing / door-knocking and storm-data products roofing reps actually use implement map overlays and hail/weather data? Goal: copy what works, avoid known pitfalls, and get an honest read on whether ARX's free-data approach (NOAA/SPC/MRMS, Phase 1 points+warnings then Phase 2 swaths) can compete.

**Sourcing discipline used throughout:**
- **[Confirmed]** = stated on a vendor's own docs/help center or corroborated across multiple independent sources.
- **[Marketing]** = vendor's own promotional claim, not independently verified.
- **[Review]** = drawn from third-party review aggregators (G2, Capterra, app stores, roundup sites). These reflect user sentiment, not audited fact.
- **[Inference]** = my reasoning, explicitly flagged.
- **[Unverified]** = could not confirm; flagged so it is not treated as fact.

**Important caveat on JS-rendered pages:** Several vendor pages (e.g. the SalesRabbit help-center article on Weather/Storm Finder) returned an empty shell on fetch — they are client-rendered. Where that happened I relied on search snippets and the marketing landing pages that did render, and I flag those points. **Pricing is especially volatile and is flagged as may-be-outdated everywhere; do not quote any price below as fact.**

---

## Per-product summaries

### SalesRabbit — Weather (in-app overlays) + HailTrace integration

SalesRabbit is a full door-to-door canvassing platform (territory drawing, pins, GPS rep tracking, leaderboards) that sells **Weather** as an add-on module rather than a bundled core feature.

- **What the overlay shows [Confirmed, vendor]:** Four map types — **hail size, hail probability, hurricane, and wind gusts**. Map data goes back **two years**, "unlimited" overlays, plus push **weather notifications**. (Source: salesrabbit.com/weather — this page *did* render.)
- **Storm Finder tool [Confirmed, vendor]:** Lets a user see storm history within a specified radius on the in-app overlay, with filters on hail size, wind gust, and hail probability, and returns the storm **date** and details. This is the "where did it hit and how bad" lookup reps use to pick a neighborhood.
- **Data source [Confirmed for reports; partially inferred for overlays]:** The **forensic/insurance reports are explicitly powered by Verisk** ("the top name in insurance data … the same data as insurance analyzers"). The marketing implies the *overlays* draw on the same insurance-grade weather data, but the overlay pipeline itself is not spelled out. [Inference] The underlying inputs are radar-derived hail estimates like everyone else's.
- **HailTrace integration (separate from the native Weather module) [Confirmed, vendor help center]:** SalesRabbit auto-imports all maps a customer created in HailTrace within the last 24 hours and makes them visible to all reps. The sync **runs once daily at 6am MST**. So a SalesRabbit + HailTrace shop sees HailTrace's meteorologist swaths layered into the canvass map, refreshed daily.
- **Paid?** Yes. Weather is an add-on; the Verisk forensic reports are pay-per-report ("submit a request, get an insurance-approved report within minutes"). HailTrace is a separate subscription on top.
- **Mobile UX [Review]:** Reps pull storm overlays up in-app, draw/assign areas over the hot zones, then knock. Complaints: the **mobile app can be slow with lag in data loading**; **fewer map filter options than competitors**; **color overlay on zones obscures home details**; hard to tap a home to start a route without typing the address; and notably **map pins land inaccurately in newer subdivisions** ("pins conglomerate somewhere else") per Capterra. General app gripes: crashes/sync issues, **heavy battery drain**, login/device-auth failures.
- **Talk-track framing [Marketing]:** Positioned around "go where the deals are" and pairing overlays with insurance-ready Verisk reports so reps knock with claims-grade backup rather than a guess.

### SPOTIO (Spotio) — territory mapping + canvassing, HailTrace as the storm layer

SPOTIO is a multi-industry field-sales platform; for roofing its storm story is built on a **native HailTrace integration** rather than its own hail data.

- **What the overlay shows [Confirmed/Review]:** SPOTIO's own strength is **territory intelligence and property-level data layers** — marketing cites "200+ data overlay points," and the ability to **filter by roof age, overlay storm damage, home value, homeowner status**. The actual *hail* layer comes from HailTrace.
- **Storm workflow [Marketing]:** Draw drag-and-drop territory boundaries **around storm swaths** within minutes of a storm, push assignments to reps via mobile notifications with exact map boundaries, route crews to highest-severity neighborhoods first. HailTrace's "Door Kit" / Branded Weather History Reports flow through this integration so reps have a branded leave-behind.
- **Data source:** HailTrace (meteorologist-verified, radar-derived) for hail; SPOTIO's own property/demographic data for the non-weather layers.
- **Paid?** Yes — quote-based, **5-user minimum**, annual contract typical. HailTrace is an additional subscription.
- **Mobile UX [Confirmed/Review]:** Territory boundaries sync to the mobile app; **color-coded pins show visited vs not-visited doors**. Known issues per G2/Capterra: **app crashes and random logouts**; **territory maps get cluttered with old notes**, overwhelming reps who inherit an existing area; outbound calls flagged "Spam Likely"; support handled by bot; **contract/auto-renewal disputes** are a recurring theme.

### HailTrace — the meteorologist-verified storm-data layer reps overlay

HailTrace is **not a canvassing app** — it is the storm-intelligence layer most serious storm shops run *alongside* SalesRabbit or SPOTIO. A third-party roofing-software roundup scored it 9.1/10 and explicitly framed it as "the layer that makes your canvassing app worth using."

- **What it shows [Confirmed/Marketing]:** Real-time **hail, wind, hurricane, tornado** mapping as **swaths** (continuous paths/areas), plus estimated affected-structure counts and impacted regions split by state/city/zip. Maps are **meteorologist-reviewed / "Forensic Meteorologist-certified."** You can upload past customers and get alerted when their addresses are hit.
- **Data source [Confirmed, vendor + roundup]:** **NOAA radar returns to estimate hail size, validated against NWS storm reports** from meteorologists/trained spotters, then GIS-overlaid onto topographic maps. **This is the key competitive insight for ARX:** HailTrace's *inputs are the same free U.S. government radar/report data ARX can access*. Their moat is the **meteorologist review layer + insurance-grade certification + speed**, not exclusive data.
- **Door-level use [Marketing]:** Hand the homeowner a branded, meteorologist-verified report showing exactly when the storm hit and at what severity — explicitly positioned as a trust/credibility advantage over "we noticed some storm damage in the area." Reports are designed to carry weight with insurance adjusters.
- **Paid?** Yes, and **opaque** — quote-based geographic tiers (city/state/national). À-la-carte individual storm maps were listed around **~$230 each [may-be-outdated]**, with free "1-star" maps as a teaser. No public subscription pricing.
- **Known issues [Review]:** **Mobile app lag**, especially on Android, in app-store reviews.

### HailRecon / Interactive Hail Maps — hail data with built-in canvassing

Interactive Hail Maps' **HailRecon** is the mobile companion that turns a phone into a hail-mapping + canvassing tool — one of the few hail-data products with **door-knock tracking built directly into the hail layer**.

- **What it shows [Confirmed/Marketing]:** "Forensic-level" radar hail swaths binned into **ten levels from ½" to 3"+ in ¼" increments**, a location indicator (you-are-here vs the swath), on-the-ground hail reports, address markers, and **4+ years of historical storm dates** (paid). Built-in camera that auto-uploads/annotates photos into a company cloud and attaches them to Hail Impact Reports.
- **Canvassing UX [Confirmed]:** Door-knock tracking is native — mark which doors you've knocked and which need follow-up, track neighborhood saturation, all over the hail swath. This is the closest analog to what ARX is building (hail layer + canvass pins in one view).
- **Paid?** Yes — requires an Interactive Hail Maps subscription; **free push alerts limited to small-hail reports only**; full historical access is paid.
- **Known issues [Review]:** **"Crashes more than it works"**; reports it **doesn't work on Android at all** for some users; **discrepancies in real-time weather**; **can't turn off daily hail-percentage notifications**; cost gripes ("hundreds in subscription fees when free apps give the same NOAA data").

### Roofing-adjacent tools (Roofr, JobNimbus, Leap, Knockio/KnockBase, Sunbase)

- **Pattern [Confirmed/Review]:** None of these own a hail-data engine. The hail layer is almost universally **HailTrace via integration** (KnockBase, SPOTIO) — "your team knows which streets took damage before anyone leaves the office."
- **Roofr** — proposals/measurements + territory mapping; storm targeting is not its core.
- **JobNimbus** — CRM/production; canvassing & storm are integration-fed.
- **Knockio/KnockBase** — strength is **route intelligence** (minimizing travel between doors across a crew) layered on HailTrace storm data.
- **Sunbase** — structured storm-restoration canvassing (territory assignment, door-knock performance), HailTrace-style data via integration.
- **Leap** — in-home digital closing, not field hail overlay.
- [Inference] The recurring story: **canvassing app = where reps knock; HailTrace = the brain telling them where.** The hail-data and canvassing layers are almost always *separate vendors stitched together* — which is exactly the seam ARX can own by building both in one app.

### Terros (new app / 2025-2026 update)

**Bottom line up front [Confirmed]: Terros has no weather/hail/storm overlay at all.** It is a door-to-door *sales leadership / canvassing* platform whose pitch is manager coaching, AI task generation, gamification, and premium homeowner/property data — not storm targeting. I am confident I found the right "Terros" (terros.com, App Store id 6444381162, developer Terros, Inc.), and confident it does not compete on the weather-overlay axis this doc is about. I include it because the user flagged its "fantastic new update / whole new app" and because several of its *map and canvassing-UX* choices are directly relevant to ARX even though its data story is not.

- **What it is / who it's for [Confirmed]:** A high-performance D2D sales platform. Customer logos and the roundup coverage are **solar, pest, and telecom** ("Built for D2D, specifically solar"). Founded as **Statra** in 2019 (founders ex-Sunrun / ex-Amazon), **rebranded to Terros in 2024** with an AI focus — that rebrand *is* the "whole new app" the user heard about. **No roofing/insurance/storm positioning anywhere.** [Inference] The "new update" buzz in solar D2D circles is the Statra→Terros AI relaunch, not a hail feature.
- **The "new app" / update content [Confirmed]:** AI-generated tasks (20+ task types generated hourly, tailored per user); **manager-coaching focus** ("you don't need 100 more reps, you need 5 great managers", pitch coaching, Skill Insights, 1:1 tooling); **Sales Activity Log**; **gamification/competitions/leaderboards/streaks**; recruiting/onboarding/scheduling modules; a **redesigned Location View** using a **bottom-sheet** instead of a full-screen view; **Quick Disposition** (single-tap disposition update); a separate companion app, **Terros Recorder** (pitch recording, App Store id 6747404555). App-store "What's New" notes are **generic boilerplate every release** ("performance enhancements, bug fixes") — no feature specifics are disclosed there [Confirmed]. Releases are frequent: iOS reached **0.77.0 (Apr 2026)**; still pre-1.0 versioning.
- **Mobile map experience [Confirmed/Review]:** Canvass tab with **property pins**, **custom dispositions** (a stand-out — reps praise it), **tags** (record info without moving the account through workflow), **multi-accounts** per address (apartments/businesses), **custom pins** for saved locations, in-map appointment scheduling, and workflow actions with history. The **bottom-sheet Location View** (tap a pin → details slide up from the bottom rather than taking over the screen) is the most copy-worthy clean-phone-UX pattern. **Premium Data / Canvass Pro** surfaces **real-time homeowner & property data** in-app to qualify leads at the door — the roundup calls real-time homeowner data "a feature rarely found in other D2D apps." Canvass Max adds richer **resident filters** (e.g. high energy usage, home upgrades) — solar-targeting filters, the analog of what storm filters are for roofing.
- **Weather/storm/hail overlay [Confirmed — none]:** No hail, wind, storm, radar, NOAA, or weather layer of any kind. Their "premium data" moat is **property/homeowner/demographic data** (solar-qualification), not storm data. **No disclosed weather data source because there is no weather feature.**
- **Reception [Confirmed/Review]:** iOS **4.3 / 70 ratings**. Praise: custom dispositions, **up-to-date property-owner info**, geo-accuracy of logged pitches, accountability for managers (one solar owner credits it with $200k in two weeks). Complaints — and they rhyme with every other product in this doc: **app freezes/inconsistency in the field** ("constantly freezing on doors," knocks/pitches sometimes don't record the address), **dispositions only visible when zoomed into a small radius** (filter "useless unless zoomed in"), **no activity log to review who you pitched a week or two ago**, **no route planning / curated target lists**, **flaky calendar-integration API** that "only randomly syncs," and **lots of bugs on Android**. [Unverified] I found **no Reddit / r/roofing / r/solar threads** specifically on the new version — searches surfaced only the vendor site, app stores, and the ConveYour roundup; treat the review themes as app-store-sourced sentiment, not forum consensus.
- **Pricing [Confirmed from App Store, may-be-outdated]:** In-app subscriptions: **Canvass Pro $29.99/mo or $269.99/yr; Canvass Max $49.99/mo or $479/yr.** Team/company/enterprise pricing is **quote-only, not public** (no free tier). The per-seat IAP figures are unusually transparent for this category — useful pricing benchmark for ARX.
- **Adjacency signal [Inference]:** Apple lists Terros right alongside **SalesRabbit, SPOTIO, RepCard, Enzy, Siro AI** under "You Might Also Like" — i.e. the market files it next to SalesRabbit/SPOTIO as a canvassing/field-sales platform, just one with a coaching+AI tilt and a solar (not storm) data focus.

---

## Comparison table

| Product | Overlay data shown | Source (disclosed) | Mobile UX notable | Paid? | Common complaints |
|---|---|---|---|---|---|
| **SalesRabbit Weather** | Hail size, hail probability, hurricane, wind gusts; 2yr history; Storm Finder radius lookup w/ date | Verisk (reports, confirmed); overlays radar-derived [inference] | In-app overlays + draw/assign zones; daily 6am HailTrace import | Yes — add-on + pay-per-report; HailTrace separate | Slow/laggy data load; fewer filters; **pins inaccurate in new subdivisions**; zone color hides homes; battery drain; crashes |
| **SPOTIO** | Property layers (roof age, value, homeowner) + HailTrace swaths | HailTrace (hail); own property/demographic data | Color-coded visited/not pins; territory sync; draw around swaths | Yes — quote, 5-user min, annual | Crashes/logouts; **maps cluttered w/ old notes**; auto-renewal disputes; bot support |
| **HailTrace** | Hail/wind/hurricane/tornado **swaths**, affected-structure counts, branded reports | **NOAA radar + NWS storm reports, meteorologist-reviewed** | Real-time alerts; branded door-kit leave-behind | Yes — opaque tiers; ~$230/map à la carte [may-be-outdated] | **Mobile lag (esp. Android)**; pricing opacity |
| **HailRecon / Interactive Hail Maps** | Radar swaths in 10 bins (½"–3"+); 4yr history; in-app camera | Radar-derived ("forensic-level") | **Built-in door-knock tracking over the swath**; you-are-here indicator | Yes — subscription; free alerts = small hail only | **Crashes a lot; broken on Android for some**; can't mute notifications; cost gripes |
| **Knockio/KnockBase, Sunbase, Roofr, JobNimbus, Leap** | Whatever HailTrace provides via integration | HailTrace (integration) | Route optimization (Knockio); territory tracking | Yes — varies | Integration-dependent; no native hail engine |
| **Terros** (solar/pest/telecom, *not roofing*) | **No weather layer** — premium **homeowner/property data** + resident filters (energy usage, home upgrades) | Property/homeowner data (solar qualification); **no weather source** | **Bottom-sheet Location View**; custom dispositions; tags; multi-accounts; AI tasks; pitch recording | Yes — **Canvass Pro $29.99/mo, Max $49.99/mo** [App Store]; team/enterprise quote-only | **Freezes/inconsistent in field**; dispositions only show when zoomed in; **no activity log; no route planning**; flaky calendar sync; Android bugs |

---

## Underlying data reality (cross-cutting, [Confirmed via research])

Every product above — including the premium ones — ultimately rests on **radar-derived hail estimates from NOAA**. The well-documented limitations apply to all of them, and ARX should design around these rather than pretend they don't exist:

- **Radar estimates hail size poorly.** Horizontal advection of falling hailstones, variable size distributions, scattering/attenuation, and mixed hydrometeors all degrade accuracy. MESH (the radar metric) **produces false positives** for hail damage when used as a hard threshold.
- **Estimated hail size ≠ actual roof damage.** Radar reports a sky-level estimate; it knows nothing about roof age, material, or building envelope. 1.5" hail on an old roof ≠ 1.5" on new metal. This is the single biggest gap between "the map says hail" and "there's a claim."
- **Rural gaps.** Some datasets only report where a live spotter confirmed, leaving holes; others blend high-altitude radar readings with ground reports without distinguishing them.

[Inference] This means **the paid tools' advantage is not the data — it's (a) the meteorologist QA layer that filters false positives, (b) the swath rendering, (c) insurance-grade certification, and (d) speed of refresh.** Those are the things ARX should think about copying or consciously deciding to skip.

---

## Patterns ARX should copy

1. **Door pins always render on top of the weather layer.** This is already in ARX's design (`canvass-weather-overlay-design.md` §16) and it's correct — SalesRabbit gets *dinged* for the opposite (zone/overlay color hiding home detail). Keep weather as a translucent layer beneath pins, never the other way.
2. **A "Storm Finder"-style radius lookup with date + magnitude.** SalesRabbit's most-cited useful feature is "show me storms within X miles, filtered by hail size/wind, with the date." ARX already fetches SPC points with magnitude and date — surfacing them as a filterable radius lookup is a cheap, high-value Phase 1 win that maps directly to existing `lib/roofradar-open-data.ts`.
3. **Color-bin hail by size, with a clear legend.** HailRecon's ¼"-increment bins and HailTrace's size coloring are the mental model reps expect. ARX's Phase 2 MESH swaths should bin by estimated size with a legend, not a single flat color.
4. **One toggle per layer, off by default, with a legend that doubles as the control.** Avoids the SPOTIO "cluttered map" complaint. Let reps turn hail/wind/warnings on independently so the phone screen never shows everything at once.
5. **Daily refresh cadence is industry-normal and acceptable.** SalesRabbit's HailTrace sync runs **once a day at 6am**. ARX's planned scheduled morning refresh job (`canvass-weather-refresh-job-spec.md`) is right in line — reps do not expect minute-by-minute hail data for historical canvassing, so a morning batch is competitive.
6. **A branded, address-specific leave-behind is the real door-level differentiator.** HailTrace's whole door-level pitch is "hand them a branded report showing when/how hard the storm hit." Even with free data, ARX generating a simple branded one-pager (storm date + estimated hail size for that address, ARX logo) would close most of the perceived gap at the door.
7. **Built-in canvass tracking over the hail layer is the unified-app advantage.** HailRecon proves reps want door-knock saturation tracked *on the same screen* as the swath. ARX already has both — this is the seam competitors stitch across two vendors. Lean into it.
8. **Bottom-sheet, not full-screen, for tapping a pin/property (from Terros).** Terros's most-praised UX change in the new app was moving the property/Location detail from a full-screen takeover to a **bottom sheet** that slides up over the still-visible map. For a weather-overlay map this is the right pattern: a rep taps a house, the detail (address, disposition, and the storm/hail info for that point) rises from the bottom while the overlay and surrounding pins stay in view — they never lose map context. ARX should use a bottom sheet for the per-pin weather/property detail.
9. **Single-tap "Quick Disposition" keeps the canvass loop fast (from Terros).** One-tap disposition is the interaction reps live in all day; don't bury it behind menus when the weather layer is on.
10. **Resident/property filters are the non-weather targeting layer worth having (Terros + SPOTIO).** Terros's Canvass Max filters (high energy usage, home upgrades) and SPOTIO's property layers prove reps want to *narrow the map* by attributes, not just storm severity. ARX's hail/wind filters should live in the same filter UI as any property filters so reps compose "hit by hail AND older roof" rather than toggling layers in isolation.

---

## Mistakes ARX should avoid

1. **Don't let the overlay tank phone performance.** Lag/slow data load (SalesRabbit), crashes and Android breakage (HailRecon), crashes/logouts (SPOTIO) are the #1 category of complaint across *every* product. Serve pre-computed/cached GeoJSON (already the Phase 2 plan), simplify swath geometry, cap features rendered per viewport, and debounce/gate refetch behind a "refresh this area" button rather than firing on every map pan.
2. **Don't let the weather layer obscure pins or homes.** Directly learned from SalesRabbit. Translucency + pins-on-top + an easy off toggle.
3. **Don't let stale notes/layers pile up and overwhelm reps.** SPOTIO's "maps cluttered with old notes." Default the weather view to a recent window (e.g. last storm / last N months) and make the time window a first-class filter.
4. **Don't overstate accuracy at the door — build the talk-track around it.** This is the biggest *legal/credibility* risk, not a UX one. Radar hail size is an estimate and produces false positives; it is not proof of damage. Reps should be trained to say "your area shows estimated hail of ~X inches on [date] — that's worth a free inspection," **never** "the data confirms your roof is damaged." The honest framing is also the higher-converting one (inspection-booking, not over-promising a claim).
5. **Don't try to match insurance-grade certification with free data.** ARX cannot credibly claim "Forensic Meteorologist-certified" or "Verisk-grade" reports. Don't imply it. Position ARX's free report as a *screening/targeting tool that gets the homeowner to a free inspection*, not as adjuster-ready documentation.
6. **Don't bury notifications reps can't control.** HailRecon's "can't turn off daily hail % notifications" is a real churn driver. Make any weather alerts opt-in and granular.
7. **Don't repeat the geocoding/pin-accuracy failure in new subdivisions.** SalesRabbit's pins "conglomerate" in new builds — likely a geocoder limitation. ARX already uses the US Census geocoder for enrichment; verify behavior in new construction and prefer the rep's actual dropped pin lat/lng (and `rep_lat/lng`) over geocoded address centroids when they disagree.
8. **Don't make dispositions/pins disappear unless zoomed way in (from Terros).** A top Terros complaint is that dispositions are only visible at a small zoom radius, making the disposition *filter* "useless unless you're zoomed in." When the weather overlay is on, ARX must keep pins and their disposition state legible at the zoom level reps actually pan a neighborhood at — cluster, don't hide.
9. **Don't ship a canvass map with no activity log / no history (from Terros).** Reps explicitly want to review "who I pitched a week or two ago." ARX already has the lead lifecycle and workflow history server-side — make sure the canvass map surfaces past activity, not only what's near the rep right now.
10. **Don't let field reliability slip — freezing/inconsistent logging is universal.** Terros joins SalesRabbit/SPOTIO/HailRecon in being dinged for freezing in the field and dropped/incorrectly-recorded knocks. ARX's offline Zustand+IndexedDB queue is the right defense; confirm knock/pitch geo-capture writes survive flaky connectivity, since "it didn't record the address" is a recurring trust-killer across every product here.

---

## Where ARX's free-data approach is competitive vs where it will fall short

**Where free NOAA/SPC/MRMS genuinely competes:**

- **The data inputs are the same.** HailTrace's own materials describe their maps as NOAA-radar-derived plus NWS reports — the exact public sources ARX already pulls. ARX is not fighting from a data deficit; it's fighting from a *processing/polish* deficit. [Confirmed for inputs; the proprietary pipeline is unverified.]
- **Phase 1 (NWS warning polygons + SPC point reports) is a real, shippable overlay** that covers the two most common rep questions: "is a storm rolling through now?" (NWS Alerts polygons) and "did this area get hit recently and how hard?" (SPC points with size/date). That's competitive with SalesRabbit's basic Storm Finder for *targeting purposes*, at zero data cost.
- **Unified canvass + weather in one app** beats the dominant market pattern of stitching a canvassing vendor to a separate HailTrace subscription. No daily-import seam, no second login, no second bill.
- **Cost.** Competitors run $19–31/user/mo + HailTrace tiers (opaque, ~$230/map à la carte). ARX's marginal data cost is ~$0. For an owner-operated shop scaling to 30 reps, that's a structural advantage.

**Where the free approach will fall short of the paid tools:**

- **True hail swaths require real engineering, not a passthrough fetch.** SPC points are *points*, not the continuous "hail path painted on the map" experience reps see in HailTrace/HailRecon. ARX only matches that look after **Phase 2 MRMS MESH** — fetch recent MESH, contour it to GeoJSON, cache it on a schedule. Until Phase 2 ships, ARX's overlay will look thinner than the swath products. [Confirmed in the design doc: MESH is the tier that delivers the swath vision and it needs a pipeline.]
- **No meteorologist QA layer = more false positives.** HailTrace's paid moat is humans filtering bad radar estimates. ARX's raw MESH/SPC data will include false positives reps may chase. Mitigate with conservative size thresholds, a "this is an estimate" UI label, and rep training — but accept that targeting precision will trail meteorologist-reviewed products.
- **No insurance-grade certification.** ARX cannot produce Verisk/Forensic-Meteorologist-certified reports adjusters treat as authoritative. For shops whose whole pitch is adjuster-ready documentation, the paid tools remain ahead. ARX's lane is *targeting + door-level credibility + free inspection*, not claims documentation.
- **Rural coverage gaps and refresh latency.** SPC reports are sparse where no one reported; a daily batch refresh won't beat HailTrace's near-real-time alerts for same-day storm chasing. For ARX's residential storm/insurance model this is an acceptable trade, but it is a real gap to name.

**Honest bottom line [Inference]:** ARX's free approach can absolutely compete on **targeting and cost** — and it's *better* on **integration** because canvass + weather live in one app instead of two stitched vendors. It will **not** match HailTrace/SalesRabbit-Verisk on **swath polish (until Phase 2), false-positive filtering, and insurance-grade certification.** The right strategy is to compete where the free data is genuinely equivalent (find the hot neighborhoods, get the inspection) and *not* to market against the paid tools on claims-grade documentation, which ARX can't credibly back.

---

## Sources

- SalesRabbit Weather (rendered): https://salesrabbit.com/weather/
- SalesRabbit Weather/Storm Finder help (JS shell, empty on fetch — relied on snippets): https://help.salesrabbit.com/hc/en-us/articles/7125742748183-Weather-Map-Overlays-Storm-Finder
- SalesRabbit HailTrace integration overview (daily 6am MST import): https://help.salesrabbit.com/hc/en-us/articles/13399566660631-HailTrace-Overview
- SalesRabbit HailTrace integration page: https://salesrabbit.com/integrations/hailtrace/
- SalesRabbit storm-damage page: https://salesrabbit.com/storm-damage/
- SalesRabbit reviews (Capterra): https://www.capterra.com/p/157329/Sales-Rabbit/reviews/
- SalesRabbit pros/cons (Map My Customers): https://mapmycustomers.com/salesrabbit-pros-cons/
- SalesRabbit problems/crashes (JustUseApp): https://justuseapp.com/en/app/879884387/salesrabbit-lead-canvass-crm/problems
- SPOTIO HailTrace integration: https://spotio.com/integrations/hailtrace/
- SPOTIO storm territory management: https://spotio.com/blog/storm-territory-management/
- SPOTIO sales intelligence / data layers: https://spotio.com/features/sales-intelligence/
- Roofing Software Guide roundup (SPOTIO vs SalesRabbit vs HailTrace; pricing, complaints): https://roofingsoftwareguide.com/roundups/best-roofing-canvassing-apps/
- HailTrace home / hail maps: https://hailtrace.com/ and https://hailtrace.com/hail-maps
- HailTrace meteorologist review: https://hailtrace.com/hail-reports/meteorologist-reviewed
- HailTrace plans (opaque pricing): https://hailtrace.com/plans
- HailTrace blog — why NOAA reports alone aren't enough (data-source detail): https://blog.hailtrace.com/hail-reports-for-today/
- Interactive Hail Maps / HailRecon: https://www.interactivehailmaps.com/hail-recon/ and https://www.interactivehailmaps.com/frequently-asked-questions/
- HailRecon reviews (JustUseApp): https://justuseapp.com/en/app/602877045/hail-recon/reviews
- HailTrace vs Hail Recon (ProLine): https://useproline.com/hailtrace-vs-hail-recon-which-app-wins-for-roofers/
- AccuLynx — making hail apps work better (estimate vs actual damage, data gaps): https://acculynx.com/making-hail-apps-work-better-for-insurance-restoration-contractors/
- Radar hail-estimate accuracy / false positives (peer-reviewed, AMT): https://amt.copernicus.org/articles/17/407/2024/
- KnockBase HailTrace integration: https://www.knockbase.com/features/hailtrace-integration
- Sunbase roofing software: https://www.sunbasedata.com/roofing-software
- SPOTIO roofing software roundup (Roofr/JobNimbus/etc.): https://spotio.com/blog/roofing-software/
- Terros marketing site (features, customers, FAQ; Webflow page rendered fine): https://www.terros.com/ and https://www.terros.com/about
- Terros App Store listing (4.3/70 ratings, reviews, version history 0.77.0, Canvass Pro/Max IAP pricing): https://apps.apple.com/us/app/terros/id6444381162
- Terros Recorder (companion pitch-recording app): https://apps.apple.com/us/app/terros-recorder/id6747404555
- Terros on Google Play (Android complaints): https://play.google.com/store/apps/details?id=com.tantalim.mobile&hl=en_US
- Terros Help Center — Pins / Canvass tab (dispositions, tags, multi-accounts, custom pins): https://help.terros.com/en/collections/17685328-pins
- ConveYour "Top 15 Canvassing Apps 2025" — Terros section (Statra→Terros 2024 rebrand, AI tasks, solar focus, no public pricing): https://conveyour.com/blog/top-15-canvassing-apps-to-boost-your-door-to-door-sales-in-2025

*Reminder: every pricing figure above is flagged may-be-outdated and quote-based for most vendors; do not assert any price as current fact without re-verifying.*
