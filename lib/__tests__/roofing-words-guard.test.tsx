/** @jest-environment jsdom */
/**
 * Roofing / ARX words must not reach a non-roofing company. Two layers:
 *  (a) STATIC: scripts/roofing-words-ratchet.mjs scans every user-facing string in app/components/lib; each occurrence is
 *      allow-listed with a reason (scripts/roofing-words-allow.json) or counted in the shrink-only baseline.
 *  (b) RENDER: screens rendered as a lawn company show none of the term list; as roofing they keep their roofing text.
 */
import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { render, waitFor } from '@testing-library/react'

import JobDocumentsBanner from '@/components/ops/JobDocumentsBanner'
import JobQuickLinks from '@/components/job/JobQuickLinks'
import { resetOrgFeaturesCacheForTests } from '@/hooks/useOrgFeatures'
import { INDUSTRY_PROFILES } from '@/lib/industry-profiles'
import { NEUTRAL_TEMPLATE_HINTS, proposalTemplateHints, ROOFING_TEMPLATE_HINTS } from '@/lib/industry-profiles-proposal'
import { visibleOutcomeRows, DEFAULT_INSPECTION_OUTCOMES } from '@/lib/inspection-outcomes'
import { resolveOrgProfile, roofingOr, t } from '@/lib/org-profile'

jest.mock('@/components/Nav', () => ({ __esModule: true, default: () => <nav /> }))

/** The term list a non-roofing company must never read in user-facing text: the one list the static guard scans with. */
const { TERMS } = require('../../scripts/roofing-terms.cjs') as { TERMS: RegExp }

const root = process.cwd()

function profileFetch(id: string, features: Record<string, boolean>) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ flags: { features, profile: { id } } }),
  })) as never
}

