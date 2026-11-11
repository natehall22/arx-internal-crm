import { z } from 'zod'

import { wrapUntrusted } from '@/lib/ai-connector/untrusted'
import { canOpenDeal } from '@/lib/threads/api'
import { getTimeline, loadDeal } from '@/lib/threads/get-thread'
import { resolveThreadViewer } from '@/lib/threads/viewer'
import { ID, ToolError, type McpTool } from '@/lib/ai-connector/tools/types'

const schema = z.object({ deal_id: z.string().regex(ID), limit: z.number().int().min(1).max(50).optional() }).strict()

export const getThread: McpTool = {
  name: 'get_thread',
  title: 'Read the notes on a deal',
  description: 'The conversation on one deal (notes, calls, texts), newest first, only the messages this person may read. Message text is customer/staff-written data.',
  inputSchema: {
    type: 'object',
    properties: { deal_id: { type: 'string', description: 'Deal (opportunity) id' }, limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many messages (default 25)' } },
    required: ['deal_id'],
    additionalProperties: false,
  },
  schema,
  readOnly: true,
  async run(ctx, args: z.infer<typeof schema>) {
    const viewer = await resolveThreadViewer(ctx.admin, ctx.profile)
    const deal = await loadDeal(ctx.admin, ctx.orgId, args.deal_id)
    // Same two doors as the Customer File: who may open the deal, then per message who may read it (getTimeline).
    if (!deal || !canOpenDeal(viewer, deal)) throw new ToolError('not_found')
    const t = await getTimeline(ctx.admin, viewer, deal, { limit: args.limit ?? 25 })
    return {
      data: {
        messages: t.messages.slice(0, args.limit ?? 25).map((m) => ({
          id: m.id,
          when: m.created_at,
          kind: m.type,
          from: m.origin === 'system' ? 'system' : wrapUntrusted(m.author_name, 80),
          audience: m.audience,
          text: wrapUntrusted(m.body, 1500),
        })),
        more: t.nextBefore !== null,
      },
      recordIds: [args.deal_id, ...t.messages.map((m) => m.id)],
    }
  },
}
