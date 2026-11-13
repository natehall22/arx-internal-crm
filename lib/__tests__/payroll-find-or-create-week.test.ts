/**
 * One live pay week per cutoff (2026-11-13 incident: the morning cron made "Week ending 2026-11-08", "(2)" and "(3)" in
 * 150 ms because every re-read after an insert came back from Next's fetch cache as the first, empty answer, and each miss
 * moved on to the next suffixed label).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { findOrCreateWeek } from '@/lib/payroll-periods'
import { weekCutoffContaining, type PayWeekSchedule } from '@/lib/payroll-week-schedule'

const ORG = 'org1'
const S = { weekStartDay: 1, cutoffTime: '23:59', paydayWeekday: 5, lateFunding: { weekday: 3, time: '23:59' }, timeZone: 'America/New_York' } as unknown as PayWeekSchedule
const TARGET = new Date('2026-11-09T04:59:59.999Z')
const LABEL = 'Week ending 2026-11-08'
const UNIQUE = { payroll_periods: [['org_id', 'period_label'], ['org_id', 'cutoff_at']] }

const live = () => (rows: Array<Record<string, unknown>>) => rows.filter((r) => r.status !== 'cancelled')

/** A client whose payroll_periods reads keep answering with the FIRST result they saw (the cached-GET failure). */
function staleReads(client: SupabaseClient): SupabaseClient {
  let frozen: unknown = null
  return new Proxy(client, {
    get(target, prop) {
      if (prop !== 'from') return Reflect.get(target, prop)
      return (table: string) => {
        const b = target.from(table)
        if (table !== 'payroll_periods') return b
        const realSelect = b.select.bind(b)
        return Object.assign(b, {
          select: (...args: Parameters<typeof b.select>) => {
            const q = realSelect(...args)
            const realLimit = (q as unknown as { limit: (n: number) => Promise<unknown> }).limit.bind(q)
            ;(q as unknown as { limit: (n: number) => Promise<unknown> }).limit = async (n: number) => {
              const res = await realLimit(n)
              if (frozen === null) frozen = res
              return frozen
            }
            return q
          },
        })
      }
    },
  }) as SupabaseClient
}

