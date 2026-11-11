import { z } from 'zod'

import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { computeInvoiceBalance, getInvoicesForJob } from '@/lib/invoices'
import { loadCustomerServiceInvoices } from '@/lib/service-billing-db'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { orgDb } from '@/lib/supabase/org-db'
import { resolveCustomerAccess } from '@/lib/customer-file/customer-access'
import { resolveThreadViewer } from '@/lib/threads/viewer'
import { isFieldRole } from '@/lib/threads/visibility'
import { ID, ToolError, type McpTool } from '@/lib/ai-connector/tools/types'

const schema = z.object({ job_id: z.string().regex(ID).optional(), customer_id: z.string().regex(ID).optional() }).strict().refine((a) => !!a.job_id !== !!a.customer_id, { message: 'Give either job_id or customer_id' })

type InvoiceLike = { id: string; invoice_number: string; status: string; invoice_kind?: string | null; total_cents: number; tax_cents?: number | null; issued_at?: string | null; due_at?: string | null; created_at: string; applied_cents?: number; balance_cents?: number }

const view = (i: InvoiceLike, paid: number, balance: number) => ({
  id: i.id,
  number: i.invoice_number,
  status: i.status,
  kind: i.invoice_kind ?? null,
  total: i.total_cents / 100,
  tax: (i.tax_cents ?? 0) / 100,
  paid: paid / 100,
  balance: balance / 100,
  issued: i.issued_at ?? null,
  due: i.due_at ?? null,
})

export const listInvoices: McpTool = {
  name: 'list_invoices',
  title: 'List invoices',
  description: 'Invoices for one job (job_id) or one customer (customer_id): number, status, total, paid and balance, in dollars. Only for people who record job money.',
  inputSchema: {
    type: 'object',
    properties: { job_id: { type: 'string', description: 'Job id (from find_job)' }, customer_id: { type: 'string', description: 'Customer id (from find_customer)' } },
    additionalProperties: false,
    description: 'Give exactly one of job_id or customer_id.',
  },
  schema,
  readOnly: true,
  async run(ctx, args: z.infer<typeof schema>) {
    // The money door: the same check the invoice screens use, and field roles never, whatever they were granted.
    const viewer = await resolveThreadViewer(ctx.admin, ctx.profile)
    if (isFieldRole(viewer) || !(await callerCanAccessJobBilling(ctx.admin, ctx.profile))) throw new ToolError('denied')
    const db = orgDb(ctx.admin, ctx.orgId)
    const out: ReturnType<typeof view>[] = []

    if (args.job_id) {
      const { data: job } = await db.from('production_jobs').select('id').eq('id', args.job_id).maybeSingle()
      if (!job) throw new ToolError('not_found')
      const invoices = (await getInvoicesForJob(ctx.admin, args.job_id)).slice(0, 25)
      for (const i of invoices) {
        const b = await computeInvoiceBalance(ctx.admin, i.id)
        out.push(view(i, b.applied_cents, b.balance_cents))
      }
    } else if (args.customer_id) {
      const access = await resolveCustomerAccess(ctx.admin, viewer, args.customer_id)
      if (!access?.read) throw new ToolError('not_found')
      // Invoices without a job exist only for companies with service plans on; the list is empty before that.
      if (await isOrgFeatureOn(ctx.orgId, 'servicePlans')) {
        const invoices = (await loadCustomerServiceInvoices(ctx.admin, ctx.orgId, args.customer_id)) ?? []
        for (const i of invoices.slice(0, 25)) out.push(view(i, i.applied_cents, i.balance_cents))
      }
      const { data: jobs } = await db.from('production_jobs').select('id').eq('customer_id', args.customer_id).limit(10)
      for (const j of (jobs ?? []) as Array<{ id: string }>) {
        for (const i of (await getInvoicesForJob(ctx.admin, j.id)).slice(0, 10)) {
          const b = await computeInvoiceBalance(ctx.admin, i.id)
          out.push(view(i, b.applied_cents, b.balance_cents))
        }
      }
    }
    return { data: { invoices: out.slice(0, 50) }, recordIds: out.slice(0, 50).map((i) => i.id) }
  },
}
