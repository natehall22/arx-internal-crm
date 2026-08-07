/**
 * Read/write `orgs.inspection_commission_rate` — the percent of a job's commission base
 * paid to whoever ran the inspection, when no explicit `deal_commission_roles` inspector
 * row exists for that job (see lib/job-inspector-attribution.ts).
 *
 * Payroll-admin only. A rate of 0 silently switches the whole derived inspection line off,
 * so setting 0 requires an explicit `confirm_disable` flag from the caller — an admin must
 * not be able to turn off a pay line by tabbing through a field.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { normalizeInspectionRate } from '@/lib/job-inspector-attribution'

export const dynamic = 'force-dynamic'

/** NUMERIC(5,2) holds up to 999.99, but a commission rate above this is a typo, not a plan. */
const MAX_INSPECTION_RATE = 25

async function requirePayrollAdmin() {
  const ctx = await requireAuthApi()
  if (!isPayrollAdminRole(ctx.profile.role)) return null
  return ctx.profile
}

export async function GET() {
  let profile
  try {
    profile = await requirePayrollAdmin()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('orgs')
      .select('inspection_commission_rate')
      .eq('id', profile.org_id)
      .maybeSingle()

    if (error) {
      console.error('inspection-rate GET', error)
      return NextResponse.json({ error: 'Failed to load inspection rate' }, { status: 500 })
    }

    const rate = normalizeInspectionRate(data?.inspection_commission_rate)
    return NextResponse.json({ rate, enabled: rate > 0, maxRate: MAX_INSPECTION_RATE })
  } catch (e) {
    console.error('inspection-rate GET', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  let profile
  try {
    profile = await requirePayrollAdmin()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = (await request.json().catch(() => ({}))) as {
      rate?: unknown
      confirm_disable?: unknown
    }

    const raw = typeof body.rate === 'string' ? body.rate.trim() : body.rate
    if (raw === '' || raw == null) {
      return NextResponse.json({ error: 'A rate is required' }, { status: 400 })
    }

    const rate = Number(raw)
    if (!Number.isFinite(rate)) {
      return NextResponse.json({ error: 'Rate must be a number' }, { status: 400 })
    }
    if (rate < 0) {
      return NextResponse.json({ error: 'Rate cannot be negative' }, { status: 400 })
    }
    if (rate > MAX_INSPECTION_RATE) {
      return NextResponse.json(
        { error: `Rate cannot exceed ${MAX_INSPECTION_RATE}% — check for a typo` },
        { status: 400 }
      )
    }
    // NUMERIC(5,2): silently rounding a third decimal would misstate pay.
    if (Math.round(rate * 100) !== rate * 100) {
      return NextResponse.json(
        { error: 'Rate supports at most 2 decimal places (e.g. 1.50)' },
        { status: 400 }
      )
    }

    // 0 disables the derived inspection line for every job in the org. Never accept it
    // without the caller explicitly acknowledging that.
    if (rate === 0 && body.confirm_disable !== true) {
      return NextResponse.json(
        {
          error:
            'Setting the rate to 0 turns the inspection commission off for the whole org. ' +
            'Confirm the change to continue.',
          code: 'confirm_disable_required',
        },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('orgs')
      .update({ inspection_commission_rate: rate })
      .eq('id', profile.org_id)
      .select('inspection_commission_rate')
      .maybeSingle()

    if (error) {
      console.error('inspection-rate PATCH', error)
      return NextResponse.json({ error: 'Failed to save inspection rate' }, { status: 500 })
    }

    const saved = normalizeInspectionRate(data?.inspection_commission_rate)
    return NextResponse.json({ rate: saved, enabled: saved > 0 })
  } catch (e) {
    console.error('inspection-rate PATCH', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
