import {
  checkSolarFootprintOverlap,
  isManuallyDrawnFacet,
  overlapValidationNote,
  SOLAR_OVERLAP_SAVE_THRESHOLD,
} from '@/lib/roof-measure-solar-overlap'

describe('checkSolarFootprintOverlap', () => {
  it('flags when drawn footprint exceeds solar reference', () => {
    const check = checkSolarFootprintOverlap({
      flatAreaSqft: 1702,
      solarGroundSqft: 1109,
      geometrySource: 'solar_mask_plane',
    })
    expect(check.detected).toBe(true)
    expect(check.blocksSave).toBe(true)
    expect(check.ratio).toBeGreaterThan(SOLAR_OVERLAP_SAVE_THRESHOLD)
  })

  it('warns but does not block when manual sections explain the gap', () => {
    const check = checkSolarFootprintOverlap({
      flatAreaSqft: 1702,
      solarGroundSqft: 1109,
      geometrySource: 'solar_mask_plane',
      manualDrawFacetCount: 2,
    })
    expect(check.detected).toBe(true)
    expect(check.blocksSave).toBe(false)
  })

  it('passes when within threshold', () => {
    const check = checkSolarFootprintOverlap({
      flatAreaSqft: 1150,
      solarGroundSqft: 1109,
      geometrySource: 'solar_mask_plane',
    })
    expect(check.detected).toBe(false)
    expect(check.blocksSave).toBe(false)
  })

  it('skips vision-sourced geometry', () => {
    const check = checkSolarFootprintOverlap({
      flatAreaSqft: 2000,
      solarGroundSqft: 1109,
      geometrySource: 'vision',
    })
    expect(check.detected).toBe(false)
    expect(check.fromVision).toBe(true)
  })
})

describe('overlapValidationNote', () => {
  it('mentions manual sections when Solar reference is low', () => {
    const check = checkSolarFootprintOverlap({
      flatAreaSqft: 1702,
      solarGroundSqft: 1109,
      geometrySource: 'manual',
      manualDrawFacetCount: 3,
    })
    const note = overlapValidationNote(check)
    expect(note).toMatch(/hand-drawn/)
    expect(note).toMatch(/53%/)
    expect(note).not.toMatch(/Delete or resize/)
  })

  it('suggests fixing overlap when all sections are auto-sourced', () => {
    const check = checkSolarFootprintOverlap({
      flatAreaSqft: 1702,
      solarGroundSqft: 1109,
      geometrySource: 'solar_mask_plane',
    })
    const note = overlapValidationNote(check)
    expect(note).toMatch(/Delete or resize/)
  })
})

describe('isManuallyDrawnFacet', () => {
  it('detects manual draw origins', () => {
    expect(isManuallyDrawnFacet({ origin: 'manual_draw' })).toBe(true)
    expect(isManuallyDrawnFacet({ geometry_source: 'manual_corrected' })).toBe(true)
    expect(isManuallyDrawnFacet({ origin: 'ai_draft', geometry_source: 'solar_mask_plane' })).toBe(false)
  })
})
