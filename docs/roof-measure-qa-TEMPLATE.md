# Roof measure QA report

## Related docs

| Doc | Purpose |
|-----|---------|
| [roof-measure-README.md](./roof-measure-README.md) | Quick start, commands, architecture |
| [roof-measure-launch-prompt.md](./roof-measure-launch-prompt.md) | Multi-agent launch orchestration |
| [roof-measure-launch-checklist.md](./roof-measure-launch-checklist.md) | Human QA before prod |
| [roof-measure-accuracy-report.md](./roof-measure-accuracy-report.md) | Calibration & prelaunch gate |
| [roof-measure-qa-TEMPLATE.md](./roof-measure-qa-TEMPLATE.md) | Browser QA report template |
| [roof-measurement-providers.md](./roof-measurement-providers.md) | Aurora / Solo / Google vs ARX |


**Date:**  
**Tester:**  
**Build / branch:**  
**Prelaunch:** `npm run roof-measure:prelaunch` → PASS / FAIL

## Checklist results

| Item | Pass | Notes |
|------|------|-------|
| Map loads | | |
| Solar load facets | | |
| Facing shown | | |
| Pitch on all sections | | |
| Ridge LF > 0 (gable) | | |
| Hip LF (complex) | | |
| Manual ridge override | | |
| Save → builder | | |
| Cap line items | | |

## Blockers

- 

## Sign-off recommendation

- [ ] Ready for production
- [ ] Ready with documented limitations
- [ ] Not ready
