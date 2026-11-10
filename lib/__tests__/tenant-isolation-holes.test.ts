/** @jest-environment node */
/**
 * Cross-company holes found by scripts/org-scope-check.mjs (2026-11-10). Every company shares ONE database and these
 * routes use the service client (no row-level security), so each one took an id from the request and acted on it in
 * whatever company owned it. Each test: company A's user names company B's row → refused, and nothing of B's changes.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let authResult: unknown = null
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => {
    if (!authResult) throw new Error('Unauthorized')
    return authResult
  }),
}))
let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/effective-permissions', () => ({ resolveEffectivePermissionNames: jest.fn(async () => ['customers:edit']) }))
jest.mock('@/lib/permissions', () => ({ canEditCustomerRecordsFromPermissionNames: () => true }))
jest.mock('@/lib/closer-briefing-email', () => ({ sendCloserBriefingEmail: jest.fn() }))
jest.mock('@/lib/google-calendar', () => ({
  createCalendarEvent: jest.fn(),
  deleteCalendarEvent: jest.fn(),
  refreshAccessToken: jest.fn(),
  getFreeBusy: jest.fn(async () => []),
}))
jest.mock('@/lib/setter-email', () => ({ sendSetterEmail: jest.fn() }))

import { POST as linkCustomer } from '@/app/api/customers/link/route'
import { PUT as putCoachingGoals } from '@/app/api/coaching/goals/route'
import { POST as postInspectionResult } from '@/app/api/opportunities/[id]/inspection-result/route'
import { POST as postReschedule } from '@/app/api/inspections/reschedule/route'
import { GET as getAvailability } from '@/app/api/canvass/availability/route'

const as = (role: string) => ({
  authUser: { id: 'u-a', email: null },
  profile: { id: 'u-a', org_id: 'org-a', role, full_name: 'A User', is_super_admin: false },
})
const json = (url: string, body: unknown, method = 'POST') =>
  new Request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never

beforeEach(() => {
  authResult = as('admin')
  db = createFakeDb({
    users: [
      { id: 'u-a', org_id: 'org-a', role: 'admin' },
      { id: 'u-a2', org_id: 'org-a', role: 'sales_rep' },
      { id: 'u-b', org_id: 'org-b', role: 'sales_rep' },
      { id: '00000000-0000-4000-8000-00000000000b', org_id: 'org-b', role: 'closer' },
    ],
    customers: [
      { id: 'cust-a', org_id: 'org-a', name: 'A Customer' },
      { id: 'cust-b', org_id: 'org-b', name: 'B Customer', phone: '555-0100' },
    ],
    projects: [{ id: 'proj-a', org_id: 'org-a', customer_id: null }],
    opportunities: [
      { id: 'opp-a', org_id: 'org-a', owner_user_id: 'u-a' },
      { id: 'opp-b', org_id: 'org-b', owner_user_id: 'u-b' },
    ],
    inspection_results: [{ id: 'ir-b', org_id: 'org-b', opportunity_id: 'opp-b', outcome: 'moving_to_close' }],
    coaching_goals: [{ id: 'g-b', org_id: 'org-b', user_id: 'u-b', annual_income_goal: 100000 }],
    scheduled_appointments: [
      { id: 'appt-b', org_id: 'org-b', lead_id: 'lead-b', closer_user_id: 'u-b', status: 'scheduled', scheduled_for: '2026-11-20T15:00:00Z' },
    ],
  })
})

describe('customers/link', () => {
  test("an unknown action can no longer link (and return) another company's customer", async () => {
    const res = await linkCustomer(
      json('https://crm.example/api/customers/link', { action: 'bogus', customer_id: 'cust-b', source_type: 'project', source_id: 'proj-a' })
    )
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).not.toContain('B Customer')
    expect(db.writes).toEqual([])
    expect(db.tables.projects[0].customer_id).toBeNull()
  })

  test("link with another company's customer → 404, nothing written", async () => {
    const res = await linkCustomer(
      json('https://crm.example/api/customers/link', { action: 'link', customer_id: 'cust-b', source_type: 'project', source_id: 'proj-a' })
    )
    expect(res.status).toBe(404)
    expect(db.writes).toEqual([])
  })

  test('link within the company still works and returns the customer', async () => {
    const res = await linkCustomer(
      json('https://crm.example/api/customers/link', { action: 'link', customer_id: 'cust-a', source_type: 'project', source_id: 'proj-a' })
    )
    expect(res.status).toBe(200)
    expect((await res.json()).customer).toMatchObject({ id: 'cust-a' })
    expect(db.tables.projects[0].customer_id).toBe('cust-a')
  })
})

describe('coaching/goals PUT', () => {
  test("a manager cannot overwrite (and re-home) another company's user's goals", async () => {
    authResult = as('sales_manager')
    const res = await putCoachingGoals(json('https://crm.example/api/coaching/goals', { userId: 'u-b', annual_income_goal: 1 }, 'PUT'))
    expect(res.status).toBe(404)
    expect(db.writes).toEqual([])
    expect(db.tables.coaching_goals).toEqual([expect.objectContaining({ id: 'g-b', org_id: 'org-b', annual_income_goal: 100000 })])
  })

  test("a manager still sets a teammate's goals", async () => {
    authResult = as('sales_manager')
    const res = await putCoachingGoals(json('https://crm.example/api/coaching/goals', { userId: 'u-a2', annual_income_goal: 5 }, 'PUT'))
    expect(res.status).toBe(200)
    expect(db.writes.find((w) => w.table === 'coaching_goals')?.rows[0]).toMatchObject({ org_id: 'org-a', user_id: 'u-a2' })
  })
})

describe('opportunities/[id]/inspection-result POST', () => {
  test("another company's opportunity → 404; its inspection result is untouched", async () => {
    const res = await postInspectionResult(
      json('https://crm.example/api/opportunities/opp-b/inspection-result', { outcome: 'not_interested' }),
      { params: { id: 'opp-b' } }
    )
    expect(res.status).toBe(404)
    expect(db.writes).toEqual([])
    expect(db.tables.inspection_results).toEqual([expect.objectContaining({ id: 'ir-b', org_id: 'org-b', outcome: 'moving_to_close' })])
  })

  test('own opportunity still saves', async () => {
    const res = await postInspectionResult(
      json('https://crm.example/api/opportunities/opp-a/inspection-result', { outcome: 'not_interested' }),
      { params: { id: 'opp-a' } }
    )
    expect(res.status).toBe(200)
    expect(db.writes.find((w) => w.table === 'inspection_results')?.rows[0]).toMatchObject({ org_id: 'org-a', opportunity_id: 'opp-a' })
  })
})

describe('inspections/reschedule POST', () => {
  test("another company's appointment → 404; not cancelled, nothing created", async () => {
    const res = await postReschedule(
      json('https://crm.example/api/inspections/reschedule', { original_appointment_id: 'appt-b', new_scheduled_for: '2026-11-21T10:00' })
    )
    expect(res.status).toBe(404)
    expect(db.writes).toEqual([])
    expect(db.tables.scheduled_appointments[0]).toMatchObject({ id: 'appt-b', status: 'scheduled' })
  })
})

describe('canvass/availability GET', () => {
  test("another company's closer → 404 (their calendar and booked times are not read)", async () => {
    const res = await getAvailability({
      nextUrl: new URL('https://crm.example/api/canvass/availability?closer_id=00000000-0000-4000-8000-00000000000b&date=2026-11-20'),
    } as never)
    expect(res.status).toBe(404)
  })
})
