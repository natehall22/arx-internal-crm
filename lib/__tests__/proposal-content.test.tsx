/** @jest-environment node */
/**
 * Proposal PDF content: roofing resolves to the exact words the PDF always printed (and renders the same), other profiles
 * start from non-roofing text, caps hold, an org writes only its own settings, and the cover is the proposal's own title.
 */
jest.mock('@react-pdf/renderer', () => ({ Document: 'document', Page: 'page', Text: 'text', View: 'view', StyleSheet: { create: (s: unknown) => s }, Image: 'image' }))
const requireAuthApi = jest.fn()
jest.mock('@/lib/auth', () => ({ requireAuthApi: (...a: unknown[]) => requireAuthApi(...a) }))
let mockAdmin: unknown
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => mockAdmin }))

import { renderToStaticMarkup } from 'react-dom/server'

import { GET, PATCH } from '@/app/api/admin/proposal-content/route'
import { ProposalPDFv2, type ProposalPDFData } from '@/components/ProposalPDFv2'
import { INDUSTRY_PROFILE_IDS } from '@/lib/industry-profiles'
import { resolveOrgProfile } from '@/lib/org-profile'
import { mergeSettingsAt } from '@/lib/org-settings'
import { defaultProposalContent, parseProposalContentPatch, proposalCoverTitle, resolveProposalContent, MAX_BODY_LENGTH, MAX_ITEMS, MAX_TITLE_LENGTH } from '@/lib/proposal-content'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const resolve = (settings: unknown) => resolveProposalContent({ settings }, resolveOrgProfile(settings))

// What the PDF printed before it was editable.
const TODAY = {
  coverSubtitle: 'Professional Roofing Services',
  processTitle: 'The Process',
  processSubtitle: 'Your roof replacement from start to finish',
  processSteps: [
    ['Initial Consultation', 'We assess your roof, discuss your needs, and provide a detailed proposal.'],
    ['Material Selection', 'Choose from premium roofing materials that fit your style and budget.'],
    ['Project Scheduling', 'We coordinate a convenient installation date that works for you.'],
    ['Professional Installation', 'Our certified crew completes your roof with precision and care.'],
    ['Quality Inspection', 'We perform a thorough walkthrough to ensure everything meets our standards.'],
    ['Final Cleanup & Warranty', 'We leave your property clean and provide all warranty documentation.'],
  ],
  whyUsTitle: 'Why Homeowners Choose {company}',
  whyUsItems: [
    ['Local & Long-Term', 'We are Charlotte-based and committed to serving our community for years to come.'],
    ['Complete Roofing Systems', 'We install full roofing systems—not patchwork fixes—built for long-term performance.'],
    ['Clear Communication', 'Every project is documented with photos and written scopes. You always know what to expect.'],
    ['Professional Process', 'Clean job sites, final walkthroughs, and a step-by-step approach from start to finish.'],
    ['Insurance Guidance', 'Filing a claim? We help you through the process without overpromising outcomes.'],
  ],
}
const pairs = (l: Array<{ title: string; body: string }>) => l.map((i) => [i.title, i.body])

const base: ProposalPDFData = {
  proposal: { id: 'p1', proposal_number: 'P-1', customer_name: 'Pat', customer_address: '1 Main', title: 'Roofing Proposal', status: 'sent', subtotal: 100, discount_amount: 0, discount_percent: 0, tax_rate: 0, tax_amount: 0, total: 100, created_at: '2026-11-01T12:00:00Z' },
  lineItems: [],
  company: { name: 'ARX Roofing', short_name: 'ARX' },
}
const markup = (d: ProposalPDFData) => renderToStaticMarkup(<ProposalPDFv2 data={d} />)
const text = (d: ProposalPDFData) => markup(d).replace(/<[^>]+>/g, '|')