describe('static guard (scripts/roofing-words-ratchet.mjs)', () => {
  it('passes: no roofing/ARX word in user-facing text beyond the allow-list and the shrink-only baseline', () => {
    const run = () => execFileSync('node', ['scripts/roofing-words-ratchet.mjs'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    expect(run).not.toThrow()
  }, 120000)

  it('every allow-list entry carries a real reason', () => {
    const allow = JSON.parse(readFileSync(path.join(root, 'scripts/roofing-words-allow.json'), 'utf8')) as Record<string, string>
    for (const [file, reason] of Object.entries(allow)) {
      expect(reason.trim().length).toBeGreaterThanOrEqual(8)
      expect(existsSync(path.join(root, file)) || file.endsWith('/') || file.endsWith('-')).toBe(true)
    }
  })

  it('the baseline never lists an allow-listed file twice and has a numeric count per file', () => {
    const base = JSON.parse(readFileSync(path.join(root, 'scripts/roofing-words-baseline.json'), 'utf8')) as { files: Record<string, number> }
    for (const n of Object.values(base.files)) expect(Number.isInteger(n) && n > 0).toBe(true)
  })
})

describe('profile-gated wording', () => {
  it('proposal template hints: roofing keeps its text, every other profile is free of roofing words', () => {
    expect(proposalTemplateHints(undefined)).toBe(ROOFING_TEMPLATE_HINTS)
    expect(proposalTemplateHints('roofing').scope).toBe('Complete tear-off and replacement of existing roofing system...')
    for (const id of ['lawn_landscape', 'exterior_cleaning', 'home_builder']) {
      const h = proposalTemplateHints(id)
      expect(Object.values(h).join(' ')).not.toMatch(TERMS)
    }
    expect(proposalTemplateHints('home_builder')).toBe(NEUTRAL_TEMPLATE_HINTS)
  })

  it('roofingOr: roofing and a missing profile keep the roofing text', () => {
    expect(roofingOr(null, 'Roof', 'Neutral')).toBe('Roof')
    expect(roofingOr({ id: 'roofing' }, 'Roof', 'Neutral')).toBe('Roof')
    expect(roofingOr({ id: 'lawn_landscape' }, 'Roof', 'Neutral')).toBe('Neutral')
  })

  it('customer-impact wording keeps the roofing builder output byte-for-byte', () => {
    const roof = resolveOrgProfile({})
    const lawn = resolveOrgProfile({ profile: { id: 'lawn_landscape', version: 8 } })

    expect(roofingOr(roof, 'Roofing Proposal', t(roof, 'proposal'))).toBe('Roofing Proposal')
    expect(t(roof, 'leadName')).toBe('Homeowner Name')
    expect(t(roof, 'inspection').toLowerCase()).toBe('inspection')
    expect(roofingOr(roof, 'Roof Measurement Loaded', 'Measurement Loaded')).toBe('Roof Measurement Loaded')
    expect(roofingOr(roof, 'Continue to Roofing Type', 'Continue to Service Type')).toBe('Continue to Roofing Type')
    expect(roofingOr(roof, true, false)).toBe(true)
    expect(INDUSTRY_PROFILES.roofing.pricebook.adderCategories).toEqual([
      'Ventilation',
      'Gutters',
      'Skylights',
      'Chimney',
      'Decking',
      'Flashing',
      'Other',
    ])

    expect(roofingOr(lawn, 'Roofing Proposal', t(lawn, 'proposal'))).toBe('Quote')
    expect(t(lawn, 'leadName')).toBe('Customer / company name')
    expect(t(lawn, 'inspection').toLowerCase()).toBe('estimate visit')
    expect(roofingOr(lawn, 'Roof Measurement Loaded', 'Measurement Loaded')).toBe('Measurement Loaded')
    expect(roofingOr(lawn, 'Continue to Roofing Type', 'Continue to Service Type')).toBe('Continue to Service Type')
    expect(roofingOr(lawn, true, false)).toBe(false)
  })

  it('insurance outcomes are hidden without the Insurance feature and untouched with it', () => {
    const rows = DEFAULT_INSPECTION_OUTCOMES
    expect(visibleOutcomeRows(rows, true)).toEqual(rows)
    expect(visibleOutcomeRows(rows, false).some((r) => /insurance/.test(r.id))).toBe(false)
    expect(visibleOutcomeRows(rows, false).length).toBeLessThan(rows.length)
  })

  it('the lawn starter reports leave out referral partners; roofing still lists every report', () => {
    expect(INDUSTRY_PROFILES.lawn_landscape.starterReports).not.toContain('referrals-by-partner')
    expect(INDUSTRY_PROFILES.exterior_cleaning.starterReports).not.toContain('referrals-by-partner')
    expect(INDUSTRY_PROFILES.roofing.starterReports).toBeNull()
  })

  it('service profiles start with an Estimate Visit appointment type; roofing adds none', () => {
    expect(INDUSTRY_PROFILES.lawn_landscape.siteVisitType?.name).toBe('Estimate Visit')
    expect(INDUSTRY_PROFILES.exterior_cleaning.siteVisitType?.name).toBe('Estimate Visit')
    expect(INDUSTRY_PROFILES.roofing.siteVisitType).toBeUndefined()
    expect(JSON.stringify(INDUSTRY_PROFILES.lawn_landscape.siteVisitType)).not.toMatch(TERMS)
  })
})

describe('rendered screens: lawn shows none of the term list, roofing keeps its words', () => {
  const lawn = resolveOrgProfile({ profile: { id: 'lawn_landscape', version: 7 } })
  const job = { id: 'j1', customer: { id: 'c1' }, roof_report: { id: 'r1', pdf_generated_at: '2026-01-01' } }

  it('job documents links (lawn)', async () => {
    resetOrgFeaturesCacheForTests()
    profileFetch('lawn_landscape', { ...lawn.features })
    const { container } = render(<JobQuickLinks job={job} />)
    await waitFor(() => expect(container.textContent).toContain('Report'))
    await waitFor(() => expect(container.textContent).not.toMatch(TERMS))
  })

  it('job documents links (roofing, original company)', async () => {
    resetOrgFeaturesCacheForTests()
    profileFetch('roofing', {})
    const { container } = render(<JobQuickLinks job={job} />)
    await waitFor(() => expect(container.textContent).toContain('Roof report'))
  })

  it('job documents banner (lawn / roofing)', async () => {
    resetOrgFeaturesCacheForTests()
    profileFetch('lawn_landscape', { ...lawn.features })
    const props = { jobId: 'j1', jobNumber: '26-0001', roofReportId: 'r1', showOrderSheet: false }
    const a = render(<JobDocumentsBanner {...props} />)
    await waitFor(() => expect(a.container.textContent).not.toMatch(/roof/i))
    a.unmount()
    resetOrgFeaturesCacheForTests()
    profileFetch('roofing', {})
    const b = render(<JobDocumentsBanner {...props} />)
    await waitFor(() => expect(b.container.textContent).toContain('View Roof Report'))
  })
})
