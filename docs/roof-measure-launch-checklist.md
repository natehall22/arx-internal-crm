# Roof measure — launch checklist (human QA)

## Related docs

| Doc | Purpose |
|-----|---------|
| [roof-measure-README.md](./roof-measure-README.md) | Quick start, commands, architecture |
| [roof-measure-launch-prompt.md](./roof-measure-launch-prompt.md) | Multi-agent launch orchestration |
| [roof-measure-launch-checklist.md](./roof-measure-launch-checklist.md) | Human QA before prod |
| [roof-measure-accuracy-report.md](./roof-measure-accuracy-report.md) | Calibration & prelaunch gate |
| [roof-measure-qa-TEMPLATE.md](./roof-measure-qa-TEMPLATE.md) | Browser QA report template |
| [roof-measurement-providers.md](./roof-measurement-providers.md) | Aurora / Solo / Google vs ARX |


Complete after `npm run roof-measure:prelaunch` passes.

## Automated (required before deploy)

- [ ] `npm run roof-measure:prelaunch`
- [ ] `npm run build` (full app)

## Browser — `/tools/roof-measure`

### Load & draw

- [ ] Search address → map loads satellite
- [ ] **Load roof (Google Solar)** returns section outlines (not only boxes)
- [ ] Each section shows **Facing** (degrees) when Solar provided it
- [ ] **Choose roof pitch** on every section; save blocked until done
- [ ] **Looks good ✓** on auto-loaded sections before save

### Linear LF

- [ ] 2-facet gable: ridge LF ≈ shared top edge (not 0)
- [ ] Complex roof: hips LF > 0 when hip planes drawn
- [ ] **Draw ridge** line → ridge LF uses manual total
- [ ] **Draw valley** line → adds to valley LF

### Save → proposal

- [ ] Save → redirects to proposal builder with `measurement_id`
- [ ] Builder shows **ridge cap** / **hip cap** line items when ridge/hip LF > 0
- [ ] Waste % increases on hip-heavy vs simple gable (sidebar shows %)

### Regression

- [ ] No console errors on happy path
- [ ] Overlap warning when sections exceed Solar footprint ~8%+

## Sign-off

| Role | Name | Date |
|------|------|------|
| Engineering | | |
| Ops / production | | |
