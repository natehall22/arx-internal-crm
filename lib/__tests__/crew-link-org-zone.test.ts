/**
 * A crew link expires on its OWN company's calendar day (orgs.timezone), not a fixed zone (Codex audit #12).
 * Both clock changes: the last good day is the spring-forward Sunday (2026-03-08) and the fall-back Sunday (2026-11-01).
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { resolveCrewLink } from '@/lib/crew-link'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'

const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz'
const CENTRAL = 'America/Chicago'

function db(timezone: string, scheduledDate: string) {
  return createFakeDb({
    orgs: [{ id: 'org1', timezone }],
    work_orders: [{ id: 'wo1', org_id: 'org1', job_id: 'job1', trade: 'roofing', status: 'scheduled', scheduled_date: scheduledDate, install_days: 1, assigned_sub_id: 'sub1', crew_link_token: TOKEN }],
    production_jobs: [{ id: 'job1', org_id: 'org1', job_number: '26-0001', address_text: '1 Main St', cancelled_at: null }],
  }).client
}

async function reasonAt(iso: string, timezone: string, scheduledDate: string) {
  jest.useFakeTimers().setSystemTime(new Date(iso))
  try {
    const r = await resolveCrewLink(db(timezone, scheduledDate), TOKEN)
    return r.ok ? 'ok' : r.reason
  } finally {
    jest.useRealTimers()
  }
}

describe('crew link expiry uses the company zone', () => {
  // Scheduled 2026-02-06 → 30-day grace → last good day 2026-03-08 (spring forward).
  it('March: 00:30 Mar 9 in New York is still 23:30 Mar 8 in Chicago', async () => {
    expect(await reasonAt('2026-03-09T04:30:00Z', DEFAULT_TIMEZONE, '2026-02-06')).toBe('expired')
    expect(await reasonAt('2026-03-09T04:30:00Z', CENTRAL, '2026-02-06')).toBe('ok')
    expect(await reasonAt('2026-03-09T05:30:00Z', CENTRAL, '2026-02-06')).toBe('expired')
  })

  // Scheduled 2026-10-02 → last good day 2026-11-01 (fall back).
  it('November: 00:30 Nov 2 in New York is still 23:30 Nov 1 in Chicago', async () => {
    expect(await reasonAt('2026-11-02T05:30:00Z', DEFAULT_TIMEZONE, '2026-10-02')).toBe('expired')
    expect(await reasonAt('2026-11-02T04:30:00Z', DEFAULT_TIMEZONE, '2026-10-02')).toBe('ok')
    expect(await reasonAt('2026-11-02T05:30:00Z', CENTRAL, '2026-10-02')).toBe('ok')
    expect(await reasonAt('2026-11-02T06:30:00Z', CENTRAL, '2026-10-02')).toBe('expired')
  })

  it('a company with no zone saved keeps the default (unchanged for the original company)', async () => {
    expect(await reasonAt('2026-03-09T04:30:00Z', '', '2026-02-06')).toBe('expired')
    expect(await reasonAt('2026-03-09T03:30:00Z', '', '2026-02-06')).toBe('ok')
  })
})
