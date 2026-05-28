# Roof measure

**Where:** CRM → **Roof measure** (`/tools/roof-measure`)

## Start here

| I need to… | Open |
|------------|------|
| Understand what we're building and how people use it | [roof-measure-in-house-capability-prompt.md](./roof-measure-in-house-capability-prompt.md) |
| Sign off before production (browser) | [roof-measure-launch-checklist.md](./roof-measure-launch-checklist.md) |
| See test results / % error | [roof-measure-accuracy-report.md](./roof-measure-accuracy-report.md) |
| Why 2D draw ≠ Aurora 3D | [roof-measurement-providers.md](./roof-measurement-providers.md) |

**In-house only:** Google Solar on the map. No EagleView, Roofr, or Aurora software **in roof measure**. Names like “EagleView” in test JSON = a past report’s LF used as a **benchmark**, not an integration. (Admin → Integrations may list vendors for other CRM flows.)

## Quick path (operator)

1. Address on map → **Reload outline from satellite** if needed (often auto-loads on search)  
2. **Choose roof pitch** manually on every section → **Looks good ✓** on each (required before save succeeds)  
3. Check ridge/hip LF and waste → **Save** → proposal builder  

## Quick path (developer)

```bash
npm run roof-measure:prelaunch
npm run dev
# open /tools/roof-measure
```

## Under the hood (when you need file names)

- **Sections & pitch:** `app/tools/roof-measure/page.tsx`  
- **Ridge/hip/valley LF:** `lib/roof-measure-edge-classification.ts`  
- **Facing from Solar:** `lib/roof-face-solar-alignment.ts`  
- **Solar outlines:** `app/api/ai/detect-roof`, `lib/solar-roof-mask-facets.ts`  
- **After save:** proposal builder reads `ridges_lf`, `hips_lf`, valleys, waste, caps  
