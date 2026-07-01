export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'
import { buildMaterialsOrderList } from '@/lib/materials-order-list'
import { buildMaterialsExtras } from '@/lib/materials-order-extras'
import { resolveMaterialsCoverageOverrides } from '@/lib/materials-coverage-overrides'
import { applyMaterialOrderOverrides } from '@/lib/materials-order-overrides'
import PrintOrderSheetButton from './PrintOrderSheetButton'

function positiveLinearFt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n) || n <= 0) return null
  return Math.round(n * 10) / 10
}

function buildRoofMeasurementLinear(row: {
  ridges_lf?: number | null
  valleys_lf?: number | null
  hips_lf?: number | null
  eaves_lf?: number | null
  rakes_lf?: number | null
  flashing_lf?: number | null
  step_flashing_lf?: number | null
  drip_edge_lf?: number | null
  source?: string | null
  raw_data?: unknown
} | null) {
  if (!row) return null
  const raw =
    row.raw_data && typeof row.raw_data === 'object' && !Array.isArray(row.raw_data)
      ? (row.raw_data as Record<string, unknown>)
      : null

  const out = {
    source: row.source ?? null,
    ridges_lf: positiveLinearFt(row.ridges_lf),
    valleys_lf: positiveLinearFt(row.valleys_lf),
    hips_lf: positiveLinearFt(row.hips_lf),
    eaves_lf: positiveLinearFt(row.eaves_lf),
    rakes_lf: positiveLinearFt(row.rakes_lf),
    flashing_lf: positiveLinearFt(row.flashing_lf),
    step_flashing_lf:
      positiveLinearFt(row.step_flashing_lf) ?? (raw ? positiveLinearFt(raw.step_flashing_lf) : null),
    wall_flashing_lf: raw ? positiveLinearFt(raw.wall_flashing_lf) : null,
    drip_edge_lf: positiveLinearFt(row.drip_edge_lf) ?? (raw ? positiveLinearFt(raw.drip_edge_lf) : null),
  }

  const hasNumeric =
    out.ridges_lf != null ||
    out.valleys_lf != null ||
    out.hips_lf != null ||
    out.eaves_lf != null ||
    out.rakes_lf != null ||
    out.flashing_lf != null ||
    out.step_flashing_lf != null ||
    out.wall_flashing_lf != null

  return hasNumeric ? out : null
}