describe('resolveProposalContent', () => {
  it('roofing / nothing stored = today\'s exact text', () => {
    const c = resolve({})
    expect(c).toMatchObject({ coverSubtitle: TODAY.coverSubtitle, processTitle: TODAY.processTitle, processSubtitle: TODAY.processSubtitle, whyUsTitle: TODAY.whyUsTitle, detailsSubtitle: 'Property information and roof measurements', proposalWord: 'Proposal' })
    expect(pairs(c.processSteps)).toEqual(TODAY.processSteps)
    expect(pairs(c.whyUsItems)).toEqual(TODAY.whyUsItems)
  })

  it('the PDF is byte-identical for roofing: with resolved content, and with none (a snapshot from before)', () => {
    const measurement = { total_squares: 28, total_area_sqft: 2800, predominant_pitch: '6/12', facet_count: 8 }
    for (const m of [undefined, measurement]) {
      const legacy = markup({ ...base, measurement: m })
      expect(markup({ ...base, measurement: m, content: resolve({}) })).toBe(legacy)
    }
    expect(text({ ...base, content: resolve({}) })).toContain('|Why Homeowners Choose ARX|')
  })

  it('lawn, exterior cleaning and home builder defaults mention no roof; so does the neutral fallback', () => {
    for (const id of ['lawn_landscape', 'exterior_cleaning', 'home_builder'] as const) {
      const c = resolve({ profile: { id, version: 1 } })
      expect(JSON.stringify(c)).not.toMatch(/roof/i)
      expect(c.processSteps.length).toBeGreaterThan(0)
      expect(c.whyUsItems.length).toBeGreaterThan(0)
    }
    expect(resolve({ profile: { id: 'exterior_cleaning', version: 1 } }).proposalWord).toBe('Quote')
    expect(resolve({ profile: { id: 'home_builder', version: 1 } }).proposalWord).toBe('Bid')
    for (const id of INDUSTRY_PROFILE_IDS) expect(defaultProposalContent(id).processSteps.length).toBeLessThanOrEqual(MAX_ITEMS)
  })

  it('a company\'s own edits win, field by field; invalid stored values fall back to the default', () => {
    const c = resolve({ proposalContent: { coverSubtitle: '  Siding & Exteriors  ', processSteps: [{ title: 'Visit', body: 'We come out.' }], whyUsItems: 'nope', processTitle: 42 } })
    expect(c.coverSubtitle).toBe('Siding & Exteriors')
    expect(pairs(c.processSteps)).toEqual([['Visit', 'We come out.']])
    expect(pairs(c.whyUsItems)).toEqual(TODAY.whyUsItems)
    expect(c.processTitle).toBe('The Process')
  })

  it('caps hold when reading stored data too', () => {
    const long = (n: number) => 'x'.repeat(n)
    const c = resolve({ proposalContent: { coverSubtitle: long(500), processSteps: Array.from({ length: 20 }, () => ({ title: long(200), body: long(900) })) } })
    expect(c.coverSubtitle).toHaveLength(MAX_TITLE_LENGTH)
    expect(c.processSteps).toHaveLength(MAX_ITEMS)
    expect(c.processSteps[0]!.title).toHaveLength(MAX_TITLE_LENGTH)
    expect(c.processSteps[0]!.body).toHaveLength(MAX_BODY_LENGTH)
  })

  it('an edit shows on the PDF', () => {
    const c = resolve({ proposalContent: { whyUsTitle: 'Why {company}?', whyUsItems: [{ title: 'Fast', body: 'Quick.' }] } })
    const t = text({ ...base, content: c })
    expect(t).toContain('|Why ARX?|')
    expect(t).toContain('|Fast|')
    expect(t).not.toContain('Complete Roofing Systems')
  })
})

describe('cover title', () => {
  const lawn = resolve({ profile: { id: 'lawn_landscape', version: 1 } })
  it('is the proposal\'s own title, uppercased', () => {
    expect(proposalCoverTitle('Siding Quote - Option A', lawn)).toBe('SIDING QUOTE - OPTION A')
    const t = text({ ...base, proposal: { ...base.proposal, title: 'Siding Quote - Option A' }, content: lawn })
    expect(t).toContain('|SIDING QUOTE - OPTION A|')
    expect(t).not.toContain('ROOFING PROPOSAL')
  })
  it('blank → the company\'s word', () => {
    expect(proposalCoverTitle('  ', resolve({ profile: { id: 'exterior_cleaning', version: 1 } }))).toBe('QUOTE')
    expect(proposalCoverTitle(undefined, resolve({}))).toBe('PROPOSAL')
  })
  it('a roofing proposal with the default title still prints ROOFING PROPOSAL', () => {
    expect(text({ ...base, content: resolve({}) })).toContain('|ROOFING PROPOSAL|')
  })
  it('details subtitle: roof wording only with a measurement', () => {
    const m = { total_squares: 1, total_area_sqft: 1, predominant_pitch: '6/12', facet_count: 1 }
    expect(text({ ...base, content: lawn })).toContain('|Property information and project details|')
    expect(text({ ...base, content: lawn, measurement: m })).toContain('|Property information and roof measurements|')
  })
})

