import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'
import {
  NEW_COST_LINE_PAYROLL_FLAGS,
  ledgerSummaryFor,
  loadJobCostLedger,
  normalizeJobCostType,
  resolveVendorId,
  signedCostAmount,
} from '@/lib/job-cost-ledger'

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
    const { authUser, profile } = ctx
    const supabase = createServiceClient()
    const jobId = params.id

    const { canJobBoard } = await resolveOpsAccess(supabase, authUser.id, profile)
    if (!canJobBoard) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: job } = await supabase
      .from('production_jobs')
      .select('id, org_id')
      .eq('id', jobId)
      .eq('org_id', profile.org_id)
      .single()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const rawDescription = String(body.description || '').trim()
    const costType = normalizeJobCostType(body.cost_type, 'other')
    const amountRaw = body.amount
    const amountParsed =
      typeof amountRaw === 'number' && !Number.isNaN(amountRaw)
        ? amountRaw
        : parseFloat(String(amountRaw ?? '0'))
    const amount = Number.isFinite(amountParsed) ? amountParsed : 0

    if (!rawDescription) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 })
    }
    if (amount < 0) {
      return NextResponse.json(
        { error: 'Amount cannot be negative. For a return or refund, tick "Return / credit".' },
        { status: 400 }
      )
    }

    const vendorId = await resolveVendorId(supabase, profile.org_id, body.supplier ?? null, profile.id)

    const { data: row, error } = await supabase
      .from('job_cost_lines')
      .insert({
        org_id: profile.org_id,
        job_id: jobId,
        description: rawDescription,
        vendor_id: vendorId,
        source: 'manual',
        amount: signedCostAmount(amount, body.credit === true),
        cost_type: costType,
        status: 'active',
        incurred_on: new Date().toISOString().slice(0, 10),
        created_by: profile.id,
        ...NEW_COST_LINE_PAYROLL_FLAGS,
      })
      .select('id, description, amount, cost_type, status, approved')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ cost_line: row })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
