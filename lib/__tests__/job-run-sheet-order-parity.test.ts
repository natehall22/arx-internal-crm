import { buildMeasurementStrip, toRunSheetChangeOrders } from '@/lib/job-run-sheet'
import type { JobSoldScope } from '@/lib/job-sold-scope'
import { buildMaterialsOrderList } from '@/lib/materials-order-list'
import { applyMaterialOrderOverrides, type JobMaterialOrderOverrideRow } from '@/lib/materials-order-overrides'

// 26-0046: proposal stored 79.67 sq but the shingle line was sold at 80. The crew sheet printed
// 79.67 while the supplier sheet printed 80.0 — this pins them to one answer.
const scope: JobSoldScope = {
  total_squares: 80,
  total_squares_source: 'proposal_enriched',
  measured_squares: 74.02,
  waste_percent: 7.63,
  measure_suggested_waste_percent: null,
  source: 'proposal',
  proposal_id: 'p1',
  proposal_number: 'P-00172',
  line_items: [],
  roof_measurement_linear: {
    source: null,
    ridges_lf: 135.3,
    hips_lf: 190.7,
    valleys_lf: 217.3,
    eaves_lf: 366.5,
    rakes_lf: 141.6,
    flashing_lf: null,
    step_flashing_lf: null,
    wall_flashing_lf: null,
    drip_edge_lf: 508.2,
    predominant_pitch: '4/12',
  },
}

const override = (item_key: string, patch: Partial<JobMaterialOrderOverrideRow>): JobMaterialOrderOverrideRow => ({
  id: item_key,
  job_id: 'j1',
  item_key,
  qty_text: null,
  excluded: false,
  note: null,
  updated_by: null,
  updated_at: '2026-09-28T00:00:00Z',
  ...patch,
})

function orderRows(overrides: JobMaterialOrderOverrideRow[] = []) {
  return applyMaterialOrderOverrides(
    buildMaterialsOrderList({ totalSquaresWithWaste: scope.total_squares, linear: scope.roof_measurement_linear }),
    overrides
  )
}

const valueOf = (strip: { label: string; value: string }[], label: string) =>
  strip.find((m) => m.label === label)?.value

describe('run sheet ↔ order sheet parity', () => {
  it('prints the same sold squares the order sheet orders from', () => {
    const rows = orderRows()
    const strip = buildMeasurementStrip(scope, rows)
    expect(valueOf(strip, 'Squares (w/ waste)')).toBe('80.0 sq')
    expect(rows.find((r) => r.key === 'field_shingles')?.detail).toContain('80.0 sq sold total')
  })

  it('shows the starter count ops edited on the order, not a recomputed one', () => {
    const strip = buildMeasurementStrip(scope, orderRows([override('starter', { qty_text: '7 bundles' })]))
    expect(valueOf(strip, 'Starter')).toBe('7 bundles')
  })

  it('drops starter from the crew sheet when ops excluded it from the order', () => {
    const strip = buildMeasurementStrip(scope, orderRows([override('starter', { excluded: true })]))
    expect(valueOf(strip, 'Starter')).toBeUndefined()
  })

  it('uses the order list drip edge LF, rounded the same way', () => {
    const rows = orderRows()
    expect(valueOf(buildMeasurementStrip(scope, rows), 'Drip edge')).toBe('508.2 LF')
    expect(rows.find((r) => r.key === 'drip_edge')?.detail).toContain('508.2 LF')
  })
})

describe('toRunSheetChangeOrders', () => {
  const row = (description: string, co_number: string | null = 'CO-001') => ({
    co_number,
    description,
    customer_signed_at: '2026-09-03T15:00:00Z',
    signed_at: null,
  })

  it('strips dollar figures — the crew sheet carries no pricing', () => {
    const [co] = toRunSheetChangeOrders([row('Adding black seamless gutters - $1,395.20')])
    expect(co.body).toBe('Adding black seamless gutters')
    expect(co.label).toMatch(/^Change order CO-001 \(signed Sep \d\)$/)
  })

  it('keeps the scope when the price is mid-sentence', () => {
    const [co] = toRunSheetChangeOrders([
      row('Adding the $506.74 that was covered by insurance for the ridge cap on the garage.'),
    ])
    expect(co.body).toBe('Adding the that was covered by insurance for the ridge cap on the garage.')
  })

  it('drops a CO whose description was only a price', () => {
    expect(toRunSheetChangeOrders([row('$450.00')])).toEqual([])
  })
})
