import { isValidAiContextId, AI_CHAT_MAX_MESSAGE_LENGTH } from '@/lib/ai/chat-constants'

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
})
