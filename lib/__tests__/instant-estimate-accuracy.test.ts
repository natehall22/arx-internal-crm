/**
 * @jest-environment node
 */
// The estimator pulls in geotiff (ESM) and calls Google; these tests never measure.
jest.mock('@/lib/public-roof-estimate', () => ({ INSTANT_ESTIMATE_VERSION: 'ie-test', measurePublicRoofEstimate: jest.fn() }))
jest.mock('@/lib/job-sold-scope', () => ({
  buildJobSoldScope: jest.fn(async () => ({ total_squares: 34.5, total_squares_source: 'proposal_enriched' })),
}))

import {
  runAccuracyChecks,
  classifyTruthSource,
  orderedSquaresFromQtyText,
  pickTruthRow,
  summarizeAccuracy,
  type MeasurementTruthRow,
} from '@/lib/instant-estimate-accuracy'
import {
  calibrationFactorFor,
  calibrationFactorFromRow,
  loadInstantEstimateCalibration,
} from '@/lib/instant-estimate-calibration'
import { DATASETS } from '@/lib/reporting/catalog'

const m = (over: Partial<MeasurementTruthRow>): MeasurementTruthRow => ({
  id: 'm',
  opportunity_id: 'o1',
  address_text: '1 Main St',
  lat: 35.4,
  lng: -80.6,
  source: 'in_house',
  status: 'completed',
  total_squares: 30,
  raw_data: { facets: [{ geometry_source: 'solar_mask_plane' }] },
  updated_at: '2026-10-01T00:00:00Z',
  ...over,
})

describe('summarizeAccuracy', () => {
  it('computes per-source and overall signed/abs medians and ±5/±10 shares', () => {
    const rows = [
      { measure_source: 'lidar', est_base_squares: 31, truth_base_squares: 30 }, // +3.33%
      { measure_source: 'lidar', est_base_squares: 29, truth_base_squares: 30 }, // -3.33%
      { measure_source: 'lidar', est_base_squares: 33, truth_base_squares: 30 }, // +10%
      { measure_source: 'solar_mask', est_base_squares: 24, truth_base_squares: 30 }, // -20%
      { measure_source: 'solar_mask', est_base_squares: '27', truth_base_squares: '30' }, // -10% (numeric strings)
      { measure_source: 'solar_mask', est_base_squares: null, truth_base_squares: 30 }, // ignored
      { measure_source: 'solar_mask', est_base_squares: 20, truth_base_squares: 0 }, // ignored
    ]
    const [all, lidar, solar] = summarizeAccuracy(rows)
    expect(all.measure_source).toBe('all')
    expect(all.n).toBe(5)
    expect(lidar).toEqual({
      measure_source: 'lidar',
      n: 3,
      median_signed_error_pct: 3.3,
      median_abs_error_pct: 3.3,
      within_5_pct: 0.667,
      within_10_pct: 1,
    })
    expect(solar.n).toBe(2)
    expect(solar.median_signed_error_pct).toBe(-15)
    expect(solar.within_5_pct).toBe(0)
    expect(solar.within_10_pct).toBe(0.5)
  })

  it('returns an empty all row for no data', () => {
    expect(summarizeAccuracy([])).toEqual([
      { measure_source: 'all', n: 0, median_signed_error_pct: null, median_abs_error_pct: null, within_5_pct: null, within_10_pct: null },
    ])
  })
})

