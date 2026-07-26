import { isValidAiContextId } from '@/lib/ai/chat-constants'
import {
  canAccessAiChatRecordContext,
  type AiChatRecordAccess,
  type AiChatClientContext,
} from '@/lib/ai/chat-record-context'

const RECORD_PATH_PREFIX: Record<string, string> = {
  lead: '/leads/',
  opportunity: '/opportunities/',
  project: '/projects/',
  job: '/ops/jobs/',
}

/** Maps CRM record context to an App Router path, or null when type/id are invalid. */
export function getAiChatRecordUrl(
  contextType: string,
  contextId: string
): string | null {
  const prefix = RECORD_PATH_PREFIX[contextType]
  if (!prefix || !isValidAiContextId(contextId)) {
    return null
  }
  return `${prefix}${contextId}`
}

/**
 * System-prompt appendix with the clickable path for the page the user is on.
 * Respects the same RBAC gate as record context — no URL leak for barred roles.
 */
export function getAiChatRecordUrlAppendix(
  context: AiChatClientContext,
  access?: AiChatRecordAccess
): string {
  if (!context?.type || context.type === 'general') {
    return ''
  }

  if (!isValidAiContextId(context.id)) {
    return ''
  }

  if (access && !canAccessAiChatRecordContext(access, context.type)) {
    return ''
  }

  const url = getAiChatRecordUrl(context.type, context.id)
  if (!url) {
    return ''
  }

  return `\n\nCurrent record URL: ${url}\nWhen the user asks about "this" record or you reference it in an answer, prefer linking with this exact path (e.g. [open record](${url})).`
}
