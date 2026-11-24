/** @jest-environment node */
/** Truck sheet — the pure rules: what is loadable and how it adds up, beds as stored, machines default vs override, notes, route order. */
import { mulchCubicYards, pineStrawBales } from '@/lib/area-measure'
import { bedAmountsOf, cleanCrewNote, cleanEquipmentIds, combineLoad, dayBeds, dayLoad, distinctEquipment, isLoadable, quantityText, resolveEquipment, sameIds, sortStops } from '@/lib/truck-sheet'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

describe('isLoadable — only things you put on the truck', () => {
  it('keeps material lines, drops labor / permit / discount / tax / disposal by category, name or unit', () => {
    expect(isLoadable({ name: 'Pine straw', category: 'Landscape', unit: 'each', quantity: 40 })).toBe(true)
    expect(isLoadable({ name: 'Drip edge', category: 'roofing', unit: 'lf', quantity: 120 })).toBe(true)
    expect(isLoadable({ name: 'Crew labor', category: 'Labor', unit: 'each', quantity: 2 })).toBe(false)
    expect(isLoadable({ name: 'Building permit', category: 'addons', unit: 'job', quantity: 1 })).toBe(false)
    expect(isLoadable({ name: 'Loyalty', category: 'Discount', unit: 'each', quantity: 1 })).toBe(false)
    expect(isLoadable({ name: 'Sales tax', category: 'general', unit: 'each', quantity: 1 })).toBe(false)
    expect(isLoadable({ name: 'Dumpster', category: 'Disposal', unit: 'each', quantity: 1 })).toBe(false)
    expect(isLoadable({ name: 'Weekly mowing', category: 'Lawn', unit: 'visit', quantity: 1 })).toBe(false)
    expect(isLoadable({ name: 'Overhead 10%', category: 'general', unit: 'percent', quantity: 10 })).toBe(false)
    expect(isLoadable({ name: 'Trimming', category: 'Lawn', unit: 'hour', quantity: 3 })).toBe(false)
  })
  it('drops nothing-to-load lines (zero, negative, blank name) and keeps a blank unit', () => {
    expect(isLoadable({ name: 'Mulch', category: 'x', unit: '', quantity: 0 })).toBe(false)
    expect(isLoadable({ name: 'Mulch', category: 'x', unit: 'yard', quantity: -1 })).toBe(false)
    expect(isLoadable({ name: '  ', category: 'x', unit: 'each', quantity: 2 })).toBe(false)
    expect(isLoadable({ name: 'Mulch', category: null, unit: null, quantity: 2 })).toBe(true)
  })
})

describe('combineLoad / dayLoad — same item + unit adds up', () => {
  it('combines case- and space-insensitively, keeps different units apart, skips non-physical lines', () => {
    const stop = combineLoad([
      { name: 'Pine Straw', unit: 'each', category: 'Landscape', quantity: 10 },
      { name: ' pine  straw ', unit: 'EACH', category: 'Landscape', quantity: 5.5 },
      { name: 'Pine straw', unit: 'lf', category: 'Landscape', quantity: 2 },
      { name: 'Install labor', unit: 'hour', category: 'Labor', quantity: 8 },
    ])
    expect(stop).toEqual([
      { name: 'Pine Straw', unit: 'each', quantity: 15.5 },
      { name: 'Pine straw', unit: 'lf', quantity: 2 },
    ])
  })
  it('the day is every stop combined', () => {
    const one = combineLoad([{ name: 'Mulch', unit: 'yard', quantity: 2 }, { name: 'Edging', unit: 'lf', quantity: 40 }])
    const two = combineLoad([{ name: 'mulch', unit: 'yard', quantity: 1.25 }])
    expect(dayLoad([one, two])).toEqual([{ name: 'Mulch', unit: 'yard', quantity: 3.25 }, { name: 'Edging', unit: 'lf', quantity: 40 }])
  })
  it('amounts read in plain words', () => {
    expect(quantityText({ quantity: 12, unit: 'each' })).toBe('12')
    expect(quantityText({ quantity: 1, unit: 'square' })).toBe('1 square')
    expect(quantityText({ quantity: 2.5, unit: 'square' })).toBe('2.5 squares')
    expect(quantityText({ quantity: 40, unit: 'lf' })).toBe('40 lf')
  })
})

