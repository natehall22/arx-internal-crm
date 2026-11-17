/** @jest-environment jsdom */
import { render } from '@testing-library/react'

import AppointmentCardsClient from '@/app/admin/print-kit/appointment-cards/AppointmentCardsClient'
import BonusApprovalClient from '@/app/admin/bonuses/BonusApprovalClient'
import { resetOrgFeaturesCacheForTests } from '@/hooks/useOrgFeatures'
import { bonusIntro, bonusLinkLabel } from '@/lib/bonus-programs'
import { pageHidden, resolveOrgProfile } from '@/lib/org-profile'
import { doorDropAvailable, printKitBrand } from '@/lib/print-kit'
import { SETTINGS_GROUPS, visibleSettingsGroups } from '@/lib/settings-registry'

jest.mock('@/components/Nav', () => ({ __esModule: true, default: () => <nav /> }))

const roof = resolveOrgProfile({})
const lawn = resolveOrgProfile({ profile: { id: 'lawn_landscape', version: 7 } })
const cleaning = resolveOrgProfile({ profile: { id: 'exterior_cleaning', version: 4 } })

/** Words a lawn company must never read where the screen is gated for it. */
const ROOFING_ONLY = /\b444\b|sisu|setter|roof|canvass|\bARX\b|squares?\b|ventilation|skylight|dealer fee|lender|round-robin|door-drop|door drop|closers?\b/i

const settingsFor = (p: typeof lawn) =>
  visibleSettingsGroups({
    features: p.features,
    terms: p.terms,
    profileId: p.id,
    hiddenHrefs: [...p.nav.hidden, ...p.settingsHidden],
    text: p.settingsText,
    canCost: true,
    canPayroll: true,
    canSuperuser: true,
    canWorkAreas: true,
    canOwner: true,
    canSuperAdmin: true,
  })

describe('lawn company never reads roofing / ARX wording where gated', () => {
  it('Money → Bonuses intro and the payroll link', () => {
    expect(bonusIntro(lawn.features)).toBe('Review and approve every bonus line before payroll locks.')
    expect(bonusLinkLabel(lawn.features)).toBe('Bonuses')
    expect(bonusIntro(lawn.features) + bonusLinkLabel(lawn.features)).not.toMatch(ROOFING_ONLY)
  })

  it('the Bonuses screen renders without 444 / Sisu / setter ramp for lawn', () => {
    resetOrgFeaturesCacheForTests()
    global.fetch = jest.fn(() => new Promise(() => {})) as never
    const { container } = render(<BonusApprovalClient isFullAdmin features={lawn.features} />)
    expect(container.textContent).toContain('Review and approve every bonus line before payroll locks.')
    expect(container.textContent).not.toMatch(ROOFING_ONLY)
  })

  it('Settings: every entry a lawn owner sees (title + description) is free of roofing wording', () => {
    const seen = settingsFor(lawn).flatMap((g) => [g.title, ...g.items.flatMap((i) => [i.title, i.description])])
    expect(seen.filter((t) => ROOFING_ONLY.test(t))).toEqual([])
    const hrefs = settingsFor(lawn).flatMap((g) => g.items.map((i) => i.href))
    for (const h of ['/admin/print-kit', '/admin/door-drop', '/admin/financing-programs', '/admin/sisu/incentives', '/admin/inspection-feedback']) expect(hrefs).not.toContain(h)
  })

  it('"+ Partner" and the My Partners card are hidden for lawn', () => {
    expect(pageHidden(lawn, '/referral-partners')).toBe(true)
    expect(pageHidden(roof, '/referral-partners')).toBe(false)
  })

  it('Print Kit: another company’s cards carry its own name and logo, never ARX', () => {
    for (const p of [lawn, cleaning]) {
      const brand = printKitBrand(p, { name: 'Precision Maintenance', logoHref: '/api/org-logo/o1?v=1' })
      const { container } = render(<AppointmentCardsClient brand={brand} />)
      expect(container.textContent).toContain('Precision Maintenance')
      expect(container.textContent).not.toMatch(/\bARX\b|roof|Alex Nunez|704-437/i)
      const srcs = Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('src'))
      expect(srcs.every((s) => s === '/api/org-logo/o1?v=1')).toBe(true)
    }
    expect(doorDropAvailable(lawn)).toBe(false)
    expect(doorDropAvailable(cleaning)).toBe(false)
  })
})

describe('roofing / ARX copy is unchanged', () => {
  it('bonuses intro and link keep today’s words', () => {
    expect(bonusIntro(roof.features)).toBe('Review and approve every bonus line before payroll locks: Sisu 444, setter ramp and manual bonuses.')
    expect(bonusLinkLabel(roof.features)).toBe('Bonuses (444, setter ramp, manual)')
  })

  it('Settings: roofing sees every entry with the registry’s own text, nothing hidden or reworded', () => {
    const all = SETTINGS_GROUPS.flatMap((g) => g.items)
    const seen = settingsFor(roof).flatMap((g) => g.items)
    for (const i of seen) expect(i.description).toBe(all.find((a) => a.href === i.href)?.description)
    const hrefs = seen.map((i) => i.href)
    for (const h of ['/admin/print-kit', '/admin/door-drop', '/admin/financing-programs', '/admin/sisu/incentives', '/admin/inspection-feedback', '/admin/pricing', '/admin/proposals', '/admin/teams']) expect(hrefs).toContain(h)
    expect(seen.find((i) => i.href === '/admin/pricing')?.description).toBe('Price per square, dump costs, overhead and pricebook items')
    expect(seen.find((i) => i.href === '/admin/proposals')?.description).toBe('Ventilation, gutters, skylights, price visibility, PDF templates')
    expect(roof.nav.hidden).toEqual([])
    expect(roof.settingsHidden).toEqual([])
    expect(roof.settingsText).toEqual({})
  })

  it('Print Kit: the ARX appointment card prints exactly as before', () => {
    const brand = printKitBrand(roof, { name: 'Anything', logoHref: '/x' })
    const { container } = render(<AppointmentCardsClient brand={brand} />)
    expect(container.textContent).toContain('ARX Roofing & Exteriors')
    expect(container.textContent).toContain('Free Inspection')
    expect(container.textContent).toContain('Roofing Specialist')
    expect(container.textContent).toContain('Alex Nunez')
    expect(Array.from(container.querySelectorAll('img')).every((i) => i.getAttribute('src') === '/brand/arx-shield.png')).toBe(true)
    expect(doorDropAvailable(roof)).toBe(true)
  })
})
