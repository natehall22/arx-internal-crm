import { reconcileStaleFormField } from '@/lib/stale-form-field'

describe('reconcileStaleFormField', () => {
  it('takes the submitted value when nothing moved underneath', () => {
    expect(
      reconcileStaleFormField({ baseline: 'caleb', submitted: 'evan', current: 'caleb' })
    ).toBe('evan')
  })

  it('keeps the current value when the row moved and the form only echoed its baseline', () => {
    // The 2026-09-01 lead 3e141d02 case: canvass reassigned the setter to Evan after the page
    // was rendered with Caleb, and saving the untouched form put Caleb back.
    expect(
      reconcileStaleFormField({ baseline: 'caleb', submitted: 'caleb', current: 'evan' })
    ).toBe('evan')
  })

  it('honors a deliberate edit even when the row moved underneath', () => {
    expect(
      reconcileStaleFormField({ baseline: 'caleb', submitted: 'nathan', current: 'evan' })
    ).toBe('nathan')
  })

  it('honors a deliberate clear', () => {
    expect(
      reconcileStaleFormField<string | null>({ baseline: 'caleb', submitted: null, current: 'caleb' })
    ).toBeNull()
  })

  it('does not treat an unchanged null as an edit when the row gained a value', () => {
    // Round-robin assigning a closer to a lead that had none must survive a stale save.
    expect(
      reconcileStaleFormField<string | null>({ baseline: null, submitted: null, current: 'nathan' })
    ).toBe('nathan')
  })

  it('leaves an untouched form alone when nothing moved and nothing was set', () => {
    expect(
      reconcileStaleFormField<string | null>({ baseline: null, submitted: null, current: null })
    ).toBeNull()
  })
})
