import type { SupabaseClient } from '@supabase/supabase-js'
import type { z } from 'zod'

import type { RateGate } from '@/lib/ai-connector/rate-limit'
import type { User } from '@/lib/types/database'

/** What a tool may use. `profile` is the same object `requireAuthApi` returns: tools act AS this person, nothing wider. */
export type ToolContext = {
  admin: SupabaseClient
  profile: User
  userId: string
  orgId: string
  /** The connection this call came in on (writes are bound to it). Unset only in tests of read tools. */
  grantId?: string
  clientId?: string
  /** True only when the connection carries `crm:write` AND the company's "AI can make changes" switch is on, checked this request. */
  writesAllowed?: boolean
  /** The company's public address for this request (links the AI hands to the person). */
  origin?: string
  /** Set when the PERSON approves a change: the AI app's name (cleaned), used to tag what it wrote. */
  clientName?: string
  rate?: RateGate
  now?: number
}

export type ToolResult = { data: Record<string, unknown>; recordIds?: string[] }

export type ToolErrorCode = 'not_found' | 'denied' | 'bad_input' | 'unavailable'

/** The one message for "no such record" AND "not yours": the AI (and anyone steering it) cannot tell the two apart. */
export const NOT_FOUND_MESSAGE = 'Not found, or you do not have access to it.'

export class ToolError extends Error {
  /** `reason` is a short machine word for the audit log (never shown to the AI). */
  constructor(public code: ToolErrorCode, message?: string, public reason?: string) {
    super(message ?? (code === 'not_found' || code === 'denied' ? NOT_FOUND_MESSAGE : 'Something went wrong'))
  }
}

export type McpTool = {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  schema: z.ZodTypeAny
  /** Read tools never change anything. Write tools only PROPOSE (a preview + a link the PERSON opens to approve); nothing in the AI's reach saves. */
  readOnly: boolean
  /** Hidden from tools/list and refused unless the connection may make changes (see ToolContext.writesAllowed). */
  needsWrites?: boolean
  /** MCP hint: the change overwrites something that already exists (a date), not only adds. */
  destructive?: boolean
  run(ctx: ToolContext, args: never): Promise<ToolResult>
}

export const ID = /^[0-9a-fA-F-]{36}$/

/** What a person is shown before a change, and what the owner screen shows afterwards. Deterministic: no clock, no randomness. */
export type ChangePreview = {
  title: string
  /** label/value rows; values are raw text (fenced for the AI at the edge, shown as plain text on screens) */
  lines: Array<{ label: string; value: string }>
  /** in-app pages (relative paths) for the records this touches */
  links: Array<{ label: string; path: string }>
  recordIds: string[]
  warnings?: string[]
}

export type ChangeOutcome = { summary: string; links: Array<{ label: string; path: string }>; recordIds: string[] }

/** The two halves of a write tool. `prepare` validates + checks the person's own permission + builds the preview and writes NOTHING; `apply` re-checks and saves through the existing writer. */
export type WriteSpec<A> = {
  prepare(ctx: ToolContext, args: A): Promise<ChangePreview>
  apply(ctx: ToolContext, args: A, changeId: string): Promise<ChangeOutcome>
  /** True when `apply` writes at most once per `changeId` (the writer dedupes on it): a save stuck after a crash may be retried once. */
  idempotent?: boolean
}
