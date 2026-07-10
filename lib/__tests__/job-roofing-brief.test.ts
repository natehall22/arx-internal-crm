import { buildJobRoofingBrief } from '@/lib/job-roofing-brief'
import type { JobSoldScope } from '@/components/ops/JobSoldScopeSummary'

const baseScope: JobSoldScope = {
  total_squares: 50,
  total_squares_source: 'proposal_enriched',
  measured_squares: 44.9,
  waste_percent: 11.2,
  source: 'proposal',
  proposal_id: 'p-1',
  proposal_number: '26-0032',
  line_items: [],
  roof_measurement_linear: {
    source: 'in_house',
    ridges_lf: 161,
    valleys_lf: 42,
    hips_lf: 21,
    eaves_lf: 450,
    rakes_lf: 232,
    flashing_lf: null,
    step_flashing_lf: null,
    wall_flashing_lf: 29,
    drip_edge_lf: null,
  },
  materials_extras: {
    ridge_segment_count: 1,
    low_slope_area_sqft: null,
    low_slope_facet_count: null,
    penetration_count: 3,
  },
}

describe('buildJobRoofingBrief', () => {
  it('maps core roofing quantities for the job header brief', () => {
    const fields = buildJobRoofingBrief({
      scope: baseScope,
      project: {
        product_summary: 'GAF Timberline HDZ',
        project_review: {
          answers: {
            materialsAndProducts: 'Charcoal HDZ',
            accessories: '2 skylights',
            scopeSummary: '',
            tearOffAndDecking: '',
            siteConditions: '',
            permitsAndHoa: '',
            customerExpectations: '',
            financing: '',
            openItems: '',
          },
          submittedAt: '2026-07-10T00:00:00.000Z',
          submittedByUserId: 'u-1',
        },
      },
      workOrderMaterials: [{ name: 'Gutters', quantity: '120', unit: 'LF' }],
      specialInstructions: 'Dog in backyard',
      materialsNotes: 'Starter NOT full eave run',
    })

    expect(fields.shingleColor.value).toBe('Charcoal HDZ')
    expect(fields.fieldShingleSq.value).toBe('50.0 sq')
    expect(fields.ridgeLf.value).toBe('161 LF')
    expect(fields.ridgeVentLf.value).toBe('155 LF')
    expect(fields.starterSq.value).toBe('2.0 sq')
    expect(fields.wallFlashingLf.value).toBe('29 LF')
    expect(fields.accessories.value).toContain('2 skylights')
    expect(fields.accessories.value).toContain('Gutters')
    expect(fields.accessories.value).toContain('Pipe boots')
    expect(fields.specialRemarks.value).toContain('Dog in backyard')
    expect(fields.specialRemarks.value).toContain('Starter NOT full eave run')
  })

  it('reflects material-order overrides in the brief', () => {
    const fields = buildJobRoofingBrief({
      scope: baseScope,
      overrides: [
        {
          id: 'o-1',
          job_id: 'j-1',
          item_key: 'ridge_vent',
          qty_text: '92 LF',
          excluded: false,
          note: "92' of ridge vent NOT 161",
          updated_by: null,
          updated_at: '2026-07-10T00:00:00.000Z',
        },
      ],
    })

    expect(fields.ridgeVentLf.value).toBe('92 LF')
    expect(fields.ridgeVentLf.edited).toBe(true)
    expect(fields.ridgeVentLf.computedValue).toBe('155 LF')
  })

  it('marks excluded material rows as excluded in the brief', () => {
    const fields = buildJobRoofingBrief({
      scope: baseScope,
      overrides: [
        {
          id: 'o-2',
          job_id: 'j-1',
          item_key: 'ridge_vent',
          qty_text: null,
          excluded: true,
          note: null,
          updated_by: null,
          updated_at: '2026-07-10T00:00:00.000Z',
        },
      ],
    })

    expect(fields.ridgeVentLf.value).toBe('Excluded')
    expect(fields.ridgeVentLf.computedValue).toBe('155 LF')
  })
})
