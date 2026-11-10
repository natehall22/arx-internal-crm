/** @jest-environment node */
/** Which companies background jobs run for: active users only, inside the DEPLOYMENT_ORG_ID fence. */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'
import { loadCronOrgIds, loadCronOrgs, loadOrgTimeZone, orgTimeZone } from '@/lib/cron-orgs'

const REAL = 'aaaaaaaa-0000-4000-8000-000000000001'
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002'
const TEST_ORG = 'aaaaaaaa-0000-4000-8000-000000000003' // like prod's "ARX Measure Test Org …": 1 inactive user
const EMPTY = 'aaaaaaaa-0000-4000-8000-000000000004' // no users at all
const ENV = { ...process.env }

function seed() {
  return createFakeDb({
    orgs: [
      { id: REAL, settings: { a: 1 }, timezone: null },
      { id: OTHER, settings: null, timezone: 'America/Chicago' },
      { id: TEST_ORG, settings: null, timezone: 'Not/AZone' },
      { id: EMPTY, settings: null, timezone: null },
    ],
    users: [
      { id: 'u1', org_id: REAL, active: true },
      { id: 'u2', org_id: OTHER, active: true },
      { id: 'u3', org_id: TEST_ORG, active: false },
    ],
  })
}

beforeEach(() => { process.env = { ...ENV }; delete process.env.DEPLOYMENT_ORG_ID })
afterAll(() => { process.env = ENV })

test('only companies with an active user (test / empty orgs never run)', async () => {
  const db = seed()
  const orgs = await loadCronOrgs(db.client as never)
  expect(orgs.map((o) => o.id).sort()).toEqual([REAL, OTHER].sort())
  expect(orgs.find((o) => o.id === REAL)).toEqual({ id: REAL, settings: { a: 1 }, timezone: DEFAULT_TIMEZONE })
  expect(orgs.find((o) => o.id === OTHER)!.timezone).toBe('America/Chicago')
})

test('DEPLOYMENT_ORG_ID fence: a copy only ever runs its own company', async () => {
  process.env.DEPLOYMENT_ORG_ID = OTHER
  expect(Array.from(await loadCronOrgIds(seed().client as never))).toEqual([OTHER])
  process.env.DEPLOYMENT_ORG_ID = TEST_ORG // fenced to a company with no active users → nothing
  expect((await loadCronOrgIds(seed().client as never)).size).toBe(0)
})

test('active users are paged, never cut at 1,000 rows', async () => {
  const users = Array.from({ length: 1500 }, (_, i) => ({ id: `u${String(i).padStart(5, '0')}`, org_id: REAL, active: true }))
  users.push({ id: 'u99999', org_id: OTHER, active: true }) // sorts last: only seen on page 2
  const db = createFakeDb({ orgs: [{ id: REAL, settings: null, timezone: null }, { id: OTHER, settings: null, timezone: null }], users })
  expect((await loadCronOrgIds(db.client as never)).has(OTHER)).toBe(true)
})

test('a bad or blank time zone falls back to the default instead of crashing a run', async () => {
  expect(orgTimeZone('Not/AZone')).toBe(DEFAULT_TIMEZONE)
  expect(orgTimeZone('')).toBe(DEFAULT_TIMEZONE)
  expect(orgTimeZone(42)).toBe(DEFAULT_TIMEZONE)
  expect(orgTimeZone(' America/Denver ')).toBe('America/Denver')
  expect(await loadOrgTimeZone(seed().client as never, OTHER)).toBe('America/Chicago')
  expect(await loadOrgTimeZone(seed().client as never, 'missing')).toBe(DEFAULT_TIMEZONE)
})

test('an orgs read error throws (callers retry / fail the run) rather than silently running zero companies', async () => {
  const client = { from: () => ({ select: () => ({ order: async () => ({ data: null, error: { message: 'boom' } }) }) }) }
  await expect(loadCronOrgs(client as never)).rejects.toThrow('boom')
})
