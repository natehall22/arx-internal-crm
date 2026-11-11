import { cutoffYmd, weekCutoffContaining } from '@/lib/payroll-week-schedule'
import { loadPayWeekSchedule } from '@/lib/payroll-week-schedule-server'
import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'
import {
  addJobCostLine,
  ledgerSummaryFor,
  normalizeJobCostType,
  loadJobCostLedger,
  resolveVendorId,
} from '@/lib/job-cost-ledger'
import { authorizeJobCost, parseCostInput } from '@/lib/job-cost-record'
import { costTypeForCode, isCostCodeSlug } from '@/lib/cost-codes'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { loadCostCodes, PROJECT_TOOLS_NOT_READY } from '@/lib/project-tools/budget-db'

export const runtime = 'nodejs'

/**
 * GET /api/ops/jobs/[id]/cost-lines — the job's cost ledger (`lib/job-cost-ledger.ts`).
 *
 * Returns every live line plus the summary the job page Financials card uses for Est. profit,
 * so the Materials card, the Photos & files card and Financials all show the same numbers.
 * (Before 2026-09-07 the Files card read this table through the anon browser client, got zero
 * rows on every job, and 26-0041's $5,421.03 was entered a second time on the Materials tab.)
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { authUser, profile } = await requireAuthApi()
    const supabase = createServiceClient()

    // The board to see the list at all; job financials to see the money.
    const { canJobBoard, canViewJobFinancials } = await resolveOpsAccess(
      supabase,
      authUser.id,
      profile
    )
    if (!canJobBoard) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: job } = await supabase
      .from('production_jobs')
      .select('id, org_id')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    let ledger
    try {
      ledger = await loadJobCostLedger(supabase, profile.org_id, [params.id])
    } catch (error: any) {
      console.error('[cost-lines GET]', error)
      return NextResponse.json(
        { error: 'Failed to load cost lines', code: error?.code ?? null },
        { status: 500 }
      )
    }

    const lines = ledger.get(params.id)?.lines ?? []
    const costLines = lines.map((line) => ({
      id: line.id,
      description: line.description,
      amount: canViewJobFinancials ? line.amount : null,
      cost_type: line.cost_type,
      status: 'active',
      approved: line.approved,
      created_at: line.created_at,
      vendor_id: line.vendor_id,
      vendors: line.vendor_name ? { name: line.vendor_name } : null,
    }))

    return NextResponse.json({
      costLines,
      summary: canViewJobFinancials ? ledgerSummaryFor(ledger, params.id) : null,
    })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

/**
 * POST — the ONE way a cost gets onto a job. Materials card "+ Job Cost" and the Photos & files
 * "+ Add cost line" both call this. (`/api/jobs/[id]/product-orders` was deleted 2026-10-21.)
 *
 * Body: { description, amount, cost_type?, supplier?, credit? }. `credit: true` stores a return
 * or refund as a negative amount; a raw negative amount is still rejected as a likely typo.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  let ctx
  try {
    ctx = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { profile } = ctx
    const supabase = createServiceClient()
    const jobId = params.id

    const gate = await authorizeJobCost(supabase, profile, jobId)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

    const body = await request.json().catch(() => ({}))
    const input = parseCostInput(body)
    if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 })
    const { description: rawDescription, amount } = input.value
    let costType = input.value.costType
    // Project tools: a cost code from the company's list rides on the line; its cost_type keeps the Materials/Labor/Other rollups right.
    let costCode: string | null = null
    // Only when the company has project tools on: otherwise a cost_code in the body is ignored (the line is just a line).
    if (isCostCodeSlug(body.cost_code) && (await isOrgFeatureOn(profile.org_id, 'projectTools'))) {
      const codes = await loadCostCodes(supabase, profile.org_id)
      if (!codes.some((c) => c.code === body.cost_code && c.active)) {
        return NextResponse.json({ error: 'That cost code is not on your list' }, { status: 400 })
      }
      costCode = body.cost_code
      costType = normalizeJobCostType(costTypeForCode(body.cost_code, codes), 'other')
    }

    const vendorId = await resolveVendorId(supabase, profile.org_id, body.supplier ?? null, profile.id)

    const written = await addJobCostLine(supabase, {
      orgId: profile.org_id,
      jobId,
      userId: profile.id,
      description: rawDescription,
      amount,
      costType,
      credit: body.credit === true,
      vendorId,
      source: 'manual',
      costCode,
    })
    if (!written.ok) {
      // cost_code column not there yet (migration not applied): say so, do not 500.
      if (written.missingSchema) return NextResponse.json({ error: PROJECT_TOOLS_NOT_READY }, { status: 409 })
      return NextResponse.json({ error: written.error }, { status: 500 })
    }
    const row = written.line

    // A labor line typed for a job whose crew time this week already comes from the time clock: likely the same work twice.
    let warning: string | undefined
    if (costType === 'labor') {
      // This pay week on the company's own schedule (the week the time clock writes its line for).
      const payWeek = await loadPayWeekSchedule(supabase, profile.org_id).catch(() => null)
      if (payWeek) {
        const { data: clockLine, error: clockErr } = await supabase
          .from('job_cost_lines')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('job_id', jobId)
          .eq('time_week_ending', cutoffYmd(weekCutoffContaining(new Date(), payWeek), payWeek))
          .is('deleted_at', null)
          .limit(1)
        if (!clockErr && (clockLine ?? []).length > 0) warning = 'This week’s crew time on this job already comes from the time clock. If this is the same work, remove one of the two lines.'
      }
    }

    return NextResponse.json({ cost_line: row, ...(warning ? { warning } : {}) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
