import {
  cleanFieldOptions,
  cleanFieldValue,
  definitionFromRow,
  definitionsForViewer,
  valuesForViewer,
  withoutCustomFields,
  displayFieldValue,
  fieldsToShow,
  isCalendarDate,
  validateValuePatch,
  type CustomFieldDefinition,
} from '@/lib/custom-fields'

const def = (over: Partial<CustomFieldDefinition>): CustomFieldDefinition => ({
  id: 'f', entity: 'customer', label: 'Field', field_type: 'text', options: [], required: false, sort: 0, active: true, visible_to_field: false, ...over,
})

describe('cleanFieldValue', () => {
  it('text is trimmed and capped', () => {
    expect(cleanFieldValue(def({}), '  Gate 4421 ')).toEqual({ ok: true, value: 'Gate 4421' })
    expect(cleanFieldValue(def({}), 'x'.repeat(2001)).ok).toBe(false)
    expect(cleanFieldValue(def({}), 12).ok).toBe(false)
  })
  it('numbers accept text with commas, refuse junk', () => {
    const n = def({ field_type: 'number' })
    expect(cleanFieldValue(n, '1,250.5')).toEqual({ ok: true, value: 1250.5 })
    expect(cleanFieldValue(n, -3)).toEqual({ ok: true, value: -3 })
    expect(cleanFieldValue(n, 'abc').ok).toBe(false)
    expect(cleanFieldValue(n, Infinity).ok).toBe(false)
  })
  it('dates must be real calendar days', () => {
    const d = def({ field_type: 'date' })
    expect(cleanFieldValue(d, '2026-02-28')).toEqual({ ok: true, value: '2026-02-28' })
    expect(cleanFieldValue(d, '2026-02-30').ok).toBe(false)
    expect(cleanFieldValue(d, '2026-02-28T00:00:00Z').ok).toBe(false)
    expect(isCalendarDate('2028-02-29')).toBe(true)
    expect(isCalendarDate('2027-02-29')).toBe(false)
  })
  it('yes/no takes booleans and yes/no words', () => {
    const y = def({ field_type: 'yes_no' })
    expect(cleanFieldValue(y, 'yes')).toEqual({ ok: true, value: true })
    expect(cleanFieldValue(y, false)).toEqual({ ok: true, value: false })
    expect(cleanFieldValue(y, 'maybe').ok).toBe(false)
  })
  it('dropdown matches a choice case-insensitively and stores the choice spelling', () => {
    const dd = def({ field_type: 'dropdown', options: ['Weekly', 'Biweekly'] })
    expect(cleanFieldValue(dd, 'weekly')).toEqual({ ok: true, value: 'Weekly' })
    expect(cleanFieldValue(dd, 'Monthly').ok).toBe(false)
  })
})

describe('validateValuePatch', () => {
  const defs = [
    def({ id: 'a', label: 'Gate code' }),
    def({ id: 'b', label: 'Lot size', field_type: 'number', required: true }),
    def({ id: 'off', label: 'Old', active: false }),
    def({ id: 'job1', entity: 'job', label: 'Job thing' }),
  ]
  it('sets and clears; blank = clear', () => {
    expect(validateValuePatch(defs, 'customer', {}, { a: 'x', b: '2' })).toEqual({ ok: true, set: { a: 'x', b: 2 }, remove: [] })
    expect(validateValuePatch(defs, 'customer', { a: 'x', b: 2 }, { a: '  ' })).toEqual({ ok: true, set: {}, remove: ['a'] })
  })
  it('required counts the stored value too, and names the missing field', () => {
    expect(validateValuePatch(defs, 'customer', {}, { a: 'x' })).toMatchObject({ ok: false, error: 'Lot size is required', fieldId: 'b' })
    expect(validateValuePatch(defs, 'customer', { b: 5 }, { a: 'x' }).ok).toBe(true)
    expect(validateValuePatch(defs, 'customer', { b: 5 }, { b: null })).toMatchObject({ ok: false, fieldId: 'b' })
  })
  it('refuses turned-off fields, other record types and unknown ids', () => {
    expect(validateValuePatch(defs, 'customer', { b: 1 }, { off: 'x' }).ok).toBe(false)
    expect(validateValuePatch(defs, 'customer', { b: 1 }, { job1: 'x' }).ok).toBe(false)
    expect(validateValuePatch(defs, 'customer', { b: 1 }, { nope: 'x' }).ok).toBe(false)
  })
  it('a value sent back unchanged is kept without re-validation (a removed dropdown choice does not block other fields)', () => {
    const dd = [def({ id: 'd', field_type: 'dropdown', options: ['Net 30'] }), def({ id: 'n', field_type: 'number' }), def({ id: 'y', field_type: 'yes_no' }), def({ id: 'a' })]
    const stored = { d: 'Net 15', n: 1250, y: true }
    expect(validateValuePatch(dd, 'customer', stored, { d: 'Net 15', n: '1,250', y: 'yes', a: 'new' })).toEqual({ ok: true, set: { a: 'new' }, remove: [] })
    expect(validateValuePatch(dd, 'customer', stored, { d: 'Net 15 ' }).ok).toBe(false) // nothing changed -> nothing to save
    expect(validateValuePatch(dd, 'customer', stored, { d: 'Weekly' })).toMatchObject({ ok: false, fieldId: 'd' }) // a real change is checked
    expect(validateValuePatch(dd, 'customer', stored, { d: null })).toEqual({ ok: true, set: {}, remove: ['d'] })
  })
  it('refuses a non-object or empty patch', () => {
    expect(validateValuePatch(defs, 'customer', {}, null).ok).toBe(false)
    expect(validateValuePatch(defs, 'customer', {}, ['a']).ok).toBe(false)
    expect(validateValuePatch(defs, 'customer', {}, {}).ok).toBe(false)
  })
})

