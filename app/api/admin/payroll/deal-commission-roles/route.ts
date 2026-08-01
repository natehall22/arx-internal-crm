import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'

export const dynamic = 'force-dynamic'

/** Mirrors the deal_commission_roles role CHECK constraint. */
const STORAGE_ROLES = new Set([
  'setter',
  'closer',
  'inspector',
  'field_manager',
  'senior_manager',
  'custom',
])

/** Statement/payout role names that map onto a storage role. */
const ROLE_MAP: Record<string, string> = {
  owner: 'closer',
  sales_rep: 'closer',
}

export async function PATCH(request: NextRequest) {
  try {
    let profile
    try {
      const ctx = await requireAuthApi()
      profile = ctx.profile
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isPayrollAdminRole(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json()) as {
      job_id?: string
      user_id?: string
      role?: string
      override_amount?: number | null
      override_percent?: number | null
      reason?: string
    }

    if (!body.job_id || !body.user_id || !body.role) {
      return NextResponse.json(
        { error: 'job_id, user_id, and role are required' },
        { status: 400 }
      )
    }

    const storageRole = ROLE_MAP[body.role] || body.role
    if (!STORAGE_ROLES.has(storageRole)) {
      return NextResponse.json(
        { error: `Unsupported role "${body.role}"` },
        { status: 400 }
      )
    }

    // Which fields the caller actually intends to change. Absent keys are left
    // alone; present keys are written (including an explicit null to clear).
    const hasAmount = Object.prototype.hasOwnProperty.call(body, 'override_amount')
    const hasPercent = Object.prototype.hasOwnProperty.call(body, 'override_percent')
    if (!hasAmount && !hasPercent) {
      return NextResponse.json(
        { error: 'override_amount or override_percent is required' },
        { status: 400 }
      )
    }

    let overrideAmount: number | null = null
    if (hasAmount && body.override_amount != null) {
      const n = Number(body.override_amount)
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { error: 'override_amount must be a non-negative number' },
          { status: 400 }
        )
      }
      overrideAmount = n
    }

    let overridePercent: number | null = null
    if (hasPercent && body.override_percent != null) {
      const n = Number(body.override_percent)
      // NUMERIC(5,2) holds up to 999.99, but a commission rate above 100% of the
      // job base is always a typo, so reject it here rather than paying it.
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return NextResponse.json(
          { error: 'override_percent must be between 0 and 100' },
          { status: 400 }
        )
      }
      overridePercent = n
    }

    const supabase = createServiceClient()
    const orgId = profile.org_id

    const { data: job } = await supabase
      .from('production_jobs')
      .select('id')
      .eq('id', body.job_id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // The row is org-scoped, but the user it credits must belong to this org too —
    // otherwise payroll could be pointed at a user outside the caller's tenant.
    const { data: targetUser } = await supabase
      .from('users')
      .select('id')
      .eq('id', body.user_id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found in your organization' }, { status: 404 })
    }

    const { data: existing } = await supabase
      .from('deal_commission_roles')
      .select('id, override_amount, override_percent')
      .eq('job_id', body.job_id)
      .eq('user_id', body.user_id)
      .eq('role', storageRole)
      .eq('org_id', orgId)
      .maybeSingle()

    // Flat dollars and percent are alternatives, not additive — resolveAdditiveParticipantAmount()
    // pays the flat amount and ignores the percent when both are set. Clearing the
    // counterpart keeps the stored row honest about which one is actually paying.
    const changes: { override_amount?: number | null; override_percent?: number | null } = {}
    if (hasAmount) {
      changes.override_amount = overrideAmount
      if (overrideAmount != null) changes.override_percent = null
    }
    if (hasPercent) {
      changes.override_percent = overridePercent
      if (overridePercent != null) changes.override_amount = null
    }

    const returning = 'id, job_id, user_id, role, override_amount, override_percent'
    const { data: saved, error } = existing
      ? await supabase
          .from('deal_commission_roles')
          .update(changes)
          .eq('id', existing.id)
          .select(returning)
          .single()
      : await supabase
          .from('deal_commission_roles')
          .insert({
            org_id: orgId,
            job_id: body.job_id,
            user_id: body.user_id,
            role: storageRole,
            override_amount: changes.override_amount ?? null,
            override_percent: changes.override_percent ?? null,
          })
          .select(returning)
          .single()

    if (error || !saved) {
      console.error('deal_commission_roles', error)
      return NextResponse.json({ error: 'Failed to save override' }, { status: 500 })
    }

    await supabase.from('payroll_override_audit').insert({
      org_id: orgId,
      override_type: 'manual_adjustment',
      job_id: body.job_id,
      actor_user_id: profile.id,
      reason: body.reason?.trim() || 'Statement override',
      before_value: {
        override_amount: existing?.override_amount ?? null,
        override_percent: existing?.override_percent ?? null,
        role: storageRole,
      },
      after_value: {
        override_amount: saved.override_amount,
        override_percent: saved.override_percent,
        role: storageRole,
      },
    })

    return NextResponse.json({ role: saved })
  } catch (e) {
    console.error('PATCH deal-commission-roles', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
