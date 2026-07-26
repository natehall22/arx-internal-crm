import {
  AI_ASSISTANT_ALLOWLISTED_EMAILS,
  isAiAssistantAllowlistedEmail,
  isAiAssistantAllowlistedAuth,
  normalizeAiAssistantEmail,
  resolveAiAssistantEmail,
} from '@/lib/ai/chat-allowlist'

describe('chat-allowlist', () => {
  it('includes Nathan as the sole allowlisted email', () => {
    expect(AI_ASSISTANT_ALLOWLISTED_EMAILS).toEqual(['nathan@arxroofing.com'])
  })

  it('accepts exact match and normalizes case/whitespace', () => {
    expect(isAiAssistantAllowlistedEmail('nathan@arxroofing.com')).toBe(true)
    expect(isAiAssistantAllowlistedEmail('  Nathan@ARXRoofing.com  ')).toBe(true)
    expect(normalizeAiAssistantEmail('  Nathan@ARXRoofing.com  ')).toBe('nathan@arxroofing.com')
  })

  it('rejects other emails and empty values', () => {
    expect(isAiAssistantAllowlistedEmail('evan@arxroofing.com')).toBe(false)
    expect(isAiAssistantAllowlistedEmail('')).toBe(false)
    expect(isAiAssistantAllowlistedEmail(null)).toBe(false)
    expect(isAiAssistantAllowlistedEmail(undefined)).toBe(false)
  })

  it('checks auth context using auth email then profile email', () => {
    expect(
      isAiAssistantAllowlistedAuth({
        authUser: { id: '1', email: 'nathan@arxroofing.com' },
        profile: { email: 'other@example.com' } as never,
      })
    ).toBe(true)

    expect(
      isAiAssistantAllowlistedAuth({
        authUser: { id: '2', email: null },
        profile: { email: 'nathan@arxroofing.com' } as never,
      })
    ).toBe(true)

    expect(
      isAiAssistantAllowlistedAuth({
        authUser: { id: '3', email: 'evan@arxroofing.com' },
        profile: { email: 'evan@arxroofing.com' } as never,
      })
    ).toBe(false)

    expect(
      resolveAiAssistantEmail({
        authUser: { email: 'auth@example.com' },
        profile: { email: 'profile@example.com' },
      })
    ).toBe('auth@example.com')
  })
})
