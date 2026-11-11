import { z } from 'zod'

import { confirmChange } from '@/lib/ai-connector/changes'
import { WRITE_TOOLS } from '@/lib/ai-connector/tools/writes'
import type { McpTool, WriteSpec } from '@/lib/ai-connector/tools/types'

const schema = z.object({ confirm_key: z.string().min(10).max(120) }).strict()

/** The only tool that saves anything. It saves exactly the change a write tool previewed, once. */
export const confirmChangeTool: McpTool = {
  name: 'confirm_change',
  title: 'Save a change the person approved',
  description: 'Saves the change from an earlier preview. Call it ONLY after the person has seen the preview and clearly said yes. The confirm_key works once, for 10 minutes, for the same person. If anything changed since the preview, nothing is saved and you must ask for the change again.',
  inputSchema: { type: 'object', properties: { confirm_key: { type: 'string', description: 'The confirm_key returned with the preview' } }, required: ['confirm_key'], additionalProperties: false },
  schema,
  readOnly: false,
  needsWrites: true,
  destructive: true,
  run: (ctx, args: z.infer<typeof schema>) => confirmChange(ctx, args.confirm_key, (name) => WRITE_TOOLS.find((t) => t.name === name) as (McpTool & { write?: WriteSpec<never> }) | undefined),
}
