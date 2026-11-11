/** The person's side of an AI change: the same engine, bound to the real write tools. Called by the review page and its API only. */
import { approveChange, declineChange, loadChangeForReview } from '@/lib/ai-connector/changes'
import { AI_WRITES_FEATURE } from '@/lib/ai-connector/config'
import { WRITE_TOOLS } from '@/lib/ai-connector/tools/writes'
import type { McpTool, ToolContext, WriteSpec } from '@/lib/ai-connector/tools/types'
import { isOrgFeatureOn } from '@/lib/org-features-server'

const lookup = (name: string) => WRITE_TOOLS.find((t) => t.name === name) as (McpTool & { write?: WriteSpec<never> }) | undefined

/** `ctx` comes from the person's own session; the company switch is read now. */
export async function personContext(base: Omit<ToolContext, 'writesAllowed'>): Promise<ToolContext> {
  return { ...base, writesAllowed: await isOrgFeatureOn(base.orgId, AI_WRITES_FEATURE) }
}

export const approveAiChange = (ctx: ToolContext, id: string) => approveChange(ctx, id, lookup)
export const declineAiChange = declineChange
export const loadAiChange = loadChangeForReview
