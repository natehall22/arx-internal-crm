import { normalizeAiChatMessages } from '@/lib/ai/chat-constants'

export const AI_CHAT_CONVERSATION_PREVIEW_LENGTH = 80

function truncatePreview(text: string, maxLength: number = AI_CHAT_CONVERSATION_PREVIEW_LENGTH): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 3).trimEnd()}...`
}

/** First user message content, normalized and truncated for history list previews. */
export function getConversationPreview(messages: unknown): string {
  const normalized = normalizeAiChatMessages(messages)
  const firstUser = normalized.find((message) => message.role === 'user' && message.content.trim())
  if (firstUser) {
    return truncatePreview(firstUser.content.trim())
  }

  const firstMessage = normalized.find((message) => message.content.trim())
  if (firstMessage) {
    return truncatePreview(firstMessage.content.trim())
  }

  return 'New conversation'
}
