import { SECTION_PAGES } from '../../app/admin/s/[section]/sections'
import { LEGACY_ANCHOR_HREFS, SETTINGS_CARDS, SETTINGS_SECTION_PREFIX, reachableSettingsHrefs, SETTINGS_GROUPS, canOpenSettingsHub, filterSettingsGroups, visibleSettingsGroups } from '@/lib/settings-registry'

const all = { canCost: true, canPayroll: true, canSuperuser: true, canWorkAreas: true }
const none = { canCost: false, canPayroll: false, canSuperuser: false, canWorkAreas: false }
const hrefs = (g: ReturnType<typeof visibleSettingsGroups>) => g.flatMap((x) => x.items.map((i) => i.href))
const reach = reachableSettingsHrefs
const pageItem = (g: ReturnType<typeof visibleSettingsGroups>, href: string) => g.flatMap((x) => x.items).find((i) => i.href === href)

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
  it('Job setup shows only to super admins (the page and its route check isSuperAdmin)', () => {
    expect(hrefs(visibleSettingsGroups({ ...all, canOwner: true }))).not.toContain('/admin/job-setup')
    expect(hrefs(visibleSettingsGroups({ ...all, canOwner: true, canSuperAdmin: true }))).toContain('/admin/job-setup')
  })
  it('Contracts & templates is a link to the existing template list, not a second tool', () => {
    const item = SETTINGS_GROUPS.flatMap((g) => g.items).find((i) => i.title === 'Contracts & templates')
    expect(item?.href).toBe('/signing#templates')
    expect(item?.description).toBe('Your agreements and other documents to sign: upload once, place the fields, reuse.')
  })
  it('search finds a card through its page, and opens the card when only the card matches', () => {
    const g = visibleSettingsGroups({ ...all, canSuperAdmin: true, features: { servicePlans: true } })
    expect(hrefs(filterSettingsGroups(g, 'mowing biweekly'))).toEqual(['/admin/s/jobs#plan-templates'])
    expect(hrefs(filterSettingsGroups(g, 'esign'))).toContain('/admin/s/quotes#signing')
    expect(hrefs(filterSettingsGroups(g, 'sales tax'))).toEqual(['/admin/s/payments#sales-tax'])
    expect(hrefs(filterSettingsGroups(g, 'payments'))).toContain('/admin/s/payments')
    expect(reach(visibleSettingsGroups({ ...all, canSuperAdmin: true, features: { servicePlans: false } }))).not.toContain('/admin/s/jobs#plan-templates')
    expect(reach(visibleSettingsGroups(all))).not.toContain('/admin/s/jobs#plan-templates')
  })
  it('the menu shows only the topic pages, never a card of its own', () => {
    expect(hrefs(visibleSettingsGroups({ ...all, canSuperAdmin: true })).filter((h) => h.startsWith('/admin/s/') && h.includes('#'))).toEqual([])
  })
  it('a page description lists only the cards this viewer can open', () => {
    expect(pageItem(visibleSettingsGroups(all), '/admin/s/jobs')?.description).toBe('Job catch-up, Customer checkups')
    expect(pageItem(visibleSettingsGroups({ ...all, canSuperAdmin: true, features: { servicePlans: true } }), '/admin/s/jobs')?.description).toBe('Service plans, Job catch-up, Customer checkups')
  })
  it('only leadership roles open the hub', () => {
    expect(canOpenSettingsHub('owner')).toBe(true)
    expect(canOpenSettingsHub('sales_rep')).toBe(false)
  })
  it('every card is reachable from exactly one page entry, and matches a card on that page', () => {
    const pages = SETTINGS_GROUPS.flatMap((g) => g.items).filter((i) => i.cards)
    const listed = pages.flatMap((p) => p.cards ?? [])
    expect([...listed].sort()).toEqual(SETTINGS_CARDS.map((c) => c.href).sort())
    expect(new Set(listed).size).toBe(listed.length)
    const fromPages = Object.entries(SECTION_PAGES).flatMap(([slug, p]) => p.cards.map((c) => `${SETTINGS_SECTION_PREFIX}${slug}#${c.anchor}`))
    expect(fromPages.sort()).toEqual([...listed].sort())
    for (const p of pages) for (const c of p.cards ?? []) expect(c.startsWith(`${p.href}#`)).toBe(true)
  })
  it('a topic page shows only when one of its cards does; old /admin#anchor ids map to the new place', () => {
    const top = (f: Parameters<typeof visibleSettingsGroups>[0]) => hrefs(visibleSettingsGroups(f)).filter((h) => /^\/admin\/s\/[a-z]+$/.test(h))
    expect(top({ ...all, canSuperAdmin: false })).toEqual(['/admin/s/jobs'])
    expect(top({ ...all, canSuperAdmin: true, profileId: 'roofing', features: {} }).sort()).toEqual(['/admin/s/company', '/admin/s/jobs', '/admin/s/payments', '/admin/s/quotes'])
    expect(LEGACY_ANCHOR_HREFS['sales-tax']).toBe('/admin/s/payments#sales-tax')
    expect(LEGACY_ANCHOR_HREFS['quickbooks']).toBe('/admin/s/payments#quickbooks')
  })
})
