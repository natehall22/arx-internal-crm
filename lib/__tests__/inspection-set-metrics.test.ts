import {
  countsAsInspectionSet,
  countsAsOrgInspectionSet,
} from '@/lib/inspection-set-metrics'

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

describe('countsAsOrgInspectionSet', () => {
  it('includes setter and manager canvasser credit', () => {
    expect(
      countsAsOrgInspectionSet({
        id: 'a1',
        appointment_type: 'inspection',
        status: 'scheduled',
        canvasser_user_id: 'setter-1',
        closer_user_id: 'closer-1',
      })
    ).toBe(true)
    expect(
      countsAsOrgInspectionSet({
        id: 'a2',
        appointment_type: 'inspection',
        status: 'scheduled',
        canvasser_user_id: 'admin-1',
        closer_user_id: 'closer-1',
      })
    ).toBe(true)
  })

  it('includes closer-only scheduling when canvasser is null', () => {
    expect(
      countsAsOrgInspectionSet({
        id: 'a3',
        appointment_type: 'inspection',
        status: 'scheduled',
        canvasser_user_id: null,
        closer_user_id: 'manager-1',
      })
    ).toBe(true)
  })

  it('excludes rows with no scheduler attribution', () => {
    expect(
      countsAsOrgInspectionSet({
        id: 'a4',
        appointment_type: 'inspection',
        status: 'scheduled',
        canvasser_user_id: null,
        closer_user_id: null,
      })
    ).toBe(false)
  })

  it('excludes non-inspection-set types', () => {
    expect(
      countsAsOrgInspectionSet({
        id: 'a5',
        appointment_type: 'close',
        status: 'scheduled',
        canvasser_user_id: 'admin-1',
        closer_user_id: 'closer-1',
      })
    ).toBe(false)
  })
})
