import { buildRoofMeasurementLinear, ridgeHipValleyUnverified } from '@/lib/job-sold-scope'
import { buildMaterialsOrderList } from '@/lib/materials-order-list'
import { applyMaterialOrderOverrides } from '@/lib/materials-order-overrides'

describe('ridgeHipValleyUnverified', () => {
  it('uses the saved pending count on new measurements', () => {
    expect(ridgeHipValleyUnverified({ downslope_review_pending: 4 })).toBe(true)
    expect(ridgeHipValleyUnverified({ downslope_review_pending: 0 })).toBe(false)
  })

  it('ignores the old validation note so already-sent orders do not change', () => {
    expect(
      ridgeHipValleyUnverified({
        validation_notes: [
          '4 sections may need manual downslope for accurate ridge/hip/valley LF. Point the arrow toward the eave — not the Solar facing label.',
        ],
      })
    ).toBe(false)
  })

  it('is false with no raw data or junk values', () => {
    expect(ridgeHipValleyUnverified(null)).toBe(false)
    expect(ridgeHipValleyUnverified({ validation_notes: 'not an array' })).toBe(false)
    expect(ridgeHipValleyUnverified({ downslope_review_pending: null })).toBe(false)
  })

  it('rides on the linear block every order sheet reads', () => {
    const linear = buildRoofMeasurementLinear({
      ridges_lf: 22,
      raw_data: { downslope_review_pending: 4 },
    })
    expect(linear?.ridge_hip_valley_unverified).toBe(true)
  })
})

describe('ops clearing the ridge check', () => {
  const items = buildMaterialsOrderList({
    totalSquaresWithWaste: 28,
    linear: {
      ridges_lf: 22, valleys_lf: 54, hips_lf: 0, eaves_lf: 154, rakes_lf: 105,
      flashing_lf: null, step_flashing_lf: null, wall_flashing_lf: null,
      ridge_hip_valley_unverified: true,
    },
  })
  const override = (item_key: string, qty_text: string | null, note: string | null = null) => ({
    id: item_key, job_id: 'j', item_key, qty_text, excluded: false, note, updated_by: null, updated_at: '',
  })

  it('a qty override makes the ridge row a normal order line', () => {
    const [vent] = applyMaterialOrderOverrides(
      items.filter((i) => i.key === 'ridge_vent'),
      [override('ridge_vent', '12 pieces')]
    )
    expect(vent.status).toBe('ready')
    expect(vent.note).toBeNull()
    expect(vent.qty).toBe('12 pieces')
  })

  it('a note-only edit keeps it in confirm', () => {
    const [vent] = applyMaterialOrderOverrides(
      items.filter((i) => i.key === 'ridge_vent'),
      [override('ridge_vent', null, 'checking on site')]
    )
    expect(vent.status).toBe('confirm')
  })
})
