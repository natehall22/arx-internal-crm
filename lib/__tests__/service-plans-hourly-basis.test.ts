/** "Billed per hour" on a plan / template / tier only while the company has hourly billing on (lib/service-plans-db.ts). */
const on = { value: false }
jest.mock('@/lib/org-features-server', () => ({ isOrgFeatureOn: async () => on.value }))

import { hourlyBasisRefusal } from '@/lib/service-plans-db'
import { billingBasisChoices } from '@/lib/service-plans'

describe('per-hour plans need hourly billing', () => {
  it('refused while off (plan basis or a tier); allowed when on; an existing per-hour plan stays editable', async () => {
    on.value = false
    expect(await hourlyBasisRefusal('o', 'per_hour', null)).toMatchObject({ ok: false, status: 400 })
    expect(await hourlyBasisRefusal('o', 'per_visit', { tiers: [{ billingBasis: 'per_hour' }] })).toMatchObject({ ok: false })
    expect(await hourlyBasisRefusal('o', 'per_visit', { tiers: [{ billingBasis: 'per_month' }] })).toBeNull()
    expect(await hourlyBasisRefusal('o', 'per_hour', null, 'per_hour')).toBeNull()
    on.value = true
    expect(await hourlyBasisRefusal('o', 'per_hour', null)).toBeNull()
  })
  it('forms offer "per hour" only with hourly billing on, or when the plan already is', () => {
    expect(billingBasisChoices(false)).toEqual(['per_visit', 'per_month', 'per_year'])
    expect(billingBasisChoices(false, 'per_hour')).toContain('per_hour')
    expect(billingBasisChoices(true)).toEqual(['per_visit', 'per_month', 'per_year', 'per_hour'])
  })
})
