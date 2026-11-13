/** @jest-environment node */
/**
 * Codex audit 2026-11-13 #11: a close time typed as local wall clock ("2026-03-08T10:00") is the COMPANY's wall clock
 * (orgs.timezone), not a fixed zone. New York unchanged; DST on both 2026 clock-change Sundays.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: () => {
    const c = db.client as unknown as { from: (t: string) => unknown }
    return { from: (t: string) => c.from(t), auth: { getUser: async () => ({ data: { user: { id: 'u-closer' } } }) } }
  },
}))
jest.mock('@/lib/google-calendar', () => ({ createCalendarEvent: jest.fn(), refreshAccessToken: jest.fn() }))
jest.mock('@/lib/setter-email', () => ({ sendSetterEmail: jest.fn() }))
jest.mock('@/lib/round-robin', () => ({ assignNextAvailableCloser: jest.fn(), getDefaultTeam: jest.fn() }))
jest.mock('@/lib/org-appointment-types', () => ({
  fetchOrgAppointmentTypesFromTable: async () => [],
  getCloseSlotBufferAfterFromTable: () => 15,
  getCloseSlotDurationFromTable: () => 60,
}))

import { POST } from '@/app/api/inspections/schedule-close/route'

function seed(timezone: string | null) {
  db = createFakeDb({
    orgs: [{ id: 'org-a', timezone, inspection_feedback_buffer_minutes: 0, default_scheduling_gap_minutes: 15 }],
    users: [{ id: 'u-closer', org_id: 'org-a', full_name: 'Cal Closer', active: true, google_calendar_id: null, google_refresh_token: null }],
    scheduled_appointments: [
      { id: 'appt-1', org_id: 'org-a', lead_id: 'lead-1', opportunity_id: 'opp-1', closer_user_id: 'u-closer', canvasser_user_id: null, scheduled_for: '2026-03-01T15:00:00Z', address_text: '1 Main', duration_minutes: 60, leads: { homeowner_name: 'Pat' } },
    ],
  })
}

async function storedFor(timezone: string | null, wall: string): Promise<string> {
  seed(timezone)
  const res = await POST(new Request('https://crm.example/api/inspections/schedule-close', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ original_appointment_id: 'appt-1', scheduled_for: wall }),
  }) as never)
  expect(res.status).toBe(200)
  const row = db.tables.scheduled_appointments.find((r) => r.appointment_type === 'close')!
  return new Date(String(row.scheduled_for)).toISOString()
}

describe('schedule-close reads the typed time on the company clock', () => {
  it('March (spring forward day)', async () => {
    expect(await storedFor('America/New_York', '2026-03-08T10:00')).toBe('2026-03-08T14:00:00.000Z')
    expect(await storedFor('America/Chicago', '2026-03-08T10:00')).toBe('2026-03-08T15:00:00.000Z')
  })
  it('November (fall back day)', async () => {
    expect(await storedFor('America/New_York', '2026-11-01T10:00')).toBe('2026-11-01T15:00:00.000Z')
    expect(await storedFor('America/Chicago', '2026-11-01T10:00')).toBe('2026-11-01T16:00:00.000Z')
  })
  it('no / invalid zone = the default, as before', async () => {
    expect(await storedFor(null, '2026-11-01T10:00')).toBe('2026-11-01T15:00:00.000Z')
    expect(await storedFor('Not/AZone', '2026-03-08T10:00')).toBe('2026-03-08T14:00:00.000Z')
  })
  it('an explicit instant is kept as sent', async () => {
    expect(await storedFor('America/Chicago', '2026-11-01T10:00:00Z')).toBe('2026-11-01T10:00:00.000Z')
  })
})
