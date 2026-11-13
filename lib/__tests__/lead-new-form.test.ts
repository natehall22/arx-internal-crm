/** @jest-environment node */
/** The New Lead screen's additions: the service field, the profile's name wording, the owner bell. */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { createLeadRecord } from '@/lib/leads-create'
import { insertNewLeadBell } from '@/lib/lead-intake-db'
import { BASE_TERMS, INDUSTRY_PROFILES } from '@/lib/industry-profiles'
import { t } from '@/lib/org-profile'

const ORG = '11111111-1111-4111-8111-111111111111'
const U = '00000000-0000-4000-8000-000000000001'

describe('createLeadRecord service_requested', () => {
  test('stored when given, trimmed; absent when blank', async () => {
    const db = createFakeDb({ leads: [], activities: [], customers: [] })
    const a = await createLeadRecord(db.client as never, ORG, U, { homeowner_name: 'Pat', phone: '5551110000', service_requested: '  Weekly lawn care ' })
    const b = await createLeadRecord(db.client as never, ORG, U, { homeowner_name: 'Lee', phone: '5552220000', service_requested: '   ' })
    expect(a.ok && b.ok).toBe(true)
    const rows = db.tables.leads
    expect(rows[0].service_requested).toBe('Weekly lawn care')
    expect('service_requested' in rows[1]).toBe(false)
  })
})

describe('name label wording', () => {
  test('roofing (the base) keeps exactly "Homeowner Name"; lawn says Customer / company', () => {
    expect(t({ terms: BASE_TERMS } as never, 'leadName')).toBe('Homeowner Name')
    expect(INDUSTRY_PROFILES.lawn_landscape.terms.leadName).toMatch(/Customer/)
  })
})

describe('insertNewLeadBell', () => {
  test('one new_lead bell linking to the lead', async () => {
    const db = createFakeDb({ notifications: [] })
    await insertNewLeadBell(db.client as never, { orgId: ORG, userId: U, leadId: 'L1', title: 'New Lead', body: 'x' })
    expect(db.tables.notifications[0]).toMatchObject({ type: 'new_lead', recipient_user_id: U, link_url: '/leads/L1' })
  })
})

import { dropInactiveFromRotations, matchServiceChoice, patchSinglePersonIds, type LeadIntakePatch } from '@/lib/lead-intake'

describe('matchServiceChoice', () => {
  const choices = ['Weekly lawn care', 'Pressure washing']
  test('matches ignoring case and spacing, returns the choice as written; anything else is null', () => {
    expect(matchServiceChoice('  pressure   WASHING ', choices)).toBe('Pressure washing')
    expect(matchServiceChoice('Gutters', choices)).toBeNull()
    expect(matchServiceChoice('', choices)).toBeNull()
    expect(matchServiceChoice('Weekly lawn care', [])).toBeNull()
  })
})

describe('dropInactiveFromRotations', () => {
  const patch: LeadIntakePatch = {
    set: { mode: 'rotate', userIds: ['a', 'gone'], rules: [{ service: 'Mulch', userIds: ['gone', 'b'] }] },
    leadOwnerId: 'a',
    sources: [{ id: 's1', routing: { mode: 'rotate', userIds: ['gone', 'b'], rules: [], categoryRules: [] }, autoAssignUserId: 'b' }],
  }
  test('quietly removes inactive people from every list and says who', () => {
    const { patch: out, removed } = dropInactiveFromRotations(patch, (id) => id !== 'gone')
    expect(out.set.userIds).toEqual(['a'])
    expect((out.set.rules as Array<{ userIds: string[] }>)[0].userIds).toEqual(['b'])
    expect(out.sources[0].routing?.userIds).toEqual(['b'])
    expect(removed).toEqual(['gone'])
  })
  test('single-person pickers are checked separately (they must be active)', () => {
    expect(patchSinglePersonIds(patch).sort()).toEqual(['a', 'b'])
  })
})
