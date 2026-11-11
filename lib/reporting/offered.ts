/** What reports this viewer is offered (GET /api/reports/run and the AI connector's run_report both ask here). */
import { DATASETS } from '@/lib/reporting/catalog'
import { datasetOffered, type ReportContext } from '@/lib/reporting/run'
import { REPORT_TEMPLATES, specTouchesFinancials } from '@/lib/reporting/templates'

/** Dataset definitions the viewer may use (finance-only columns/datasets removed, switched-off features hidden). */
export function offeredDatasets(ctx: ReportContext) {
  return Object.values(DATASETS)
    .filter((d) => datasetOffered(ctx, d.key))
    .filter((d) => ctx.finance || (!d.financeOnly && (d.ownerColumn || ctx.scope === 'all')))
}

/** Starter templates the viewer may run: no finance for people without it, only offered datasets, the profile's starter set. */
export function offeredTemplates(ctx: ReportContext) {
  const allowed = new Set(offeredDatasets(ctx).map((d) => d.key))
  const starter = ctx.starterReports ? new Set(ctx.starterReports) : null
  return REPORT_TEMPLATES.filter((t) => (ctx.finance || !specTouchesFinancials(t.spec, ctx.scope)) && allowed.has(t.spec.dataset) && (!starter || starter.has(t.key)))
}
