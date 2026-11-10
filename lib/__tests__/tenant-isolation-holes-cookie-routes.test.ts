/** @jest-environment node */
/**
 * Cross-company holes in routes that still parse the session cookie themselves (Known Redundancy #3b — their auth is
 * NOT changed here). The fixes only add the company check. Company A's admin / user names company B's row → nothing.
 */
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'

let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u-a', email: 'a@example.test' } }, error: null }) } }),
}))
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u-a', email: 'a@example.test' } } }) } }),
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u-a', email: 'a@example.test' } } }) } }),
}))
jest.mock('@/lib/google-calendar', () => ({
  createCalendarEvent: jest.fn(async () => ({ id: 'ev' })),
  deleteCalendarEvent: jest.fn(),
  updateCalendarEvent: jest.fn(),
  refreshAccessToken: jest.fn(),
  getFreeBusy: jest.fn(async () => []),
  checkAvailability: jest.fn(async () => true),
  getAvailableSlots: jest.fn(async () => []),
}))
jest.mock('@/lib/setter-email', () => ({ sendSetterEmail: jest.fn(), getCrmEmailFrom: () => 'x@example.test', getMailTransport: () => null }))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail: jest.fn() }) } }))

import { GET as getPricing } from '@/app/api/admin/pricing/route'
import { POST as postProposalAdmin } from '@/app/api/admin/proposals/route'
import { POST as postCalendarSync, GET as getCalendarSync } from '@/app/api/calendar/sync/route'
import { POST as postScheduleClose } from '@/app/api/inspections/schedule-close/route'

const cookie = `sb-proj-auth-token=${encodeURIComponent(JSON.stringify({ access_token: 'tok' }))}`
const req = (url: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(url, {
    method: init.method ?? 'GET',
    headers: { cookie, 'content-type': 'application/json', authorization: 'Bearer tok' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })

beforeEach(() => {
  db = createFakeDb({
    users: [
      { id: 'u-a', org_id: 'org-a', role: 'admin', full_name: 'A Admin' },
      { id: 'u-b', org_id: 'org-b', role: 'closer', full_name: 'B Closer' },
    ],
    pricebooks: [{ id: 'pb-a', org_id: 'org-a', name: 'A book', is_default: true }],
    pricebook_items: [{ id: 'pi-b', org_id: 'org-b', pricebook_id: 'pb-b', name: 'B secret cost', cost: 99 }],
    proposal_templates: [{ id: 't-b', org_id: 'org-b', name: 'B template' }],
    scheduled_appointments: [{ id: 'appt-b', org_id: 'org-b', lead_id: 'lead-b', status: 'scheduled', scheduled_for: '2026-11-20T15:00:00Z' }],
    user_google_tokens: [{ id: 'tok-b', org_id: 'org-b', user_id: 'u-b', access_token: 'g', expires_at: '2999-01-01T00:00:00Z' }],
  })
})

test("admin/pricing: another company's pricebook id returns none of its items", async () => {
  const res = await getPricing(req('https://crm.example/api/admin/pricing?pricebook_id=pb-b'))
  expect(res.status).toBe(200)
  expect(JSON.stringify(await res.json())).not.toContain('B secret cost')
})

test("admin/proposals: updating a template id from another company changes nothing of theirs", async () => {
  await postProposalAdmin(req('https://crm.example/api/admin/proposals', { method: 'POST', body: { type: 'template', data: { id: 't-b', name: 'pwned' } } }))
  expect(db.tables.proposal_templates).toEqual([{ id: 't-b', org_id: 'org-b', name: 'B template' }])
})

test("calendar/sync: another company's closer → 404, no event on their calendar", async () => {
  const gc = jest.requireMock('@/lib/google-calendar') as { createCalendarEvent: jest.Mock }
  const post = await postCalendarSync(
    req('https://crm.example/api/calendar/sync', { method: 'POST', body: { closer_user_id: 'u-b', scheduled_for: '2026-11-20T15:00:00Z' } })
  )
  expect(post.status).toBe(404)
  expect(gc.createCalendarEvent).not.toHaveBeenCalled()
  const get = await getCalendarSync(req('https://crm.example/api/calendar/sync?closer_user_id=u-b&action=slots&date=2026-11-20'))
  expect(get.status).toBe(404)
})

test("inspections/schedule-close: another company's appointment → 404, nothing written", async () => {
  const res = await postScheduleClose(
    req('https://crm.example/api/inspections/schedule-close', { method: 'POST', body: { original_appointment_id: 'appt-b', scheduled_for: '2026-11-21T10:00' } })
  )
  expect(res.status).toBe(404)
  expect(db.writes).toEqual([])
})
