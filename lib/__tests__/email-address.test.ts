import { isValidEmailFormat, pickValidEmail } from '@/lib/email-address'

describe('isValidEmailFormat', () => {
  it('rejects malformed addresses', () => {
    expect(isValidEmailFormat('@')).toBe(false)
    expect(isValidEmailFormat('rep@')).toBe(false)
    expect(isValidEmailFormat('not an email')).toBe(false)
    expect(isValidEmailFormat('')).toBe(false)
  })

  it('accepts normal addresses', () => {
    expect(isValidEmailFormat('rep@example.com')).toBe(true)
  })
})

describe('pickValidEmail', () => {
  it('prefers first valid candidate (auth before public)', () => {
    expect(pickValidEmail('auth@example.com', 'old@example.com')).toBe('auth@example.com')
  })

  it('falls back to public when auth is invalid', () => {
    expect(pickValidEmail('bad@', 'good@example.com')).toBe('good@example.com')
  })
})
