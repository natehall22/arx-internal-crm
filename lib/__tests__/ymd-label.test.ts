import { ymdLabel } from '@/lib/ymd-label'
test('labels a calendar day with no time zone shift', () => {
  expect(ymdLabel('2026-11-23')).toBe('Nov 23')
  expect(ymdLabel('2026-11-23', { weekday: true })).toBe('Mon, Nov 23')
  expect(ymdLabel('2026-03-01', { long: true })).toBe('Sunday, March 1')
  expect(ymdLabel('garbage')).toBe('garbage')
})
