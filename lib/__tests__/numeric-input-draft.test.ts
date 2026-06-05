import { formatNumericDraft, parseDraftFloat, previewNumber } from '@/lib/numeric-input-draft'

describe('numeric-input-draft', () => {
  it('allows empty draft for controlled inputs', () => {
    expect(formatNumericDraft('')).toBe('')
    expect(previewNumber('', 0)).toBe(0)
    expect(parseDraftFloat('')).toBeNull()
  })

  it('coerces on save only', () => {
    expect(parseDraftFloat('5.5')).toBe(5.5)
    expect(parseDraftFloat('', { required: true })).toBeNull()
    expect(parseDraftFloat('', { fallback: 0 })).toBe(0)
  })
})
