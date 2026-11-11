/** Typed vs clocked hours (lib/payroll-hours.ts planHoursWrite): the clock never writes 0 over typed hours, a typed
 * save never replaces clock hours, typed hours are kept aside and come back when the clock time goes away. */
import { planHoursWrite } from '@/lib/payroll-hours'

const typedRow = { regular_hours: 30, overtime_hours: 0, hours_source: 'typed', typed_regular_hours: null, typed_overtime_hours: null }

describe('planHoursWrite', () => {
  it('clock takes over and keeps the typed hours aside', () => {
    expect(planHoursWrite(typedRow, { source: 'clock', regular: 32.5, overtime: 0 })).toEqual({ regular: 32.5, overtime: 0, source: 'clock', typedRegular: 30, typedOvertime: 0 })
  })
  it('clock never writes 0 over typed hours', () => {
    expect(planHoursWrite(typedRow, { source: 'clock', regular: 0, overtime: 0 })).toBeNull()
    expect(planHoursWrite(null, { source: 'clock', regular: 0, overtime: 0 })).toBeNull()
  })
  it('clock time removed: the typed hours come back', () => {
    const clockRow = { regular_hours: 32.5, overtime_hours: 0, hours_source: 'clock', typed_regular_hours: 30, typed_overtime_hours: 0 }
    expect(planHoursWrite(clockRow, { source: 'clock', regular: 0, overtime: 0 })).toMatchObject({ regular: 30, source: 'typed', note: 'typed_restored' })
  })
  it('a typed save while the clock owns the week is kept aside, not paid', () => {
    const clockRow = { regular_hours: 32.5, overtime_hours: 1, hours_source: 'clock', typed_regular_hours: null, typed_overtime_hours: null }
    expect(planHoursWrite(clockRow, { source: 'typed', regular: 40, overtime: 0 })).toEqual({ regular: 32.5, overtime: 1, source: 'clock', typedRegular: 40, typedOvertime: 0, note: 'clock_kept' })
  })
  it('a clock-only week can go back to 0 (its own number)', () => {
    const clockRow = { regular_hours: 3, overtime_hours: 0, hours_source: 'clock', typed_regular_hours: null, typed_overtime_hours: null }
    expect(planHoursWrite(clockRow, { source: 'clock', regular: 0, overtime: 0 })).toMatchObject({ regular: 0, source: 'clock' })
  })
  it('plain typed save with no clock is unchanged behaviour', () => {
    expect(planHoursWrite(null, { source: 'typed', regular: 12, overtime: 0 })).toEqual({ regular: 12, overtime: 0, source: 'typed', typedRegular: null, typedOvertime: null })
  })
})
