import { z } from 'zod'

import { wrapUntrusted } from '@/lib/ai-connector/untrusted'
import { loadCustomerForCaller } from '@/lib/customer-file/customer-read'
import { resolveCustomerAccess } from '@/lib/customer-file/customer-access'
import { loadCustomerProperties } from '@/lib/properties-db'
import { orgDb } from '@/lib/supabase/org-db'
import { resolveThreadViewer } from '@/lib/threads/viewer'
import { isFieldRole } from '@/lib/threads/visibility'
import { ID, ToolError, type McpTool } from '@/lib/ai-connector/tools/types'

const schema = z.object({ customer_id: z.string().regex(ID) }).strict()

export const getCustomer: McpTool = {
  name: 'get_customer',
  title: 'Get a customer',
  description: 'One customer: contact details, properties (addresses) and their jobs. Gate codes and access notes are never included.',
  inputSchema: { type: 'object', properties: { customer_id: { type: 'string', description: 'Customer id from find_customer' } }, required: ['customer_id'], additionalProperties: false },
  schema,
  readOnly: true,
  async run(ctx, args: z.infer<typeof schema>) {
    // Same rule as the customer page API: customer-records access, and reps only see customers they own a deal or project for.
    const read = await loadCustomerForCaller(ctx.admin, ctx.profile, args.customer_id)
    if (!read.ok) throw new ToolError('not_found')
    const c = read.customer as Record<string, unknown>
    const viewer = await resolveThreadViewer(ctx.admin, ctx.profile)
    const access = await resolveCustomerAccess(ctx.admin, viewer, args.customer_id)
    const props = access?.read ? await loadCustomerProperties(ctx.admin, ctx.orgId, args.customer_id, { accessNotes: false }) : { ready: false, properties: [] }

    // Jobs are production data: job-board people only, never field roles (setters, canvassers, inside sales).
    let jobs: Array<Record<string, unknown>> = []
    if (viewer.jobBoard && !isFieldRole(viewer)) {
      const { data } = await orgDb(ctx.admin, ctx.orgId).from('production_jobs').select('id, job_number, status, scheduled_date').eq('customer_id', args.customer_id).order('created_at', { ascending: false }).limit(20)
      jobs = (data ?? []) as Array<Record<string, unknown>>
    }
    return {
      data: {
        customer: {
          id: c.id,
          name: wrapUntrusted(c.name, 200),
          email: c.email ?? null,
          phone: c.phone ?? null,
          address: wrapUntrusted(c.address_text, 300),
          created_at: c.created_at ?? null,
        },
        properties: props.properties.slice(0, 20).map((p) => ({ id: p.id, label: wrapUntrusted(p.label, 80), address: wrapUntrusted(p.address_text, 300) })),
        jobs,
      },
      recordIds: [args.customer_id, ...jobs.map((j) => String(j.id))],
    }
  },
}
