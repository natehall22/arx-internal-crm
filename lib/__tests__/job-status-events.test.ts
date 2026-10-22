import {
  isPermitAction,
  materialsOrderedUpdate,
  materialsUnorderedUpdate,
  permitUpdate,
  tradeDoneFromCrewPhotos,
} from '@/lib/job-status-events'
import { appointmentStatusForOutcome } from '@/lib/inspection-outcomes'

const NOW = '2026-10-21T14:00:00.000Z'
const ALL_FOUR = ['final_front', 'final_back', 'final_left', 'final_right']

describe('materials ordered (desire path)', () => {
  it('records the order and moves a sold job to Material Ordering', () => {
    expect(materialsOrderedUpdate({ status: 'sold', materials_status: 'not_ordered', materials_ordered_at: null }, NOW)).toEqual({
      materials_status: 'ordered',
      materials_ordered_at: NOW,
      status: 'materials',
    })
  })

  it('does not move a job that is already past sold', () => {
    const update = materialsOrderedUpdate({ status: 'scheduled', materials_status: 'not_ordered', materials_ordered_at: null }, NOW)
    expect(update).toEqual({ materials_status: 'ordered', materials_ordered_at: NOW })
  })

  it('keeps an earlier order date', () => {
    const update = materialsOrderedUpdate(
      { status: 'sold', materials_status: 'not_ordered', materials_ordered_at: '2026-10-01T00:00:00.000Z' },
      NOW
    )
    expect(update?.materials_ordered_at).toBe('2026-10-01T00:00:00.000Z')
  })

  it('is forward-only: a second download or tap is a no-op', () => {
    expect(materialsOrderedUpdate({ status: 'materials', materials_status: 'ordered', materials_ordered_at: NOW }, NOW)).toBeNull()
    expect(materialsOrderedUpdate({ status: 'materials', materials_status: 'received', materials_ordered_at: null }, NOW)).toBeNull()
  })

  it('never touches a cancelled job', () => {
    expect(materialsOrderedUpdate({ status: 'cancelled', materials_status: 'not_ordered', materials_ordered_at: null }, NOW)).toBeNull()
  })

  it('undo reverses only a plain "ordered"', () => {
    expect(materialsUnorderedUpdate({ status: 'materials', materials_status: 'ordered' })).toEqual({
      materials_status: 'not_ordered',
      materials_ordered_at: null,
      status: 'sold',
    })
    expect(materialsUnorderedUpdate({ status: 'scheduled', materials_status: 'ordered' })).toEqual({
      materials_status: 'not_ordered',
      materials_ordered_at: null,
    })
    expect(materialsUnorderedUpdate({ status: 'materials', materials_status: 'received' })).toBeNull()
  })
})

describe('permit one-tap', () => {
  it('maps each tap to required + status together', () => {
    expect(permitUpdate('applied')).toEqual({ permit_required: true, permit_status: 'pending' })
    expect(permitUpdate('approved', ' 24-1188 ')).toEqual({ permit_required: true, permit_status: 'approved', permit_number: '24-1188' })
    expect(permitUpdate('approved', '')).toEqual({ permit_required: true, permit_status: 'approved', permit_number: null })
    expect(permitUpdate('not_needed', 'x')).toEqual({ permit_required: false, permit_status: 'not_needed' })
  })

  it('rejects unknown actions', () => {
    expect(isPermitAction('approved')).toBe(true)
    expect(isPermitAction('denied')).toBe(false)
    expect(isPermitAction(undefined)).toBe(false)
  })
})

describe('crew photo link → trade done', () => {
  const open = { status: 'scheduled', assigned_sub_id: 'sub-1' }

  it('completes on the 4th required angle', () => {
    expect(tradeDoneFromCrewPhotos(open, ALL_FOUR.slice(0, 3))).toBe(false)
    expect(tradeDoneFromCrewPhotos(open, [...ALL_FOUR.slice(0, 3), 'other_final'])).toBe(false)
    expect(tradeDoneFromCrewPhotos(open, ALL_FOUR)).toBe(true)
  })

  it('never re-completes, completes a removed trade, or credits a trade with no crew', () => {
    expect(tradeDoneFromCrewPhotos({ status: 'completed', assigned_sub_id: 'sub-1' }, ALL_FOUR)).toBe(false)
    expect(tradeDoneFromCrewPhotos({ status: 'cancelled', assigned_sub_id: 'sub-1' }, ALL_FOUR)).toBe(false)
    expect(tradeDoneFromCrewPhotos({ status: 'scheduled', assigned_sub_id: null }, ALL_FOUR)).toBe(false)
  })
})

describe('appointment status for an outcome (one answer for both paths)', () => {
  it('sale completes, not home is a no-show, anything else completes', () => {
    expect(appointmentStatusForOutcome(null, 'sale')).toBe('completed')
    expect(appointmentStatusForOutcome(null, 'not_home')).toBe('no_show')
    expect(appointmentStatusForOutcome(null, 'needs_follow_up')).toBe('completed')
  })
})