describe('parseProposalContentPatch', () => {
  const d = defaultProposalContent('roofing')
  it('enforces caps', () => {
    expect(parseProposalContentPatch({ settings: { coverSubtitle: 'x'.repeat(81) } }, d)).toHaveProperty('error')
    expect(parseProposalContentPatch({ settings: { processSteps: [{ title: 'x'.repeat(81), body: '' }] } }, d)).toHaveProperty('error')
    expect(parseProposalContentPatch({ settings: { processSteps: [{ title: 'ok', body: 'x'.repeat(301) }] } }, d)).toHaveProperty('error')
    expect(parseProposalContentPatch({ settings: { whyUsItems: Array.from({ length: 9 }, () => ({ title: 'a', body: 'b' })) } }, d)).toHaveProperty('error')
    expect(parseProposalContentPatch({ settings: { processSteps: [{ title: '', body: 'no title' }] } }, d)).toHaveProperty('error')
    expect(parseProposalContentPatch({ settings: { nope: 'x' } }, d)).toHaveProperty('error')
    expect(parseProposalContentPatch({ settings: { coverSubtitle: 'x'.repeat(80) } }, d)).toHaveProperty('set')
  })
  it('a field equal to the default (or blank) is cleared so it keeps following the profile', () => {
    const r = parseProposalContentPatch({ settings: { coverSubtitle: d.coverSubtitle, processTitle: ' ', processSteps: d.processSteps, whyUsTitle: 'Mine' } }, d) as { set: object; remove: string[] }
    expect(r.set).toEqual({ whyUsTitle: 'Mine' })
    expect(r.remove.sort()).toEqual(['coverSubtitle', 'processSteps', 'processTitle'])
  })
  it('reset clears everything', () => {
    expect((parseProposalContentPatch({ reset: true }, d) as { remove: string[] }).remove).toHaveLength(6)
  })
})

describe('/api/admin/proposal-content', () => {
  const seed = () => ({
    orgs: [
      { id: 'org-1', name: 'One', settings: { profile: { id: 'lawn_landscape', version: 1 }, features: { a: 1 } } },
      { id: 'org-2', name: 'Two', settings: { keep: true } },
    ],
  })
  const setup = (superAdmin = true) => {
    const d = createFakeDb(seed(), {
      rpc: {
        merge_org_settings: (a, tables) => {
          const row = tables.orgs!.find((o) => o.id === a.p_org_id)
          if (!row) return { error: { message: 'no org' } }
          row.settings = mergeSettingsAt(row.settings, a.p_path as string[], a.p_set as Record<string, unknown>, a.p_remove as string[])
          return { data: null, error: null }
        },
      },
    })
    mockAdmin = d.client
    requireAuthApi.mockResolvedValue({ profile: { org_id: 'org-1', role: 'admin', is_super_admin: superAdmin, active: true } })
    return d
  }
  const req = (body: unknown, headers: Record<string, string> = {}) =>
    new Request('https://crm.example/api/admin/proposal-content', { method: 'PATCH', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

  it('owner saves; only this org\'s proposalContent changes, other keys and orgs are untouched', async () => {
    const d = setup()
    const res = (await PATCH(req({ settings: { whyUsTitle: 'Why us', processSteps: [{ title: 'Walk', body: 'We look.' }] } })))!
    expect(res.status).toBe(200)
    const orgs = d.tables.orgs as Array<{ id: string; settings: Record<string, unknown> }>
    expect(orgs[0]!.settings).toMatchObject({ profile: { id: 'lawn_landscape' }, features: { a: 1 }, proposalContent: { whyUsTitle: 'Why us', processSteps: [{ title: 'Walk', body: 'We look.' }] } })
    expect(orgs[1]!.settings).toEqual({ keep: true })
    const body = await res.json()
    expect(body.content.whyUsTitle).toBe('Why us')
    expect(JSON.stringify(body.defaults)).not.toMatch(/roof/i)
  })

  it('reset removes the saved keys', async () => {
    const d = setup()
    await PATCH(req({ settings: { whyUsTitle: 'Why us' } }))
    const res = (await PATCH(req({ reset: true })))!
    expect(res.status).toBe(200)
    expect(((d.tables.orgs as Array<{ settings: Record<string, unknown> }>)[0]!.settings).proposalContent).toEqual({})
  })

  it('not an owner → 403; not signed in → 401; cross-site write → 403; bad input → 400; nothing written', async () => {
    const d = setup(false)
    expect((await PATCH(req({ reset: true })))!.status).toBe(403)
    expect((await GET())!.status).toBe(403)
    setup(true)
    expect((await PATCH(req({ reset: true }, { origin: 'https://evil.example' })))!.status).toBe(403)
    expect((await PATCH(req({ settings: { coverSubtitle: 'x'.repeat(200) } })))!.status).toBe(400)
    requireAuthApi.mockRejectedValueOnce(new Error('no session'))
    expect((await PATCH(req({ reset: true })))!.status).toBe(401)
    expect(((d.tables.orgs as Array<{ settings: Record<string, unknown> }>)[0]!.settings).proposalContent).toBeUndefined()
  })

  it('mergeOrgSettings refuses proposalContent at the top level', async () => {
    const { mergeOrgSettings } = await import('@/lib/org-settings')
    const d = setup()
    expect((await mergeOrgSettings(d.client as never, 'org-1', { proposalContent: {} })).error).toMatch(/proposalContent/)
  })
})
