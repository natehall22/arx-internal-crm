import { normalizeIdentityEmail } from '@/lib/customers'

describe('normalizeIdentityEmail', () => {
  it('keeps real emails available for customer identity matching', () => {
    expect(normalizeIdentityEmail(' Justin@example.COM ')).toBe('justin@example.com')
  })

  it('does not use placeholder emails for customer identity matching', () => {
    expect(normalizeIdentityEmail('none@none.com')).toBeNull()
    expect(normalizeIdentityEmail(' NoEmail@NoEmail.com ')).toBeNull()
    expect(normalizeIdentityEmail('noemail@example.com')).toBeNull()
  })
})
