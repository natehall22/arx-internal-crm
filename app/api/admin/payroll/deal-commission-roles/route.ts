import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { isPayrollPeriodEditable, loadPayrollPeriodForOrg } from '@/lib/payroll-period-guards'

export const dynamic = 'force-dynamic'

function storageRoleFromParticipant(role: string): string {
  const roleMap: Record<string, string> = {
    owner: 'closer',
    sales_rep: 'closer',
  }
  return roleMap[role] || role
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
      payroll_period_id?: string
      override_amount?: number | null
      override_percent?: number | null
      premier_pricing_amount?: number | null
      reason?: string
    }

    if (!body.job_id || !body.user_id || !body.role || !body.payroll_period_id) {
      return NextResponse.json(
        { error: 'job_id, user_id, role, and payroll_period_id are required' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const orgId = profile.org_id

    const period = await loadPayrollPeriodForOrg(supabase, orgId, body.payroll_period_id)
    if (!period) {
      return NextResponse.json({ error: 'Period not found' }, { status: 404 })
    }
    if (!isPayrollPeriodEditable(period)) {
      return NextResponse.json(
        {
          error:
            'Period is locked or paid. Deal overrides cannot be changed after lock — the official statement is frozen.',
        },
        { status: 409 }
      )
    }

    const storageRole = storageRoleFromParticipant(body.role)

    const { data: job } = await supabase
      .from('production_jobs')
      .select('id')
      .eq('id', body.job_id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const toNullableAmount = (v: number | null | undefined) => {
      if (v == null) return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }

    const patch: Record<string, number | null> = {}
    if ('override_amount' in body) patch.override_amount = toNullableAmount(body.override_amount)
    if ('override_percent' in body) patch.override_percent = toNullableAmount(body.override_percent)
    if ('premier_pricing_amount' in body) {
      patch.premier_pricing_amount = toNullableAmount(body.premier_pricing_amount)
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from('deal_commission_roles')
      .select('id, override_amount, override_percent, premier_pricing_amount')
      .eq('job_id', body.job_id)
      .eq('user_id', body.user_id)
      .eq('role', storageRole)
      .eq('org_id', orgId)
      .maybeSingle()

    const basePayload = {
      org_id: orgId,
      job_id: body.job_id,
      user_id: body.user_id,
      role: storageRole,
    }

    const { data: saved, error } = existing
      ? await supabase
          .from('deal_commission_roles')
          .update(patch)
          .eq('id', existing.id)
          .select(
            'id, job_id, user_id, role, override_amount, override_percent, premier_pricing_amount'
          )
          .single()
      : await supabase
          .from('deal_commission_roles')
          .insert({ ...basePayload, ...patch })
          .select(
            'id, job_id, user_id, role, override_amount, override_percent, premier_pricing_amount'
          )
          .single()

    if (error || !saved) {
      console.error('deal_commission_roles', error)
      return NextResponse.json({ error: 'Failed to save override' }, { status: 500 })
    }

    await supabase.from('payroll_override_audit').insert({
      org_id: orgId,
      payroll_period_id: body.payroll_period_id,
      override_type: 'manual_adjustment',
      job_id: body.job_id,
      actor_user_id: profile.id,
      reason: body.reason?.trim() || 'Admin statement override',
      before_value: {
        user_id: body.user_id,
        role: storageRole,
        override_amount: existing?.override_amount ?? null,
        override_percent: existing?.override_percent ?? null,
        premier_pricing_amount: existing?.premier_pricing_amount ?? null,
      },
      after_value: {
        user_id: body.user_id,
        role: storageRole,
        override_amount: saved.override_amount,
        override_percent: saved.override_percent,
        premier_pricing_amount: saved.premier_pricing_amount,
      },
    })

    return NextResponse.json({ role: saved })
  } catch (e) {
    console.error('PATCH deal-commission-roles', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
