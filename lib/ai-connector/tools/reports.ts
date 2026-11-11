import { z } from 'zod'

import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { canAccessReportsFromPermissionNames } from '@/lib/permissions'
import { offeredTemplates } from '@/lib/reporting/offered'
import { buildReportContext, ReportAccessError, runReport } from '@/lib/reporting/run'
import { parseSpec } from '@/lib/reporting/report-spec'
import { ToolError, type McpTool, type ToolContext } from '@/lib/ai-connector/tools/types'

async function reportContext(ctx: ToolContext) {
  const perms = await resolveEffectivePermissionNames(ctx.admin, ctx.userId, ctx.profile)
  if (!canAccessReportsFromPermissionNames(perms)) throw new ToolError('denied')
  return buildReportContext(ctx.admin, ctx.profile)
}

export const listReports: McpTool = {
  name: 'list_reports',
  title: 'List the reports you can run',
  description: 'The ready-made reports this person is allowed to run (name, what it shows). Use run_report with a name from this list.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  schema: z.object({}).strict(),
  readOnly: true,
  async run(ctx) {
    const rctx = await reportContext(ctx)
    return { data: { reports: offeredTemplates(rctx).map((t) => ({ name: t.key, title: t.title, about: t.blurb })) } }
  },
}

const runSchema = z.object({ name: z.string().min(1).max(80) }).strict()

export const runReportTool: McpTool = {
  name: 'run_report',
  title: 'Run a report',
  description: 'Run one ready-made report by name (see list_reports). Up to 50 rows. Only reports this person may see; money reports need the financials permission. Custom reports are not available.',
  inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Report name from list_reports' } }, required: ['name'], additionalProperties: false },
  schema: runSchema,
  readOnly: true,
  async run(ctx, args: z.infer<typeof runSchema>) {
    const rctx = await reportContext(ctx)
    // Allow-list: only the starter templates the viewer is offered. A free-form report spec is never accepted.
    const tpl = offeredTemplates(rctx).find((t) => t.key === args.name)
    if (!tpl) throw new ToolError('not_found', 'No such report for you. Use list_reports.')
    const parsed = parseSpec(tpl.spec)
    if (!parsed.ok) throw new ToolError('unavailable')
    try {
      const result = await runReport(ctx.admin, rctx, parsed.spec)
      return {
        data: {
          report: tpl.title,
          columns: result.columns.map((c) => ({ key: c.key, label: c.label })),
          rows: result.rows.slice(0, 50),
          matched: result.matched,
          truncated: result.truncated || result.rows.length > 50,
          summary: result.summary,
        },
      }
    } catch (e) {
      if (e instanceof ReportAccessError) throw new ToolError('denied')
      throw e
    }
  },
}
