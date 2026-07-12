export const AI_CHAT_MAX_MESSAGE_LENGTH = 2000
export const AI_CHAT_MAX_OPENAI_MESSAGES = 10
export const AI_CHAT_OPENAI_MAX_TOKENS = 600

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidAiContextId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id)
}
