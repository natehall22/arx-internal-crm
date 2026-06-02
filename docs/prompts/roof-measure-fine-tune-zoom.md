# Roof measure: fine-tune zoom (Aurora-style vertex editing)

**Problem:** Overlapping roof sections are hard to fix because standard Google Maps satellite zoom is too coarse to grab vertex handles precisely.

**Reference:** Aurora uses **Google Maps HD** (0.1 m/px Solar RGB) as a display layer while vertices stay in WGS84.

---

## What shipped (2026-06-01)

| Change | File | Collateral risk |
|--------|------|-----------------|
| Edit zoom target **22** (was floor 21), `MaxZoomService` per property | `page.tsx`, `lib/roof-measure-map-zoom.ts` | **Low** — viewport only; saved geometry is lat/lng |
| **Fine-tune edges (HD)** full-screen canvas with virtual zoom up to **12×** on Solar RGB | `components/RoofFineTuneEditor.tsx`, `lib/georef-bounds.ts` | **Low** — writes lat/lng back to map polygon; blocks detect while open |
| **Zoom map to section** (main map fitBounds) | `page.tsx` | **Low** |
| **HD** toggle — Solar `rgbUrl` GeoTIFF as `GroundOverlay` | `lib/solar-rgb-overlay.ts`, `/api/ai/solar-rgb-overlay` | **Low** — display-only |
| Auto-detect key uses **rounded zoom** | `page.tsx` | **Low** — prevents fractional scroll re-firing detect |
| `fetchSolarDataLayerUrls` returns `rgbUrl` | `lib/solar-dsm.ts` | **None** — additive field |

**Untouched (intentionally):** `detect-roof` mask georef, `clampVisionAlignStaticZoom`, save validation, pitch gates.

---

## Agent kickoff (collateral-safe follow-ups)

```
You are improving ARX roof measure vertex fine-tuning. Read docs/prompts/roof-measure-fine-tune-zoom.md first.

Rules:
- Polygon vertex math stays WGS84 on the base map — never tie save/detect geometry to HD overlay pixels.
- Do NOT change detect-roof zoom caps unless vision trace is re-enabled (ROOF_MEASURE_VISION_TRACE_ENABLED).
- Do NOT change measurements API save gates (pitch, geometry_reviewed, solar_bbox block).
- Test: npm test -- lib/__tests__/roof-measure && npm run roof-measure:prelaunch

Safe follow-ups:
- Keyboard arrow nudge for selected vertex (small lat/lng delta)
- Re-fetch HD overlay when map center moves >50m (rgbUrl expires ~1h)
- Auto-enable HD when user clicks Fine-tune zoom (if overlay 404, fall back silently)

Verify on prod:
- 624 Seldon Dr (overlap case from QA) — Fine-tune zoom + HD lets user separate sections 7/8
- Concord + Greenway regression — detect overlays still appear after address search
```

---

## QA checklist

- [ ] Address search still auto-detects solar outline
- [ ] Saved measurement reload redraws polygons
- [ ] Fine-tune zoom on section 7/8 separates overlapping vertices visually
- [ ] HD toggle shows sharper imagery; toggle off restores standard satellite
- [ ] Save still blocks overlapping sections until fixed (validation unchanged)
- [ ] No console errors on HD 404 (location without Solar RGB)
