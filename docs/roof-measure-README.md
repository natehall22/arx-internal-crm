# Roof measure tool

Internal tool: `/tools/roof-measure`

## Quick commands

```bash
npm run roof-measure:prelaunch   # launch gate (tsc + tests + classify golden)
npm run roof-measure:classify    # edge LF regression only
npm run dev                    # then open /tools/roof-measure
```

## How measurement works

1. **Faces** — one polygon = one roof plane; pitch confirmed manually; **facing** from Google Solar when available.
2. **Edges** — `lib/roof-measure-edge-classification.ts` infers ridge/hip/valley/eave/rake from shared 2D edges.
3. **Overrides** — drawn ridge lines replace geometric ridge LF; valleys add to geometric valleys.
4. **Downstream** — save → `roof_measurements` → proposal builder (waste %, cap bundles).

## Docs

| Doc | Purpose |
|-----|---------|
| [roof-measurement-providers.md](./roof-measurement-providers.md) | Aurora / Solo / Google vs ARX |
| [roof-measure-accuracy-report.md](./roof-measure-accuracy-report.md) | Calibration & thresholds |
| [roof-measure-launch-checklist.md](./roof-measure-launch-checklist.md) | Human QA before prod |
| [roof-measure-launch-prompt.md](./roof-measure-launch-prompt.md) | Multi-agent launch orchestration |
| [roof-measure-qa-TEMPLATE.md](./roof-measure-qa-TEMPLATE.md) | Browser QA report (copy per run) |

## Launch

Do not deploy without:

1. `npm run roof-measure:prelaunch`
2. `npm run build`
3. Completed launch checklist in browser

## Key libraries

| Module | Role |
|--------|------|
| `lib/roof-measure-edge-classification.ts` | Ridge/hip/valley/eave/rake LF from 2D facets |
| `lib/roof-face-solar-alignment.ts` | Facing azimuth & pitch from Solar segments |
| `lib/aurora-roof-summary-mapper.ts` | Aurora-style summary mapping (future import) |
| `lib/solar-roof-mask-facets.ts` | Solar mask → facet polygons |

## Tests & scripts

- `npm run roof-measure:prelaunch` — `scripts/roof-measure-prelaunch.ts`
- `npm run roof-measure:classify` — `scripts/roof-measure-classify-eval.ts`
- Jest: `lib/__tests__/roof-measure*.test.ts`, `roof-edge-golden.test.ts`

