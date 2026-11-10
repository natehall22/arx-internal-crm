/** @jest-environment node */
/**
 * A signed-in auth user with NO users row used to be "self-healed" into whatever company owned the appointment / lead
 * id the request named (inspections/status, appointments/[id], inspections/schedule-close) — and then act inside that
 * company. On a shared database that is a cross-company join. Now: no profile → refused, nothing read or written.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/supabase-api-request-auth', () => ({
  getAccessTokenFromApiRequest: () => 'tok',
  resolveApiRequestAuthUser: async () => ({ user: { id: 'stranger', email: 's@example.test' }, accessToken: 'tok' }),
}))
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'stranger', email: 's@example.test' } }, error: null }) } }),
}))
jest.mock('@/lib/google-calendar', () => ({
  createCalendarEvent: jest.fn(),
  updateCalendarEvent: jest.fn(),
  deleteCalendarEvent: jest.fn(),
  refreshAccessToken: jest.fn(),
}))
jest.mock('@/lib/setter-email', () => ({ sendSetterEmail: jest.fn(), getCrmEmailFrom: () => 'x@example.test', getMailTransport: () => null }))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail: jest.fn() }) } }))

import { POST as postStatus } from '@/app/api/inspections/status/route'
import { GET as getAppointment } from '@/app/api/appointments/[id]/route'

beforeEach(() => {
  db = createFakeDb({
    users: [{ id: 'u-b', org_id: 'org-b', role: 'sales_rep' }],
    scheduled_appointments: [{ id: 'appt-b', org_id: 'org-b', lead_id: 'lead-b', status: 'scheduled' }],
    leads: [{ id: 'lead-b', org_id: 'org-b', homeowner_name: 'B Homeowner' }],
  })
})

test('inspections/status: no profile → 400, not joined to the appointment\'s company', async () => {
  const req = new Request('https://crm.example/api/inspections/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appointment_id: 'appt-b', outcome: 'not_interested' }),
  })
  const res = await postStatus(req as never)
  expect(res.status).toBe(400)
  expect(db.writes).toEqual([])
  expect(db.tables.users.map((u) => u.id)).toEqual(['u-b'])
})

test('appointments/[id]: no profile → 404, the appointment is not returned', async () => {
  const res = await getAppointment(new Request('https://crm.example/api/appointments/appt-b') as never, { params: { id: 'appt-b' } })
  expect(res.status).toBe(404)
  expect(JSON.stringify(await res.json())).not.toContain('B Homeowner')
  expect(db.writes).toEqual([])
})