describe('bedAmountsOf — as stored, else worked out the way the measure tool does', () => {
  const calc = { mulchCubicYards, pineStrawBales }
  const company = { mulchDepthIn: 3, strawSqftPerBale: 50 }
  it('uses the saved totals when the measure stored them (even if the company settings changed since)', () => {
    const row = { bed_sqft: 216, totals: { materials: { mulchCuYd: 2, strawBales: 5 } }, settings: {} }
    expect(bedAmountsOf(row, { mulchDepthIn: 6, strawSqftPerBale: 10 }, calc)).toEqual({ bedSqft: 216, mulchCuYd: 2, strawBales: 5 })
  })
  it('an older row with no totals: its own saved settings first, then the company’s', () => {
    expect(bedAmountsOf({ bed_sqft: 108, totals: {}, settings: { mulchDepthIn: 3, strawSqftPerBale: 50 } }, { mulchDepthIn: 6, strawSqftPerBale: 10 }, calc)).toEqual({ bedSqft: 108, mulchCuYd: 1, strawBales: 3 })
    expect(bedAmountsOf({ bed_sqft: 108, totals: {}, settings: {} }, company, calc)).toEqual({ bedSqft: 108, mulchCuYd: 1, strawBales: 3 })
  })
  it('a property with no beds has none', () => {
    expect(bedAmountsOf({ bed_sqft: 0, totals: {}, settings: {} }, company, calc)).toBeNull()
  })
})

describe('dayBeds — each property once', () => {
  it('two stops at one home count its beds once; unknown properties still count', () => {
    const beds = { bedSqft: 108, mulchCuYd: 1, strawBales: 3 }
    expect(dayBeds([{ propertyKey: 'p1', beds }, { propertyKey: 'p1', beds }, { propertyKey: 'p2', beds: { bedSqft: 216, mulchCuYd: 2.25, strawBales: 5 } }, { propertyKey: 'p3', beds: null }])).toEqual({ mulchCuYd: 3.25, strawBales: 8, properties: 2 })
    expect(dayBeds([])).toEqual({ mulchCuYd: 0, strawBales: 0, properties: 0 })
  })
})

describe('machines', () => {
  it('a visit’s own list wins (an empty list = none); null falls back to the plan; neither = none', () => {
    expect(resolveEquipment([B], [A])).toEqual([B])
    expect(resolveEquipment([], [A])).toEqual([])
    expect(resolveEquipment(null, [A])).toEqual([A])
    expect(resolveEquipment(undefined, undefined)).toEqual([])
  })
  it('the day’s machines are each one once', () => {
    expect(distinctEquipment([[A, B], [B], [C, A]])).toEqual([A, B, C])
  })
  it('a request list: null = the plan’s; uuids only, distinct, at most 20', () => {
    expect(cleanEquipmentIds(null)).toEqual({ ok: true, value: null })
    expect(cleanEquipmentIds([A, A.toUpperCase(), B])).toEqual({ ok: true, value: [A, B] })
    expect(cleanEquipmentIds(['nope']).ok).toBe(false)
    expect(cleanEquipmentIds('x').ok).toBe(false)
    expect(cleanEquipmentIds(Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)).ok).toBe(false)
    expect(sameIds([A, B], [B, A])).toBe(true)
    expect(sameIds(null, [])).toBe(false)
    expect(sameIds(null, null)).toBe(true)
  })
})

describe('crew note', () => {
  it('trims, clears on blank, refuses over 1000 characters and non-text', () => {
    expect(cleanCrewNote('  Gate is open.  ')).toEqual({ ok: true, value: 'Gate is open.' })
    expect(cleanCrewNote('   ')).toEqual({ ok: true, value: null })
    expect(cleanCrewNote(undefined)).toEqual({ ok: true, value: null })
    expect(cleanCrewNote('x'.repeat(1001)).ok).toBe(false)
    expect(cleanCrewNote('x'.repeat(1000)).ok).toBe(true)
    expect(cleanCrewNote(5).ok).toBe(false)
  })
})

describe('sortStops — route order', () => {
  it('stop number first (unnumbered last), visits before job stops on a tie, then address', () => {
    const r = sortStops([
      { id: 'a', kind: 'job' as const, position: 2, address: 'B' },
      { id: 'b', kind: 'visit' as const, position: null, address: 'A' },
      { id: 'c', kind: 'visit' as const, position: 2, address: 'Z' },
      { id: 'd', kind: 'visit' as const, position: 1, address: 'Y' },
    ])
    expect(r.map((x) => x.id)).toEqual(['d', 'c', 'a', 'b'])
  })
})