describe('definitions', () => {
  it('rows with an unknown entity or type are dropped; odd options become []', () => {
    expect(definitionFromRow({ id: '1', entity: 'lead', label: 'x', field_type: 'text' })).toBeNull()
    expect(definitionFromRow({ id: '1', entity: 'job', label: 'x', field_type: 'color' })).toBeNull()
    expect(definitionFromRow({ id: '1', entity: 'job', label: 'x', field_type: 'dropdown', options: 'a,b' })?.options).toEqual([])
  })
  it('choices are trimmed, de-duplicated and capped', () => {
    expect(cleanFieldOptions([' Weekly ', 'weekly', '', 'Monthly'])).toEqual(['Weekly', 'Monthly'])
    expect(cleanFieldOptions(['x'.repeat(61)])).toBeNull()
    expect(cleanFieldOptions(Array.from({ length: 51 }, (_, i) => `o${i}`))).toBeNull()
    expect(cleanFieldOptions('a')).toBeNull()
  })
  it('fieldsToShow keeps turned-off fields only while they hold a value, in order', () => {
    const defs = [def({ id: 'x', sort: 20 }), def({ id: 'y', sort: 10 }), def({ id: 'z', active: false, sort: 5 })]
    expect(fieldsToShow(defs, 'customer', {}).map((d) => d.id)).toEqual(['y', 'x'])
    expect(fieldsToShow(defs, 'customer', { z: 'kept' }).map((d) => d.id)).toEqual(['z', 'y', 'x'])
  })
})

describe('field roles', () => {
  it('see only customer / property fields marked visible to them, values included; never job fields', () => {
    const defs = [def({ id: 'c1' }), def({ id: 'c2', visible_to_field: true }), def({ id: 'p1', entity: 'property', visible_to_field: true }), def({ id: 'j1', entity: 'job', visible_to_field: true })]
    expect(definitionsForViewer(defs, true).map((d) => d.id)).toEqual(['c2', 'p1'])
    expect(definitionsForViewer(defs, false)).toHaveLength(4)
    expect(valuesForViewer({ c1: 'secret', c2: 'ok', zz: 'x' }, definitionsForViewer(defs, true))).toEqual({ c2: 'ok' })
    expect(withoutCustomFields({ id: 'c', custom_fields: { c1: 'x' } })).toEqual({ id: 'c' })
  })
})

describe('displayFieldValue', () => {
  it('reads plainly; a date is the same day in every time zone', () => {
    expect(displayFieldValue({ field_type: 'yes_no' }, false)).toBe('No')
    expect(displayFieldValue({ field_type: 'text' }, '')).toBe('—')
    expect(displayFieldValue({ field_type: 'number' }, 1250)).toBe('1,250')
    expect(displayFieldValue({ field_type: 'date' }, '2026-03-08')).toBe('Mar 8, 2026')
    expect(displayFieldValue({ field_type: 'date' }, '2026-11-01')).toBe('Nov 1, 2026')
  })
})
