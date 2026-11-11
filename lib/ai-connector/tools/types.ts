import type { SupabaseClient } from '@supabase/supabase-js'
import type { z } from 'zod'

import type { User } from '@/lib/types/database'

/** What a tool may use. `profile` is the same object `requireAuthApi` returns: tools act AS this person, nothing wider. */
export type ToolContext = { admin: SupabaseClient; profile: User; userId: string; orgId: string }

export type ToolResult = { data: Record<string, unknown>; recordIds?: string[] }

export type ToolErrorCode = 'not_found' | 'denied' | 'bad_input' | 'unavailable'

/** The one message for "no such record" AND "not yours": the AI (and anyone steering it) cannot tell the two apart. */
export const NOT_FOUND_MESSAGE = 'Not found, or you do not have access to it.'

export class ToolError extends Error {
  constructor(public code: ToolErrorCode, message?: string) {
    super(message ?? (code === 'not_found' || code === 'denied' ? NOT_FOUND_MESSAGE : 'Something went wrong'))
  }
}

export type McpTool = {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  schema: z.ZodTypeAny
  /** Phase 1: every tool is read-only. */
  readOnly: true
  run(ctx: ToolContext, args: never): Promise<ToolResult>
}

export const ID = /^[0-9a-fA-F-]{36}$/
