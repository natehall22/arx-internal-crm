import {
  AI_ASSISTANT_ALLOWLISTED_EMAILS,
  isAiAssistantAllowlistedEmail,
  isAiAssistantAllowlistedAuth,
  normalizeAiAssistantEmail,
  resolveAiAssistantEmail,
} from '@/lib/ai/chat-allowlist'

describe('chat-allowlist', () => {
  it('includes Nathan CRM and Google login emails plus Steve', () => {
    expect(AI_ASSISTANT_ALLOWLISTED_EMAILS).toEqual([
      'nathan@arxroofing.com',
      'natehall22@gmail.com',
      'stpotts2@gmail.com',
    ])
  })

  it('accepts exact match and normalizes case/whitespace', () => {
    expect(isAiAssistantAllowlistedEmail('nathan@arxroofing.com')).toBe(true)
    expect(isAiAssistantAllowlistedEmail('  Nathan@ARXRoofing.com  ')).toBe(true)
    expect(isAiAssistantAllowlistedEmail('natehall22@gmail.com')).toBe(true)
    expect(isAiAssistantAllowlistedEmail('stpotts2@gmail.com')).toBe(true)
    expect(normalizeAiAssistantEmail('  Nathan@ARXRoofing.com  ')).toBe('nathan@arxroofing.com')
  })

  it('rejects other emails and empty values', () => {
    expect(isAiAssistantAllowlistedEmail('evan@arxroofing.com')).toBe(false)
    expect(isAiAssistantAllowlistedEmail('')).toBe(false)
    expect(isAiAssistantAllowlistedEmail(null)).toBe(false)
    expect(isAiAssistantAllowlistedEmail(undefined)).toBe(false)
  })

  it('checks auth context using either auth or profile email', () => {
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

    // Auth is personal Gmail, CRM profile is work — must still pass
    expect(
      isAiAssistantAllowlistedAuth({
        authUser: { id: '2b', email: 'natehall22@gmail.com' },
        profile: { email: 'nathan@arxroofing.com' } as never,
      })
    ).toBe(true)

    // Auth is non-allowlisted, profile is Nathan work email — must still pass
    expect(
      isAiAssistantAllowlistedAuth({
        authUser: { id: '2c', email: 'random@gmail.com' },
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
      isAiAssistantAllowlistedAuth({
        authUser: { id: '4', email: 'stpotts2@gmail.com' },
        profile: { email: 'stpotts2@gmail.com' } as never,
      })
    ).toBe(true)

    expect(
      resolveAiAssistantEmail({
        authUser: { email: 'auth@example.com' },
        profile: { email: 'profile@example.com' },
      })
    ).toBe('auth@example.com')
  })
})
