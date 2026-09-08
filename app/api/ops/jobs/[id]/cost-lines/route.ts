import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'

const COST_TYPES = ['material', 'labor', 'permit', 'subcontractor', 'misc', 'other'] as const

/**
 * GET /api/ops/jobs/[id]/cost-lines
 *
 * The card used to read `job_cost_lines` straight from the browser/anon Supabase
 * client. That never worked: this app keeps its session in an httpOnly cookie, so
 * `createBrowserClient` cannot see it and the client is anonymous — while the
 * table's SELECT policy is `org_id = get_user_org_id(auth.uid())`, which returns
 * ZERO rows for `auth.uid() = null`. So the Costs list read "No job cost lines
 * yet" on every job, including ones with real lines, which is very likely how job
 * 26-0041 ended up with the same $5,421.03 cost entered twice: logged here, seen
 * nowhere, logged again on the Materials tab where it did show.
 *
 * Photos and documents in the same card already come through authenticated routes
 * like this one; cost lines were the odd leg out.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { authUser, profile } = await requireAuthApi()
    const supabase = createServiceClient()

    // Same gates the card itself assumes: the ops board to see the list at all,
    // and job financials to see the money. Without the second, this route would
    // hand cost amounts to any authenticated user in the org, which is wider than
    // the UI that consumes it — the card blanks amounts for those roles.
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

    const { data, error } = await supabase
      .from('job_cost_lines')
      .select('id, description, amount, cost_type, status, approved, vendors(name)')
      .eq('job_id', params.id)
      .eq('org_id', profile.org_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('[cost-lines GET]', error)
      return NextResponse.json(
        { error: 'Failed to load cost lines', code: error.code ?? null },
        { status: 500 }
      )
    }

    const costLines = (data ?? []).map((line) =>
      canViewJobFinancials ? line : { ...line, amount: null }
    )

    return NextResponse.json({ costLines })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const jobId = params.id

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
    const description = String(body.description || '').trim()
    const costType = (COST_TYPES as readonly string[]).includes(body.cost_type)
      ? body.cost_type
      : 'other'
    const amountRaw = body.amount
    const amountParsed =
      typeof amountRaw === 'number' && !Number.isNaN(amountRaw)
        ? amountRaw
        : parseFloat(String(amountRaw ?? '0'))
    const amount = Number.isFinite(amountParsed) ? amountParsed : 0

    if (!description) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 })
    }
    if (amount < 0) {
      return NextResponse.json({ error: 'Amount cannot be negative' }, { status: 400 })
    }

    const { data: row, error } = await supabase
      .from('job_cost_lines')
      .insert({
        org_id: profile.org_id,
        job_id: jobId,
        description,
        amount,
        cost_type: costType,
        status: 'active',
        created_by: profile.id,
        // New lines start unreviewed — a payroll admin must approve before this line can
        // reduce a rep's commission base (see derivePayrollEligibility in
        // lib/payroll-period-materialization.ts, which already blocks/excludes unapproved
        // deductible lines). Without this, the DB default (true) makes every entry
        // instantly commission-deductible with no review step.
        approved: false,
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