describe('calibration', () => {
  it('needs at least 8 checks', () => {
    expect(calibrationFactorFromRow(7, 1.1)).toBe(1)
    expect(calibrationFactorFromRow(8, 1.1)).toBe(1.1)
  })
  it('clamps to [0.85, 1.15]', () => {
    expect(calibrationFactorFromRow(20, 1.4)).toBe(1.15)
    expect(calibrationFactorFromRow(20, 0.5)).toBe(0.85)
    expect(calibrationFactorFromRow(20, 0.97)).toBe(0.97)
  })
  it('ignores junk ratios', () => {
    expect(calibrationFactorFromRow(20, null)).toBe(1)
    expect(calibrationFactorFromRow(20, 0)).toBe(1)
    expect(calibrationFactorFromRow('x', 1.1)).toBe(1)
  })
  it('calibrationFactorFor defaults to 1', () => {
    expect(calibrationFactorFor({}, 'lidar')).toBe(1)
    expect(calibrationFactorFor(null, 'lidar')).toBe(1)
    expect(calibrationFactorFor({ lidar: { factor: 1.05, n: 9 } }, 'lidar')).toBe(1.05)
    expect(calibrationFactorFor({ lidar: { factor: 1.05, n: 9 } }, null)).toBe(1)
  })

  const fakeAdmin = (result: { data?: unknown; error?: unknown } | Error) =>
    ({
      from: () => ({
        select: () => ({
          eq: async () => {
            if (result instanceof Error) throw result
            return result
          },
        }),
      }),
    }) as never

  it('loads, applies min-n and clamp, never throws', async () => {
    const map = await loadInstantEstimateCalibration(
      fakeAdmin({
        data: [
          { measure_source: 'solar_mask', n: 12, median_ratio: 1.3 },
          { measure_source: 'lidar', n: 3, median_ratio: 1.08 },
        ],
      }),
      'org'
    )
    expect(map).toEqual({ solar_mask: { factor: 1.15, n: 12 }, lidar: { factor: 1, n: 3 } })
    await expect(loadInstantEstimateCalibration(fakeAdmin({ error: { message: 'no view' } }), 'org')).resolves.toEqual({})
    await expect(loadInstantEstimateCalibration(fakeAdmin(new Error('boom')), 'org')).resolves.toEqual({})
  })

  it('kill switch returns {}', async () => {
    process.env.INSTANT_ESTIMATE_CALIBRATION = 'false'
    try {
      const map = await loadInstantEstimateCalibration(fakeAdmin({ data: [{ measure_source: 'lidar', n: 20, median_ratio: 1.1 }] }), 'org')
      expect(map).toEqual({})
    } finally {
      delete process.env.INSTANT_ESTIMATE_CALIBRATION
    }
  })
})

describe('truth priority', () => {
  it('classifies measurement rows', () => {
    expect(classifyTruthSource(m({ source: 'eagleview', raw_data: null }))).toBe('carrier_report')
    expect(classifyTruthSource(m({ source: 'Roofr', raw_data: null }))).toBe('carrier_report')
    expect(classifyTruthSource(m({ source: 'manual', raw_data: null }))).toBe('manual')
    expect(classifyTruthSource(m({ raw_data: { facets: [{ geometry_source: 'lidar_plane' }, { geometry_source: 'manual_corrected' }] } }))).toBe('in_house_manual')
    expect(classifyTruthSource(m({ raw_data: { facets: [{ geometry_source: 'lidar_plane' }, { geometry_source: 'lidar_plane' }] } }))).toBe('lidar_reviewed')
    expect(classifyTruthSource(m({}))).toBe('in_house_reviewed')
  })

  it('rejects untrusted rows', () => {
    expect(classifyTruthSource(m({ status: 'needs_review' }))).toBeNull()
    expect(classifyTruthSource(m({ total_squares: 0 }))).toBeNull()
    expect(classifyTruthSource(m({ raw_data: { facets: [] } }))).toBeNull()
    expect(classifyTruthSource(m({ source: 'instant_estimate' }))).toBeNull()
  })

  it('prefers carrier > manual > in-house manual > lidar > solar-reviewed, then newest', () => {
    const solar = m({ id: 'solar', updated_at: '2026-10-30T00:00:00Z' })
    const lidar = m({ id: 'lidar', raw_data: { facets: [{ geometry_source: 'lidar_plane' }] }, updated_at: '2026-10-20T00:00:00Z' })
    const carrierOld = m({ id: 'carrier-old', source: 'eagleview', updated_at: '2026-01-01T00:00:00Z' })
    const carrierNew = m({ id: 'carrier-new', source: 'hover', updated_at: '2026-02-01T00:00:00Z' })
    const draft = m({ id: 'draft', source: 'eagleview', status: 'pending', updated_at: '2026-11-01T00:00:00Z' })
    expect(pickTruthRow([solar, lidar])?.row.id).toBe('lidar')
    expect(pickTruthRow([solar, lidar, carrierOld, carrierNew, draft])).toMatchObject({ row: { id: 'carrier-new' }, truthSource: 'carrier_report' })
    expect(pickTruthRow([draft])).toBeNull()
  })

  it('reads ordered squares off the field-shingle line', () => {
    expect(orderedSquaresFromQtyText('30.0 sq · 90 bundles')).toBe(30)
    expect(orderedSquaresFromQtyText('91 bundles')).toBe(30.33)
    expect(orderedSquaresFromQtyText('call supplier')).toBeNull()
    expect(orderedSquaresFromQtyText(null)).toBeNull()
  })
})

