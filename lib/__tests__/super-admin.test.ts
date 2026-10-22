import { isSuperAdmin } from '@/lib/super-admin'

describe('isSuperAdmin', () => {
  it('is true only for an explicit true flag', () => {
    expect(isSuperAdmin({ is_super_admin: true })).toBe(true)
    expect(isSuperAdmin({ is_super_admin: false })).toBe(false)
    expect(isSuperAdmin({ is_super_admin: null })).toBe(false)
    expect(isSuperAdmin({})).toBe(false)
    expect(isSuperAdmin(null)).toBe(false)
  })
  it('a deactivated owner loses it', () => {
    expect(isSuperAdmin({ is_super_admin: true, active: false })).toBe(false)
  })
  it('role admin alone is not enough', () => {
    expect(isSuperAdmin({ role: 'admin' } as never)).toBe(false)
  })
})
