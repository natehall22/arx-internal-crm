import { z } from 'zod'

import { wrapUntrusted } from '@/lib/ai-connector/untrusted'
import { addDaysYmd, daysBetweenYmd, isYmd } from '@/lib/service-plans'
import { loadVisitsPage } from '@/lib/service-plans-db'
import { resolveServicePlanAccess } from '@/lib/service-plans-access'
import { isSuperAdmin } from '@/lib/super-admin'
import { resolveThreadViewer } from '@/lib/threads/viewer'
import { isFieldRole } from '@/lib/threads/visibility'
import { ToolError, type McpTool } from '@/lib/ai-connector/tools/types'

const schema = z.object({ from: z.string().refine(isYmd), to: z.string().refine(isYmd).optional() }).strict()

export const listVisits: McpTool = {
  name: 'list_visits',
  title: 'List service visits',
  description: 'Recurring-service visits (mowing, cleaning, care plans) on the days from..to (YYYY-MM-DD; default one week; at most 9 weeks). Up to 100 visits. Gate codes are never included. Reading never creates visits.',
  inputSchema: {
    type: 'object',
    properties: { from: { type: 'string', description: 'First day, YYYY-MM-DD' }, to: { type: 'string', description: 'Last day, YYYY-MM-DD (default: from + 6 days)' } },
    required: ['from'],
    additionalProperties: false,
  },
  schema,
  readOnly: true,
  async run(ctx, args: z.infer<typeof schema>) {
    const access = await resolveServicePlanAccess(ctx.admin, ctx.userId, ctx.profile)
    const viewer = await resolveThreadViewer(ctx.admin, ctx.profile)
    // Same door as the Visits screen: the company has service plans on, and the person is on the job board (owner always); never a field role.
    if (!access.feature || isFieldRole(viewer) || !(access.view || isSuperAdmin(ctx.profile))) throw new ToolError('denied')
    const to = args.to ?? addDaysYmd(args.from, 6)
    if (to < args.from || daysBetweenYmd(args.from, to) > 62) throw new ToolError('bad_input', 'Pick up to 9 weeks.')
    const page = await loadVisitsPage(ctx.admin, ctx.orgId, { from: args.from, to, accessNotes: false, limit: 100 })
    return {
      data: {
        total: page.total,
        visits: page.visits.map((v) => ({
          id: v.id,
          number: v.workOrderNumber,
          date: v.scheduledDate,
          status: v.status,
          plan: wrapUntrusted(v.planName, 120),
          trade: v.trade,
          step: v.stepLabel ?? v.step,
          customer_id: v.customerId,
          customer: wrapUntrusted(v.customerName, 200),
          address: wrapUntrusted(v.address, 300),
          crew: wrapUntrusted(v.subName, 120),
          skip_reason: wrapUntrusted(v.skipReason, 300),
          notes: wrapUntrusted(v.notes, 500),
        })),
      },
      recordIds: page.visits.map((v) => v.id),
    }
  },
}
