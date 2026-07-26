export const AI_CHAT_MAX_MESSAGE_LENGTH = 2000
export const AI_CHAT_MAX_OPENAI_MESSAGES = 10
export const AI_CHAT_OPENAI_MAX_TOKENS = 600
/** Cap on messages persisted per `ai_conversations` row so a single transcript can't grow without bound. */
export const AI_CHAT_MAX_STORED_MESSAGES = 50

/**
 * Server-only flag for pipeline/job-board aggregate snapshots.
 * Prod: set AI_CHAT_AGGREGATES_ENABLED=true to enable.
 * Dev: on by default when unset so local path testing gets real counts.
 */
export function aiChatAggregatesEnabled(): boolean {
  const flag = process.env.AI_CHAT_AGGREGATES_ENABLED
  if (flag === 'true') return true
  if (flag === 'false') return false
  return process.env.NODE_ENV === 'development'
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidAiContextId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id)
}

export type AiChatStoredMessage = {
  role: 'user' | 'assistant'
  content: string
}

/** Strip system/unknown roles, coerce content, truncate, and cap stored message count. */
export function normalizeAiChatMessages(
  messages: unknown,
  maxMessages: number = AI_CHAT_MAX_STORED_MESSAGES
): AiChatStoredMessage[] {
  if (!Array.isArray(messages)) return []

  const normalized: AiChatStoredMessage[] = []
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue
    const role = (msg as { role?: unknown }).role
    if (role !== 'user' && role !== 'assistant') continue

    let content: string
    const rawContent = (msg as { content?: unknown }).content
    if (rawContent == null) {
      content = ''
    } else if (typeof rawContent !== 'string') {
      content = String(rawContent)
    } else {
      content = rawContent
    }
    if (content.length > AI_CHAT_MAX_MESSAGE_LENGTH) {
      content = content.slice(0, AI_CHAT_MAX_MESSAGE_LENGTH)
    }
    normalized.push({ role, content })
  }

  return normalized.slice(-maxMessages)
}
