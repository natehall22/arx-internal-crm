/**
 * Materials Order Sheet — the one-page "what to buy" hand-off ops sends to the supplier.
 *
 * Sibling of {@link buildJobRunSheet}: the run sheet goes to the crew, this goes to the supplier.
 * Both are assembled fresh per request and never cached, because an order sheet that lags behind
 * an ops quantity edit is worse than no order sheet at all.
 *
 * This is the single assembly for the sheet. The print page and the PDF route both call it so the
 * paper a supplier gets and the screen ops looked at can never quote different numbers.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { buildJobSoldScope } from '@/lib/job-sold-scope'
import { resolveMaterialsCoverageOverrides } from '@/lib/materials-coverage-overrides'
import { buildMaterialsOrderList } from '@/lib/materials-order-list'
import {
  applyMaterialOrderOverrides,
  type DisplayMaterialsOrderItem,
} from '@/lib/materials-order-overrides'

export type JobMaterialOrderSection = {
  title: string
  rows: DisplayMaterialsOrderItem[]
}

export type JobMaterialOrderData = {
  jobId: string
  orgName: string
  orgPhone: string | null
  jobNumber: string
  customerName: string
  address: string | null
  proposalNumber: string | null
  sections: JobMaterialOrderSection[]
  /** True when nothing at all resolved — the caller should say so rather than print an empty sheet. */
  isEmpty: boolean
  generatedAt: string
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export async function buildJobMaterialOrder(
  admin: SupabaseClient,
  orgId: string,
  jobId: string
): Promise<JobMaterialOrderData | null> {
  const { data: job } = await admin
    .from('production_jobs')
    .select(
      'id, org_id, job_number, job_type, address_text, project_id, linked_proposal_id, accepted_proposal_id, customer:customers(name), project:projects(opportunity_id, sold_roof_squares, customers(name), leads(homeowner_name))'
    )
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (!job) return null

  const rawProject = firstOf(job.project as any)
  const customerName =
    firstOf(job.customer as any)?.name ||
    firstOf(rawProject?.customers)?.name ||
    firstOf(rawProject?.leads)?.homeowner_name ||
    'Customer'

  const [scope, orgRes, overridesRes] = await Promise.all([
    buildJobSoldScope({ admin, orgId, job }),
    admin.from('orgs').select(
      'name, phone, starter_lf_per_bundle, cap_lf_per_bundle, underlayment_sq_per_roll, ridge_vent_lf_per_piece, ridge_vent_end_setback_ft, ice_water_lf_per_roll'
    ).eq('id', orgId).maybeSingle(),
    admin
      .from('job_material_order_overrides')
      .select('id, job_id, item_key, qty_text, excluded, note, updated_by, updated_at')
      .eq('job_id', jobId),
  ])

  const computed = buildMaterialsOrderList({
    totalSquaresWithWaste: scope?.total_squares ?? null,
    linear: scope?.roof_measurement_linear ?? null,
    ridgeSegmentCount: scope?.materials_extras?.ridge_segment_count ?? null,
    lowSlopeAreaSqft: scope?.materials_extras?.low_slope_area_sqft ?? null,
    lowSlopeFacetCount: scope?.materials_extras?.low_slope_facet_count ?? null,
    penetrationCount: scope?.materials_extras?.penetration_count ?? null,
    coverageOverrides: resolveMaterialsCoverageOverrides(orgRes.data),
  })

  // Excluded rows are ops saying "not on this order" — they must not reach the supplier.
  const items = applyMaterialOrderOverrides(computed, overridesRes.data ?? []).filter(
    (item) => !item.isExcluded
  )

  const sections: JobMaterialOrderSection[] = [
    { title: 'Order', rows: items.filter((i) => i.status === 'ready') },
    { title: 'Confirm before ordering', rows: items.filter((i) => i.status === 'confirm') },
    { title: 'Manual — count in field', rows: items.filter((i) => i.status === 'manual') },
  ].filter((section) => section.rows.length > 0)

  return {
    jobId,
    orgName: orgRes.data?.name || 'ARX Roofing & Exteriors',
    orgPhone: orgRes.data?.phone ?? null,
    jobNumber: job.job_number || jobId,
    customerName,
    address: job.address_text ?? null,
    proposalNumber: scope?.proposal_number ?? null,
    sections,
    isEmpty: items.length === 0,
    generatedAt: new Date().toISOString(),
  }
}
