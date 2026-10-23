/** @jest-environment node */
import { fileRedirectsEnabledFor } from '@/lib/customer-file/redirects'

describe('customer file redirect switch', () => {
  it('is off unless turned on', () => {
    for (const v of [undefined, '', 'off', 'false', '0', '  OFF ']) expect(fileRedirectsEnabledFor('admin', v)).toBe(false)
  })
  it('all / true turn it on for everyone', () => {
    for (const v of ['all', 'ALL', 'true', '1']) expect(fileRedirectsEnabledFor('setter', v)).toBe(true)
  })
  it('a role list turns it on for those roles only', () => {
    expect(fileRedirectsEnabledFor('operations', 'operations, admin')).toBe(true)
    expect(fileRedirectsEnabledFor('Admin', 'operations,admin')).toBe(true)
    expect(fileRedirectsEnabledFor('setter', 'operations,admin')).toBe(false)
  })
})
