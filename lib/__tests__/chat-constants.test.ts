import {
  isValidAiContextId,
  AI_CHAT_MAX_MESSAGE_LENGTH,
  AI_CHAT_MAX_STORED_MESSAGES,
  normalizeAiChatMessages,
} from '@/lib/ai/chat-constants'

describe('chat-constants', () => {
  it('validates UUID context ids', () => {
    expect(isValidAiContextId('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(isValidAiContextId('not-a-uuid')).toBe(false)
    expect(isValidAiContextId('')).toBe(false)
  })

  it('exposes a reasonable message length cap', () => {
    expect(AI_CHAT_MAX_MESSAGE_LENGTH).toBeGreaterThanOrEqual(500)
    expect(AI_CHAT_MAX_MESSAGE_LENGTH).toBeLessThanOrEqual(8000)
  })

  it('caps stored conversation messages at 50', () => {
    expect(AI_CHAT_MAX_STORED_MESSAGES).toBe(50)
  })

  describe('normalizeAiChatMessages', () => {
    it('drops system and unknown roles, keeps user/assistant order', () => {
      const result = normalizeAiChatMessages([
        { role: 'system', content: 'ignore me' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
        { role: 'tool', content: 'also ignore' },
      ])

      expect(result).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ])
    })

    it('coerces non-string content and truncates long content', () => {
      const long = 'x'.repeat(AI_CHAT_MAX_MESSAGE_LENGTH + 100)
      const result = normalizeAiChatMessages([
        { role: 'user', content: 42 },
        { role: 'assistant', content: long },
      ])

      expect(result[0]).toEqual({ role: 'user', content: '42' })
      expect(result[1].content).toHaveLength(AI_CHAT_MAX_MESSAGE_LENGTH)
    })

    it('caps to AI_CHAT_MAX_STORED_MESSAGES', () => {
      const many = Array.from({ length: AI_CHAT_MAX_STORED_MESSAGES + 5 }, (_, i) => ({
        role: 'user' as const,
        content: `msg-${i}`,
      }))
      const result = normalizeAiChatMessages(many)
      expect(result).toHaveLength(AI_CHAT_MAX_STORED_MESSAGES)
      expect(result[0].content).toBe(`msg-5`)
      expect(result[result.length - 1].content).toBe(`msg-${AI_CHAT_MAX_STORED_MESSAGES + 4}`)
    })

    it('returns empty array for non-array input', () => {
      expect(normalizeAiChatMessages(null)).toEqual([])
      expect(normalizeAiChatMessages(undefined)).toEqual([])
    })
  })
})
