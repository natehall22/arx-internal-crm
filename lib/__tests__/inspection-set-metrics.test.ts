import { countsAsInspectionSet } from '@/lib/inspection-set-metrics'

describe('countsAsInspectionSet', () => {
  it('counts null/inspection types that are not cancelled', () => {
    expect(countsAsInspectionSet({})).toBe(true)
    expect(countsAsInspectionSet({ appointment_type: null, status: 'scheduled' })).toBe(true)
    expect(countsAsInspectionSet({ appointment_type: 'inspection', status: 'confirmed' })).toBe(
      true
    )
    expect(countsAsInspectionSet({ appointment_type: 'inspection', status: 'completed' })).toBe(
      true
    )
  })

  it('excludes close and follow-up appointment types', () => {
    expect(countsAsInspectionSet({ appointment_type: 'close', status: 'scheduled' })).toBe(false)
    expect(countsAsInspectionSet({ appointment_type: 'follow_up', status: 'scheduled' })).toBe(
      false
    )
    expect(
      countsAsInspectionSet({ appointment_type: 'insurance_follow_up', status: 'scheduled' })
    ).toBe(false)
  })

  it('excludes blank appointment_type (SQL only allows null or inspection)', () => {
    expect(countsAsInspectionSet({ appointment_type: '', status: 'scheduled' })).toBe(false)
    expect(countsAsInspectionSet({ appointment_type: '   ', status: 'scheduled' })).toBe(false)
  })

  it('excludes cancelled rows (reschedule orphans)', () => {
    expect(countsAsInspectionSet({ appointment_type: 'inspection', status: 'cancelled' })).toBe(
      false
    )
    expect(countsAsInspectionSet({ status: 'cancelled' })).toBe(false)
  })
})
