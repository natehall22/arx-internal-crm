/** @jest-environment node */
/** "Today" for the daily log and selection due dates is the COMPANY's day (orgs.timezone), across both DST changes. */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { orgTodayYmd } from '@/lib/project-tools/org-today'

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const at = (tz: string | null) => createFakeDb({ orgs: [{ id: A, timezone: tz }] }).client as never

test('late evening in Denver is still that day, though UTC has moved on', async () => {
  expect(await orgTodayYmd(at('America/Denver'), A, new Date('2026-07-02T03:30:00Z'))).toBe('2026-07-01')
})

test('spring forward (Mar 8 2026, Denver): the day boundary follows the zone, not a fixed offset', async () => {
  expect(await orgTodayYmd(at('America/Denver'), A, new Date('2026-03-08T06:59:00Z'))).toBe('2026-03-07') // 23:59 MST
  expect(await orgTodayYmd(at('America/Denver'), A, new Date('2026-03-08T07:00:00Z'))).toBe('2026-03-08') // 00:00 MST
})

test('fall back (Nov 1 2026, Denver)', async () => {
  expect(await orgTodayYmd(at('America/Denver'), A, new Date('2026-11-01T05:59:00Z'))).toBe('2026-10-31') // 23:59 MDT
  expect(await orgTodayYmd(at('America/Denver'), A, new Date('2026-11-01T06:00:00Z'))).toBe('2026-11-01') // 00:00 MDT
})

test('Sydney is a day ahead of UTC', async () => {
  expect(await orgTodayYmd(at('Australia/Sydney'), A, new Date('2026-11-10T20:00:00Z'))).toBe('2026-11-11')
})
