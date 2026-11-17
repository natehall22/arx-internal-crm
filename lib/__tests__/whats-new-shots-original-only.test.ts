import { whatsNewShotsFor, WHATS_NEW_SHOTS } from '@/lib/whats-new-shots'
import { resolveOrgBrand, usesOriginalCompanyAssets } from '@/lib/org-brand'

describe('/whats-new screenshots belong to the original company', () => {
  it('the original company sees its role screenshots', () => {
    expect(whatsNewShotsFor('owner', true)).toEqual(WHATS_NEW_SHOTS.owner)
    expect(whatsNewShotsFor('closer', true).length).toBeGreaterThan(0)
  })
  it('another company, an unknown role, or an unreadable org sees none', () => {
    const other = resolveOrgBrand({ name: 'Precision Maintenance', original_brand: false })
    expect(whatsNewShotsFor('owner', usesOriginalCompanyAssets(other))).toEqual([])
    expect(whatsNewShotsFor(null, true)).toEqual([])
    expect(whatsNewShotsFor('owner', false)).toEqual([])
  })
})
