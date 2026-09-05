import {
  CANVASS_OWNERSHIP_TRANSFER_EFFECTIVE_FROM,
  canvassOwnershipTransferApplies,
  getAttributedCanvassLeadUserId,
  knocksAsAttributedLeadRows,
} from '@/lib/canvass-lead-attribution'

const BEFORE_CUTOFF = '2026-09-01T19:56:35.617Z'
const AFTER_CUTOFF = '2026-09-06T14:00:00.000Z'

describe('getAttributedCanvassLeadUserId', () => {
  it('credits the re-knocking owner for a transfer at or after the cutoff', () => {
    expect(
      getAttributedCanvassLeadUserId({
        pin_attributed_user_id: 'caleb',
        owner_user_id: 'evan',
        ownership_reassigned_at: AFTER_CUTOFF,
      })
    ).toBe('evan')
  })

  it('keeps the frozen pin owner for a transfer before the cutoff', () => {
    // The 151 leads already reassigned when this shipped keep reporting what they always
    // reported — this change is forward-only so historical door counts do not restate.
    expect(
      getAttributedCanvassLeadUserId({
        pin_attributed_user_id: 'caleb',
        owner_user_id: 'evan',
        ownership_reassigned_at: BEFORE_CUTOFF,
      })
    ).toBe('caleb')
  })

  it('treats the cutoff instant itself as transferred', () => {
    expect(
      getAttributedCanvassLeadUserId({
        pin_attributed_user_id: 'caleb',
        owner_user_id: 'evan',
        ownership_reassigned_at: CANVASS_OWNERSHIP_TRANSFER_EFFECTIVE_FROM,
      })
    ).toBe('evan')
  })

  it('keeps the frozen pin owner for a lead that was never reassigned', () => {
    expect(
      getAttributedCanvassLeadUserId({
        pin_attributed_user_id: 'caleb',
        owner_user_id: 'evan',
        ownership_reassigned_at: null,
      })
    ).toBe('caleb')
  })

  it('falls back to the frozen pin owner when owner_user_id was cleared on user delete', () => {
    // pin_attributed_user_id's other real job — a deleted user nulls owner_user_id, and the
    // pin must stay attributed rather than becoming unowned.
    expect(
      getAttributedCanvassLeadUserId({
        pin_attributed_user_id: 'caleb',
        owner_user_id: null,
        ownership_reassigned_at: AFTER_CUTOFF,
      })
    ).toBe('caleb')
  })

  it('keeps pre-cutoff behavior when the caller did not select ownership_reassigned_at', () => {
    // Documented failure mode: an omitted column reads as "never reassigned" rather than
    // throwing, so a missed select looks like nothing happened.
    expect(
      getAttributedCanvassLeadUserId({ pin_attributed_user_id: 'caleb', owner_user_id: 'evan' })
    ).toBe('caleb')
  })

  it('returns null when neither id is present', () => {
    expect(
      getAttributedCanvassLeadUserId({ pin_attributed_user_id: null, owner_user_id: null })
    ).toBeNull()
  })

  it('still credits the knocking rep for rows built from canvass_knocks', () => {
    // knocksAsAttributedLeadRows nulls the pin field, so setter ramp resolves to the knock's
    // own already-attributed rep on either side of the cutoff.
    const [row] = knocksAsAttributedLeadRows([{ user_id: 'evan', created_at: BEFORE_CUTOFF }])
    expect(getAttributedCanvassLeadUserId(row)).toBe('evan')
  })
})

describe('canvassOwnershipTransferApplies', () => {
  it('is false for a missing or unparseable timestamp', () => {
    expect(canvassOwnershipTransferApplies(null)).toBe(false)
    expect(canvassOwnershipTransferApplies(undefined)).toBe(false)
    expect(canvassOwnershipTransferApplies('not a date')).toBe(false)
  })

  it('is false before the cutoff and true after it', () => {
    expect(canvassOwnershipTransferApplies(BEFORE_CUTOFF)).toBe(false)
    expect(canvassOwnershipTransferApplies(AFTER_CUTOFF)).toBe(true)
  })
})
