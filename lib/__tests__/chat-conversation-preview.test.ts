import {
  AI_CHAT_CONVERSATION_PREVIEW_LENGTH,
  getConversationPreview,
} from '@/lib/ai/chat-conversation-preview'

describe('getConversationPreview', () => {
  it('uses the first user message, normalized and truncated', () => {
    const preview = getConversationPreview([
      { role: 'system', content: 'ignore' },
      { role: 'user', content: '  Where do I enter labor cost?  ' },
      { role: 'assistant', content: 'Materials tab' },
    ])

    expect(preview).toBe('Where do I enter labor cost?')
  })

  it('truncates long previews with ellipsis', () => {
    const long = 'a'.repeat(AI_CHAT_CONVERSATION_PREVIEW_LENGTH + 10)
    const preview = getConversationPreview([{ role: 'user', content: long }])

    expect(preview).toHaveLength(AI_CHAT_CONVERSATION_PREVIEW_LENGTH)
    expect(preview.endsWith('...')).toBe(true)
  })

  it('falls back to the first non-empty message when no user message exists', () => {
    const preview = getConversationPreview([
      { role: 'assistant', content: 'Welcome back' },
    ])

    expect(preview).toBe('Welcome back')
  })

  it('returns a default label for empty conversations', () => {
    expect(getConversationPreview([])).toBe('New conversation')
    expect(getConversationPreview(null)).toBe('New conversation')
  })
})
