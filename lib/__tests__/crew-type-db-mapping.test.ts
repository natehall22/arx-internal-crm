import { dbCrewType } from '@/lib/org-trades'

describe('crew type saved to crews.crew_type (CHECK: roofing|siding|gutters|windows|general)', () => {
  it('keeps the allowed types and maps any other trade to general', () => {
    for (const t of ['roofing', 'siding', 'gutters', 'windows', 'general']) expect(dbCrewType(t)).toBe(t)
    for (const t of ['lawn_care', 'landscaping', '', null, undefined]) expect(dbCrewType(t)).toBe('general')
  })
})