describe('report catalog', () => {
  it('exposes the accuracy dataset as company-level, non-money', () => {
    const ds = DATASETS.instant_estimate_accuracy
    expect(ds.view).toBe('rpt_instant_estimate_accuracy')
    expect(ds.ownerColumn).toBeNull()
    expect(ds.columns.some((col) => col.type === 'money')).toBe(false)
  })
})

describe('runAccuracyChecks (mock DB)', () => {
  type Q = { table: string; op: string; filters: [string, string, unknown][]; payload?: unknown }
  const writes: Q[] = []
  const tables: Record<string, (q: Q) => unknown> = {
    roof_measurements: () => [
      m({ id: 'solar-o1', opportunity_id: 'o1', updated_at: '2026-10-30T00:00:00Z' }),
      m({ id: 'ev-o1', opportunity_id: 'o1', source: 'eagleview', total_squares: 30, updated_at: '2026-09-01T00:00:00Z' }),
      m({ id: 'lidar-o2', opportunity_id: 'o2', raw_data: { facets: [{ geometry_source: 'lidar_plane' }] } }),
      m({ id: 'draft-o3', opportunity_id: 'o3', status: 'needs_review' }),
    ],
    instant_estimate_checks: () => [],
    projects: () => [{ id: 'p1', opportunity_id: 'o1' }, { id: 'p2', opportunity_id: 'o2' }],
    production_jobs: (q) =>
      q.filters.some(([op]) => op === 'in')
        ? [
            { id: 'j1', status: 'complete', project_id: 'p1', linked_proposal_id: null, accepted_proposal_id: null, job_type: null, address_text: '1 Main St' },
            { id: 'j2', status: 'cancelled', project_id: 'p2', linked_proposal_id: null, accepted_proposal_id: null, job_type: null, address_text: '2 Main St' },
          ]
        : [],
    proposals: () => [],
    opportunities: () => [{ id: 'o1', lead_id: 'l1', address_text: '1 Main St' }],
    job_material_order_overrides: () => ({ qty_text: '33.0 sq · 99 bundles', excluded: false }),
  }
  const admin = {
    from(table: string) {
      const q: Q = { table, op: 'select', filters: [] }
      const b: Record<string, unknown> = {}
      for (const name of ['select', 'eq', 'gt', 'not', 'order', 'limit', 'in', 'or']) {
        b[name] = (...args: unknown[]) => {
          if (name !== 'select' || q.op === 'select') q.filters.push([name, String(args[0]), args[1]])
          return b
        }
      }
      b.insert = (payload: unknown) => ((q.op = 'insert'), (q.payload = payload), writes.push(q), b)
      b.update = (payload: unknown) => ((q.op = 'update'), (q.payload = payload), writes.push(q), b)
      b.maybeSingle = async () => ({ data: q.op === 'select' ? (table === 'instant_estimate_checks' ? null : tables[table](q)) : null, error: null })
      b.then = (resolve: (v: unknown) => unknown) => resolve({ data: q.op === 'select' ? tables[table](q) : null, error: null })
      return b
    },
  } as never

  it('checks the best-truth property, skips cancelled jobs and untrusted rows, records sold + ordered squares', async () => {
    const measure = jest.fn(async () => ({
      ok: true as const,
      result: {
        address: '1 Main St', lat: 35.4, lng: -80.6, squares_mid: 35, base_squares: 31, waste_percent: 12, facet_count: 6,
        measure_source: 'solar_mask', confidence: 'standard', flags: ['stale_imagery'], estimate_version: 'ie-test',
        calibration_factor: 1, requires_manual_measure: false,
      },
    }))
    const res = await runAccuracyChecks(admin, 'org', { limit: 5, measure: measure as never })
    expect(measure).toHaveBeenCalledTimes(1)
    // Geocodes the address like the website does (saved coordinates are only a fallback).
    expect(measure).toHaveBeenCalledWith('1 Main St', { shadow: true, orgId: 'org' })
    expect(res).toMatchObject({ estimateVersion: 'ie-test', candidates: 1, checked: 1, failed: 0 })
    const insert = writes.find((w) => w.table === 'instant_estimate_checks' && w.op === 'insert')
    expect(insert?.payload).toMatchObject({
      org_id: 'org', opportunity_id: 'o1', production_job_id: 'j1', lead_id: 'l1', estimate_version: 'ie-test',
      truth_source: 'carrier_report', truth_base_squares: 30, truth_squares_with_waste: 34.5, ordered_squares: 33,
      est_base_squares: 31, est_squares_with_waste: 35, measure_source: 'solar_mask', flags: ['stale_imagery'],
    })
  })
})
