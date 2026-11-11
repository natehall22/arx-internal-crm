import { z } from 'zod'

import { wrapUntrusted } from '@/lib/ai-connector/untrusted'
import { cleanQuery, runSearch, type SearchKind } from '@/lib/global-search'
import { searchGroupsForCaller } from '@/lib/global-search-server'
import { ownCustomerIds } from '@/lib/ai-connector/tools/contact-scope'
import { ToolError, type McpTool, type ToolContext } from '@/lib/ai-connector/tools/types'

const schema = z.object({ query: z.string().min(2).max(80) }).strict()

async function find(ctx: ToolContext, kind: SearchKind, query: string) {
  const q = cleanQuery(query)
  if (!q) throw new ToolError('bad_input', 'Type at least 2 characters (up to 80).')
  // The same groups the in-app search uses: a person only finds what their own search would show them.
  const groups = (await searchGroupsForCaller(ctx.admin, ctx.userId, ctx.profile))
    .map((g) => ({ ...g, kinds: g.kinds.filter((k) => k === kind) }))
    .filter((g) => g.kinds.length > 0)
  if (groups.length === 0) return { data: { results: [] }, recordIds: [] as string[] }
  let hits = await runSearch(ctx.admin, ctx.orgId, q, groups, 10)
  if (kind === 'customer') {
    // Setters / canvassers: only customers that are their own work (a hit on someone else's would reveal their phone or email).
    const own = await ownCustomerIds(ctx, hits.map((h) => h.id))
    if (own) hits = hits.filter((h) => own.has(h.id))
  }
  return {
    data: { results: hits.map((h) => ({ id: h.id, title: wrapUntrusted(h.title, 200), detail: wrapUntrusted(h.subtitle, 300) })) },
    recordIds: hits.map((h) => h.id),
  }
}

export const findCustomer: McpTool = {
  name: 'find_customer',
  title: 'Find a customer',
  description: 'Search customers by name, phone, email or address. Returns up to 10 matches with their ids; use get_customer for details.',
  inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 80, description: 'Name, phone number, email or street address' } }, required: ['query'], additionalProperties: false },
  schema,
  readOnly: true,
  run: (ctx, args: z.infer<typeof schema>) => find(ctx, 'customer', args.query),
}

export const findJob: McpTool = {
  name: 'find_job',
  title: 'Find a job',
  description: 'Search jobs by job number, customer name or address. Returns up to 10 matches with their ids; use get_job_summary for details.',
  inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 80, description: 'Job number, customer name or street address' } }, required: ['query'], additionalProperties: false },
  schema,
  readOnly: true,
  run: (ctx, args: z.infer<typeof schema>) => find(ctx, 'job', args.query),
}
