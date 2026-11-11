import { cleanPropertyInput, formatPropertyAddress, propertiesDisplayMode, propertyDisplayName, propertyMapHref, type Property } from '@/lib/properties'

const prop = (over: Partial<Property> = {}): Property => ({
  id: 'p1', customer_id: 'c1', label: null, address_line1: null, address_line2: null, city: null, state: null, zip: null,
  address_text: '12 Oak St, Concord, NC 28025', lat: null, lng: null, notes: null, access_notes: null, active: true, source: 'backfill',
  custom_fields: {}, created_at: '', updated_at: '', ...over,
})

describe('formatPropertyAddress', () => {
  it('joins the parts people read, skipping blanks', () => {
    expect(formatPropertyAddress({ address_line1: '12 Oak St', address_line2: ' ', city: 'Crawfordville', state: 'FL', zip: '32327' })).toBe('12 Oak St, Crawfordville, FL 32327')
    expect(formatPropertyAddress({ address_line1: '1 Main', zip: '32327' })).toBe('1 Main, 32327')
    expect(formatPropertyAddress({})).toBe('')
  })
})

describe('cleanPropertyInput', () => {
  it('create needs a street address and builds the one-line address', () => {
    expect(cleanPropertyInput({ city: 'X' }, 'create')).toEqual({ ok: false, error: 'Enter the street address' })
    const r = cleanPropertyInput({ label: ' Main office ', address_line1: '5 Elm', city: 'Tallahassee', state: 'FL', zip: '32301', access_notes: 'Gate 1234' }, 'create')
    expect(r).toEqual({ ok: true, value: { label: 'Main office', address_line1: '5 Elm', city: 'Tallahassee', state: 'FL', zip: '32301', access_notes: 'Gate 1234', address_text: '5 Elm, Tallahassee, FL 32301' } })
  })
  it('edit of one part rebuilds the whole line from the stored parts', () => {
    const r = cleanPropertyInput({ city: 'Wakulla' }, 'edit', { address_line1: '5 Elm', city: 'Tallahassee', state: 'FL', zip: '32301' })
    expect(r).toEqual({ ok: true, value: { city: 'Wakulla', address_text: '5 Elm, Wakulla, FL 32301' } })
  })
  it('edit of notes only leaves the address alone; blank text clears to null', () => {
    expect(cleanPropertyInput({ notes: '  ' }, 'edit', { address_line1: '5 Elm' })).toEqual({ ok: true, value: { notes: null } })
  })
  it('clearing line 1 is refused; limits and coordinates are checked', () => {
    expect(cleanPropertyInput({ address_line1: '' }, 'edit', { address_line1: '5 Elm' }).ok).toBe(false)
    expect(cleanPropertyInput({ address_line1: 'x', label: 'y'.repeat(81) }, 'create').ok).toBe(false)
    expect(cleanPropertyInput({ address_line1: 'x', lat: 91 }, 'create').ok).toBe(false)
    expect(cleanPropertyInput({ address_line1: 'x', lat: '30.1', lng: -84.3 }, 'create')).toMatchObject({ ok: true, value: { lat: 30.1, lng: -84.3 } })
    expect(cleanPropertyInput({ address_line1: 'x', active: false }, 'create').ok).toBe(false)
    expect(cleanPropertyInput({ active: 'no' }, 'edit').ok).toBe(false)
    expect(cleanPropertyInput({ active: false }, 'edit')).toEqual({ ok: true, value: { active: false } })
    expect(cleanPropertyInput(null, 'edit').ok).toBe(false)
    expect(cleanPropertyInput({ bogus: 1 }, 'edit').ok).toBe(false)
  })
})

describe('propertiesDisplayMode — a company that never uses properties sees nothing new', () => {
  const base = { ready: true, hasPropertyFields: false, canEdit: true }
  it('one plain backfilled home: just the add link for editors, nothing for viewers', () => {
    expect(propertiesDisplayMode({ ...base, properties: [prop()] })).toBe('link')
    expect(propertiesDisplayMode({ ...base, canEdit: false, properties: [prop()] })).toBe('none')
    expect(propertiesDisplayMode({ ...base, properties: [] })).toBe('link')
  })
  it('full card once there is more than an address', () => {
    expect(propertiesDisplayMode({ ...base, properties: [prop(), prop({ id: 'p2' })] })).toBe('full')
    expect(propertiesDisplayMode({ ...base, properties: [prop({ label: 'Office' })] })).toBe('full')
    expect(propertiesDisplayMode({ ...base, properties: [prop({ access_notes: 'gate' })] })).toBe('full')
    expect(propertiesDisplayMode({ ...base, properties: [prop({ active: false })] })).toBe('full')
    expect(propertiesDisplayMode({ ...base, properties: [prop({ custom_fields: { f: 'x' } })] })).toBe('full')
    expect(propertiesDisplayMode({ ...base, hasPropertyFields: true, properties: [] })).toBe('full')
  })
  it('nothing before the migration is applied', () => {
    expect(propertiesDisplayMode({ ...base, ready: false, properties: [] })).toBe('none')
  })
})

it('display name and map link', () => {
  expect(propertyDisplayName(prop({ label: 'Office' }))).toBe('Office · 12 Oak St, Concord, NC 28025')
  expect(propertyMapHref(prop())).toContain('query=12%20Oak%20St')
  expect(propertyMapHref(prop({ lat: 30.1, lng: -84.3 }))).toContain('query=30.1%2C-84.3')
})
