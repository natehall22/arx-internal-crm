import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'
import {
  isDealerFeeCostLine,
  normalizeJobCostType,
  resolveVendorId,
  signedCostAmount,
} from '@/lib/job-cost-ledger'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { costTypeForCode, isCostCodeSlug } from '@/lib/cost-codes'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { isMissingProjectToolsSchema, loadCostCodes, PROJECT_TOOLS_NOT_READY } from '@/lib/project-tools/budget-db'

export const runtime = 'nodejs'

type RouteParams = { params: { id: string; costLineId: string } }

async function loadLine(
  supabase: ReturnType<typeof createServiceClient>,
  orgId: string,
  jobId: string,
  costLineId: string
) {
  const { data } = await supabase
    .from('job_cost_lines')
    .select('id, job_id, org_id, description, amount, cost_type, approved, source')
    .eq('id', costLineId)
    .eq('job_id', jobId)
    .eq('org_id', orgId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle()
  return data as
    | { id: string; description: string; amount: number; cost_type: string; approved: boolean; source: string | null }
    | null
}

/** Crew time lines are written by the time clock feed (lib/time-tracking-db.ts); a hand edit would be overwritten. */
const VENDOR_BILL_LOCKED = 'This cost comes from a vendor bill on a purchase order. Change or void the bill on the order, not here.'
const TIME_CLOCK_LOCKED = 'This line comes from the crew time clock. Fix the time in Time (it updates this line), not here.'

const DEALER_FEE_LOCKED =
  'The lender / dealer fee comes from the sale\'s financing. Change it under Financial source, not here.'

/**
 * PATCH — two jobs, never both in one call:
 *  - `{ approved: boolean }` — a payroll admin (admin/owner/operations) reviews the line.
 *  - `{ description?, amount?, cost_type?, credit? }` — edit (Materials card "Edit"). Changing
 *    the amount or type of an approved line sends it back for review, so an approval always
 *    refers to the number on screen.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  let profile
  let authUser
  try {
    const ctx = await requireAuthApi()
    profile = ctx.profile
    authUser = ctx.authUser
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createServiceClient()
    const jobId = params.id
    const costLineId = params.costLineId
    const body = await request.json().catch(() => ({}))

    if ('approved' in body) {
      if (!isPayrollAdminRole(profile.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (typeof body.approved !== 'boolean') {
        return NextResponse.json({ error: 'approved (boolean) is required' }, { status: 400 })
      }
      const existing = await loadLine(supabase, profile.org_id, jobId, costLineId)
      if (!existing) {
        return NextResponse.json({ error: 'Cost line not found' }, { status: 404 })
      }
      const { data: row, error } = await supabase
        .from('job_cost_lines')
        .update({
          approved: body.approved,
          approved_by: body.approved ? authUser.id : null,
          approved_at: body.approved ? new Date().toISOString() : null,
        })
        .eq('id', costLineId)
        .eq('org_id', profile.org_id)
        .select('id, approved, approved_by, approved_at')
        .single()
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ cost_line: row })
    }

    const { canJobBoard, canViewJobFinancials } = await resolveOpsAccess(
      supabase,
      authUser.id,
      profile
    )
    if (!canJobBoard || !(await callerCanAccessJobBilling(supabase, profile))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const existing = await loadLine(supabase, profile.org_id, jobId, costLineId)
    if (!existing) {
      return NextResponse.json({ error: 'Cost line not found' }, { status: 404 })
    }
    if (isDealerFeeCostLine(existing)) {
      return NextResponse.json({ error: DEALER_FEE_LOCKED }, { status: 409 })
    }
    if (existing.source === 'time_entries') {
      return NextResponse.json({ error: TIME_CLOCK_LOCKED }, { status: 409 })
    }
    if (existing.source === 'vendor_bill') {
      return NextResponse.json({ error: VENDOR_BILL_LOCKED }, { status: 409 })
    }

    const patch: Record<string, unknown> = {}
    if (body.description !== undefined) {
      const desc = String(body.description || '').trim()
      if (!desc) {
        return NextResponse.json({ error: 'Description cannot be empty' }, { status: 400 })
      }
      patch.description = desc
    }
    if (body.amount !== undefined) {
      if (!canViewJobFinancials) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const n = typeof body.amount === 'number' ? body.amount : parseFloat(String(body.amount))
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
      }
      patch.amount = signedCostAmount(n, body.credit === undefined ? Number(existing.amount) < 0 : body.credit === true)
    }
    if (body.supplier !== undefined) {
      patch.vendor_id = await resolveVendorId(supabase, profile.org_id, body.supplier, profile.id)
    }
    if (body.cost_type !== undefined) {
      patch.cost_type = normalizeJobCostType(body.cost_type, existing.cost_type as never)
    }
    // Ignored when the company has project tools off.
    if (body.cost_code !== undefined && (await isOrgFeatureOn(profile.org_id, 'projectTools'))) {
      // Project tools: re-code a line (null clears it back to its cost_type's default code).
      if (body.cost_code === null || body.cost_code === '') {
        patch.cost_code = null
      } else {
        const codes = await loadCostCodes(supabase, profile.org_id)
        if (!isCostCodeSlug(body.cost_code) || !codes.some((c) => c.code === body.cost_code)) {
          return NextResponse.json({ error: 'That cost code is not on your list' }, { status: 400 })
        }
        patch.cost_code = body.cost_code
        patch.cost_type = normalizeJobCostType(costTypeForCode(body.cost_code, codes), 'other')
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: 'Provide at least one of: description, supplier, amount, cost_type' },
        { status: 400 }
      )
    }

    const moneyChanged =
      (patch.amount !== undefined && Number(patch.amount) !== Number(existing.amount)) ||
      (patch.cost_type !== undefined && patch.cost_type !== existing.cost_type)
    if (moneyChanged && existing.approved) {
      patch.approved = false
      patch.approved_by = null
      patch.approved_at = null
    }

    const { data: row, error } = await supabase
      .from('job_cost_lines')
      .update(patch)
      .eq('id', costLineId)
      .eq('org_id', profile.org_id)
      .select('id, description, amount, cost_type, status, approved')
      .single()
    if (error) {
      if (patch.cost_code !== undefined && isMissingProjectToolsSchema(error)) return NextResponse.json({ error: PROJECT_TOOLS_NOT_READY }, { status: 409 })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ cost_line: row })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * DELETE — soft delete (status archived + deleted_at), admin only, same rule the old
 * Materials-tab delete had. Readers ignore archived lines, so it drops out of every total.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  let profile
  try {
    profile = (await requireAuthApi()).profile
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (profile.role !== 'admin' || !(await callerCanAccessJobBilling(createServiceClient(), profile))) {
    return NextResponse.json({ error: 'Only admins can delete job costs' }, { status: 403 })
  }

  try {
    const supabase = createServiceClient()
    const existing = await loadLine(supabase, profile.org_id, params.id, params.costLineId)
    if (!existing) {
      return NextResponse.json({ error: 'Cost line not found' }, { status: 404 })
    }
    if (isDealerFeeCostLine(existing)) {
      return NextResponse.json({ error: DEALER_FEE_LOCKED }, { status: 409 })
    }
    if (existing.source === 'time_entries') {
      return NextResponse.json({ error: TIME_CLOCK_LOCKED }, { status: 409 })
    }
    if (existing.source === 'vendor_bill') {
      return NextResponse.json({ error: VENDOR_BILL_LOCKED }, { status: 409 })
    }
    const { error } = await supabase
      .from('job_cost_lines')
      .update({ status: 'archived', deleted_at: new Date().toISOString(), deleted_by: profile.id })
      .eq('id', params.costLineId)
      .eq('org_id', profile.org_id)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