describe('findOrCreateWeek', () => {
  it('sanity: the target is the company week cutoff', () => {
    expect(weekCutoffContaining(new Date('2026-11-05T12:00:00Z'), S).toISOString()).toBe(TARGET.toISOString())
  })

  it('creates the week once and returns the inserted row without re-reading', async () => {
    const db = createFakeDb({ payroll_periods: [] }, { unique: UNIQUE })
    const row = await findOrCreateWeek(db.client, ORG, TARGET, S)
    expect(db.tables.payroll_periods).toHaveLength(1)
    expect(row.id).toBe(db.tables.payroll_periods[0].id)
    expect(db.tables.payroll_periods[0]).toMatchObject({ period_label: LABEL, status: 'open', cutoff_at: TARGET.toISOString() })
  })

  it('the 2026-11-13 incident: re-reads stuck on the first empty answer still make ONE week', async () => {
    const db = createFakeDb({ payroll_periods: [] }, { unique: UNIQUE })
    const client = staleReads(db.client)
    const a = await findOrCreateWeek(client, ORG, TARGET, S)
    // A second caller in the same stale context: its insert hits the key, it never steps to "(2)".
    await expect(findOrCreateWeek(client, ORG, TARGET, S)).rejects.toThrow(/already used/)
    expect(db.tables.payroll_periods).toHaveLength(1)
    expect(db.tables.payroll_periods.map((r) => r.period_label)).toEqual([LABEL])
    expect(a.id).toBe(db.tables.payroll_periods[0].id)
  })

  it('many callers at once (page + API loaders, crons): one live week, everyone gets the same id', async () => {
    const db = createFakeDb({ payroll_periods: [] }, { unique: UNIQUE })
    const rows = await Promise.all(Array.from({ length: 6 }, () => findOrCreateWeek(db.client, ORG, TARGET, S)))
    expect(live()(db.tables.payroll_periods)).toHaveLength(1)
    expect(new Set(rows.map((r) => r.id)).size).toBe(1)
  })

  it('an existing live week is returned, nothing written', async () => {
    const db = createFakeDb({ payroll_periods: [{ id: 'w', org_id: ORG, status: 'open', cutoff_at: TARGET.toISOString(), period_label: LABEL, scheduled_pay_date: '2026-11-13', created_at: '2026-11-10T00:00:00Z' }] }, { unique: UNIQUE })
    const row = await findOrCreateWeek(db.client, ORG, TARGET, S)
    expect(row.id).toBe('w')
    expect(db.writes).toHaveLength(0)
  })

  it('a CANCELLED week holding the label: the new week takes the next free suffix', async () => {
    const cancelled = (id: string, label: string) => ({ id, org_id: ORG, status: 'cancelled', cutoff_at: '2026-11-06T04:59:59.999Z', period_label: label, scheduled_pay_date: '2026-11-13', created_at: '2026-11-01T00:00:00Z' })
    const one = createFakeDb({ payroll_periods: [cancelled('c1', LABEL)] }, { unique: { payroll_periods: [['org_id', 'period_label']] } })
    await findOrCreateWeek(one.client, ORG, TARGET, S)
    expect(live()(one.tables.payroll_periods).map((r) => r.period_label)).toEqual([`${LABEL} (2)`])

    const two = createFakeDb({ payroll_periods: [cancelled('c1', LABEL), cancelled('c2', `${LABEL} (2)`)] }, { unique: { payroll_periods: [['org_id', 'period_label']] } })
    await findOrCreateWeek(two.client, ORG, TARGET, S)
    expect(live()(two.tables.payroll_periods).map((r) => r.period_label)).toEqual([`${LABEL} (3)`])
  })

  it('a LIVE week of another cutoff holding the label is never stepped past (no suffixed copy)', async () => {
    const db = createFakeDb({ payroll_periods: [{ id: 'x', org_id: ORG, status: 'open', cutoff_at: '2026-10-01T04:59:59.999Z', period_label: LABEL, scheduled_pay_date: '2026-10-03', created_at: '2026-10-01T00:00:00Z' }] }, { unique: { payroll_periods: [['org_id', 'period_label']] } })
    await expect(findOrCreateWeek(db.client, ORG, TARGET, S)).rejects.toThrow(/already used/)
    expect(db.tables.payroll_periods).toHaveLength(1)
  })

  it('another company with the same label does not block or suffix ours', async () => {
    const db = createFakeDb({ payroll_periods: [{ id: 'o', org_id: 'org2', status: 'cancelled', cutoff_at: TARGET.toISOString(), period_label: LABEL, scheduled_pay_date: '2026-11-13', created_at: '2026-11-01T00:00:00Z' }] }, { unique: { payroll_periods: [['org_id', 'period_label']] } })
    await findOrCreateWeek(db.client, ORG, TARGET, S)
    expect(db.tables.payroll_periods.filter((r) => r.org_id === ORG).map((r) => r.period_label)).toEqual([LABEL])
  })
})

describe('service client fetch (root cause: Next.js cached the re-read)', () => {
  it('every request opts out of the Data Cache and the per-render GET dedupe; a caller signal is kept', async () => {
    const seen: RequestInit[] = []
    const real = global.fetch
    global.fetch = (async (_i: unknown, init?: RequestInit) => { seen.push(init ?? {}); return {} as Response }) as typeof fetch
    try {
      const { noStoreFetch } = await import('@/lib/supabase/service')
      await noStoreFetch('https://x.test/rest/v1/payroll_periods', { method: 'GET' })
      const own = new AbortController().signal
      await noStoreFetch('https://x.test/rest/v1/payroll_periods', { signal: own })
      expect(seen[0].cache).toBe('no-store')
      expect(seen[0].signal).toBeTruthy()
      expect(seen[1].signal).toBe(own)
    } finally {
      global.fetch = real
    }
  })
})
