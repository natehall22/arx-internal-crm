import { z } from 'zod'

import { wrapUntrusted } from '@/lib/ai-connector/untrusted'
import { resolveOpsAccess } from '@/lib/ops-access'
import { orgDb } from '@/lib/supabase/org-db'
import { resolveThreadViewer } from '@/lib/threads/viewer'
import { isFieldRole } from '@/lib/threads/visibility'
import { ID, ToolError, type McpTool, type ToolContext } from '@/lib/ai-connector/tools/types'

/** Job board access, never for field roles — the same doors as the Jobs pages. */
async function jobAccess(ctx: ToolContext) {
  const [ops, viewer] = await Promise.all([resolveOpsAccess(ctx.admin, ctx.userId, ctx.profile), resolveThreadViewer(ctx.admin, ctx.profile)])
  if (!ops.canJobBoard || isFieldRole(viewer)) throw new ToolError('denied')
  return ops
}

const summarySchema = z.object({ job_id: z.string().regex(ID) }).strict()

export const getJobSummary: McpTool = {
  name: 'get_job_summary',
  title: 'Get a job summary',
  description: 'One job: number, status, address, customer, dates and crews. The sale amount is included only for people who may see job money.',
  inputSchema: { type: 'object', properties: { job_id: { type: 'string', description: 'Job id from find_job' } }, required: ['job_id'], additionalProperties: false },
  schema: summarySchema,
  readOnly: true,
  async run(ctx, args: z.infer<typeof summarySchema>) {
    const ops = await jobAccess(ctx)
    const db = orgDb(ctx.admin, ctx.orgId)
    const { data: job } = await db.from('production_jobs').select('id, job_number, status, customer_id, address_text, scheduled_date, sale_date, completed_at, materials_status, sale_amount').eq('id', args.job_id).maybeSingle()
    if (!job) throw new ToolError('not_found')
    const j = job as Record<string, unknown>
    let customerName: string | null = null
    if (typeof j.customer_id === 'string') {
      const { data: c } = await db.from('customers').select('name').eq('id', j.customer_id).maybeSingle()
      customerName = (c as { name?: string | null } | null)?.name ?? null
    }
    const { data: wos } = await db.from('work_orders').select('id, trade, status, scheduled_date, work_order_type').eq('job_id', args.job_id).neq('work_order_type', 'service_visit').order('scheduled_date').limit(20)
    return {
      data: {
        job: {
          id: j.id,
          job_number: j.job_number,
          status: j.status,
          customer_id: j.customer_id ?? null,
          customer_name: wrapUntrusted(customerName, 200),
          address: wrapUntrusted(j.address_text, 300),
          scheduled_date: j.scheduled_date ?? null,
          sale_date: j.sale_date ?? null,
          completed_at: j.completed_at ?? null,
          materials_status: j.materials_status ?? null,
          ...(ops.canViewJobFinancials ? { sale_amount: j.sale_amount ?? null } : {}),
        },
        crews: ((wos ?? []) as Array<Record<string, unknown>>).map((w) => ({ id: w.id, trade: w.trade, status: w.status, scheduled_date: w.scheduled_date })),
      },
      recordIds: [args.job_id],
    }
  },
}

const scheduleSchema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict()

export const listSchedule: McpTool = {
  name: 'list_schedule',
  title: 'List the install schedule',
  description: 'Jobs scheduled for install between two dates (YYYY-MM-DD, at most 62 days apart), earliest first. Up to 100 jobs.',
  inputSchema: {
    type: 'object',
    properties: { from: { type: 'string', description: 'First day, YYYY-MM-DD' }, to: { type: 'string', description: 'Last day, YYYY-MM-DD' } },
    required: ['from', 'to'],
    additionalProperties: false,
  },
  schema: scheduleSchema,
  readOnly: true,
  async run(ctx, args: z.infer<typeof scheduleSchema>) {
    await jobAccess(ctx)
    const days = (Date.parse(args.to) - Date.parse(args.from)) / 86_400_000
    if (!Number.isFinite(days) || days < 0 || days > 62) throw new ToolError('bad_input', 'Pick a range of up to 62 days.')
    const { data } = await orgDb(ctx.admin, ctx.orgId)
      .from('production_jobs')
      .select('id, job_number, status, address_text, scheduled_date')
      .gte('scheduled_date', args.from)
      .lte('scheduled_date', args.to)
      .neq('status', 'cancelled')
      .order('scheduled_date')
      .limit(100)
    const rows = (data ?? []) as Array<Record<string, unknown>>
    return { data: { jobs: rows.map((r) => ({ id: r.id, job_number: r.job_number, status: r.status, scheduled_date: r.scheduled_date, address: wrapUntrusted(r.address_text, 300) })) }, recordIds: rows.map((r) => String(r.id)) }
  },
}
