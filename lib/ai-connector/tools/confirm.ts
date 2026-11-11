import { z } from 'zod'

import { checkChange } from '@/lib/ai-connector/changes'
import { ID, type McpTool } from '@/lib/ai-connector/tools/types'

const schema = z.object({ change_id: z.string().regex(ID) }).strict()

/**
 * Status only. The AI can NOT save or approve anything: the signed-in person approves in the CRM at the review link.
 * (The name is kept so AI apps that already know it keep working.)
 */
export const confirmChangeTool: McpTool = {
  name: 'confirm_change',
  title: 'Check whether the person approved a change',
  description: 'Tells you whether a prepared change was approved (saved), declined, expired or is still waiting for the person. It never saves anything and cannot approve: only the person can, by opening the review_link in the CRM.',
  inputSchema: { type: 'object', properties: { change_id: { type: 'string', description: 'The change_id returned with the preview' } }, required: ['change_id'], additionalProperties: false },
  schema,
  readOnly: true,
  needsWrites: true,
  run: (ctx, args: z.infer<typeof schema>) => checkChange(ctx, args.change_id),
}
