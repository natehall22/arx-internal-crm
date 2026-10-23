import { SETTINGS_GROUPS, canOpenSettingsHub, filterSettingsGroups, visibleSettingsGroups } from '@/lib/settings-registry'

const all = { canCost: true, canPayroll: true, canSuperuser: true, canWorkAreas: true }
const none = { canCost: false, canPayroll: false, canSuperuser: false, canWorkAreas: false }
const hrefs = (g: ReturnType<typeof visibleSettingsGroups>) => g.flatMap((x) => x.items.map((i) => i.href))

describe('settings registry', () => {
  it('every page appears once', () => {
    const all = SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.href))
    expect(new Set(all).size).toBe(all.length)
  })
  it('hides what a role cannot open (same gates the old Admin cards used)', () => {
    expect(hrefs(visibleSettingsGroups(none))).not.toEqual(expect.arrayContaining(['/admin/pricing', '/admin/payroll', '/admin/goals', '/canvass?areas=1']))
    const full = hrefs(visibleSettingsGroups(all))
    expect(full).toEqual(expect.arrayContaining(['/admin/pricing', '/admin/payroll', '/admin/goals', '/canvass?areas=1']))
  })
  it('search matches title, description and keywords; every word must match', () => {
    const g = visibleSettingsGroups(all)
    expect(hrefs(filterSettingsGroups(g, 'commission'))).toContain('/admin/comp-plans')
    expect(hrefs(filterSettingsGroups(g, 'sisu'))).toEqual(['/admin/sisu/incentives'])
    expect(hrefs(filterSettingsGroups(g, 'territories'))).toEqual(['/canvass?areas=1'])
    expect(filterSettingsGroups(g, 'zzzz')).toEqual([])
    expect(filterSettingsGroups(g, '  ')).toEqual(g)
  })
  it('only leadership roles open the hub', () => {
    expect(canOpenSettingsHub('owner')).toBe(true)
    expect(canOpenSettingsHub('sales_rep')).toBe(false)
  })
})