export default async function MaterialOrderPrintPage({ params }: { params: { id: string } }) {
  const { authUser, profile } = await requireAuth()
  const admin = createServiceClient()
  const { canJobBoard } = await resolveOpsAccess(admin, authUser.id, profile)
  if (!canJobBoard) redirect('/dashboard')

  const { data: job } = await admin
    .from('production_jobs')
    .select(
      'id, org_id, job_number, address_text, total_squares, measured_squares, sold_waste_percent, linked_proposal_id, customer:customers(name), project:projects(opportunity_id, customers(name), leads(homeowner_name))'
    )
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .maybeSingle()

  if (!job) notFound()

  const rawCustomer = Array.isArray(job.customer) ? job.customer[0] : job.customer
  const rawProject = Array.isArray(job.project) ? job.project[0] : job.project
  const projectCustomer = rawProject
    ? Array.isArray(rawProject.customers)
      ? rawProject.customers[0]
      : rawProject.customers
    : null
  const projectLead = rawProject
    ? Array.isArray(rawProject.leads)
      ? rawProject.leads[0]
      : rawProject.leads
    : null
  const customerName =
    rawCustomer?.name || projectCustomer?.name || projectLead?.homeowner_name || 'Customer'

  let proposalNumber: string | null = null
  let totalSquares: number | null =
    typeof job.total_squares === 'number' && job.total_squares > 0 ? job.total_squares : null
  let measurementRow: {
    penetration_count?: number | null
    raw_data?: unknown
    ridges_lf?: number | null
    valleys_lf?: number | null
    hips_lf?: number | null
    eaves_lf?: number | null
    rakes_lf?: number | null
    flashing_lf?: number | null
    step_flashing_lf?: number | null
    drip_edge_lf?: number | null
    source?: string | null
  } | null = null

  if (job.linked_proposal_id) {
    const { data: proposal } = await admin
      .from('proposals')
      .select('proposal_number, total_squares, measurement_id')
      .eq('id', job.linked_proposal_id)
      .maybeSingle()
    proposalNumber = proposal?.proposal_number ?? null
    if (totalSquares == null && proposal?.total_squares) {
      totalSquares = proposal.total_squares
    }
    if (proposal?.measurement_id) {
      const { data: measure } = await admin
        .from('roof_measurements')
        .select(
          'ridges_lf, valleys_lf, hips_lf, eaves_lf, rakes_lf, flashing_lf, step_flashing_lf, drip_edge_lf, penetration_count, source, raw_data'
        )
        .eq('id', proposal.measurement_id)
        .maybeSingle()
      measurementRow = measure
    }
  }

  const [{ data: orgRow }, { data: overrideRows }] = await Promise.all([
    admin
      .from('orgs')
      .select(
        'starter_lf_per_bundle, cap_lf_per_bundle, underlayment_sq_per_roll, ridge_vent_lf_per_piece, ridge_vent_end_setback_ft, ice_water_lf_per_roll'
      )
      .eq('id', profile.org_id)
      .maybeSingle(),
    admin
      .from('job_material_order_overrides')
      .select('id, job_id, item_key, qty_text, excluded, note, updated_by, updated_at')
      .eq('job_id', params.id),
  ])

  const coverageOverrides = resolveMaterialsCoverageOverrides(orgRow)
  const linear = buildRoofMeasurementLinear(measurementRow)
  const extras = buildMaterialsExtras(measurementRow)

  const computed = buildMaterialsOrderList({
    totalSquaresWithWaste: totalSquares,
    linear,
    ridgeSegmentCount: extras?.ridge_segment_count ?? null,
    lowSlopeAreaSqft: extras?.low_slope_area_sqft ?? null,
    lowSlopeFacetCount: extras?.low_slope_facet_count ?? null,
    penetrationCount: extras?.penetration_count ?? null,
    coverageOverrides,
  })

  const items = applyMaterialOrderOverrides(computed, overrideRows ?? []).filter((i) => !i.isExcluded)

  const sections: { title: string; rows: typeof items }[] = [
    { title: 'Order', rows: items.filter((i) => i.status === 'ready') },
    { title: 'Confirm before ordering', rows: items.filter((i) => i.status === 'confirm') },
    { title: 'Manual — count in field', rows: items.filter((i) => i.status === 'manual') },
  ]

  const printedAt = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  return (
    <main className="min-h-screen bg-white text-[#2c2c2a]">
      <div className="no-print mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
        <Link href={`/ops/jobs/${params.id}`} className="text-sm font-medium text-indigo-700">
          Back to job
        </Link>
        <PrintOrderSheetButton />
      </div>

      <div className="mx-auto max-w-4xl px-6 pb-12 print:px-0">
        <header className="border-b border-gray-300 pb-4 mb-6">
          <h1 className="text-2xl font-bold text-[#2c2c2a]">Materials Order Sheet</h1>
          <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <p>
              <span className="font-semibold">Job:</span> {job.job_number || params.id}
            </p>
            <p>
              <span className="font-semibold">Date:</span> {printedAt}
            </p>
            <p>
              <span className="font-semibold">Customer:</span> {customerName}
            </p>
            <p>
              <span className="font-semibold">Proposal:</span> {proposalNumber || '—'}
            </p>
            <p className="col-span-2">
              <span className="font-semibold">Address:</span> {job.address_text || '—'}
            </p>
          </div>
        </header>

        {sections.map(
          (section) =>
            section.rows.length > 0 && (
              <section key={section.title} className="mb-8">
                <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#2c2c2a]">
                  {section.title}
                </h2>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-gray-800 text-left">
                      <th className="py-2 pr-3 font-semibold">Item</th>
                      <th className="py-2 pr-3 font-semibold">Computed qty</th>
                      <th className="py-2 pr-3 font-semibold">Actual qty</th>
                      <th className="py-2 font-semibold">Supplier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row) => (
                      <tr key={row.key} className="border-b border-gray-300">
                        <td className="py-2 pr-3 align-top">
                          <div className="font-medium">{row.label}</div>
                          {row.detail ? <div className="text-xs text-gray-700">{row.detail}</div> : null}
                          {row.note ? <div className="text-xs text-gray-800">{row.note}</div> : null}
                        </td>
                        <td className="py-2 pr-3 align-top tabular-nums">{row.qty || '—'}</td>
                        <td className="py-2 pr-3 align-top">&nbsp;</td>
                        <td className="py-2 align-top">&nbsp;</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )
        )}
      </div>
    </main>
  )
}
