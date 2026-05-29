import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'

export const dynamic = 'force-dynamic'

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
      reason?: string
    }

    if (!body.job_id || !body.user_id || !body.role) {
      return NextResponse.json(
        { error: 'job_id, user_id, and role are required' },
        { status: 400 }
      )
    }

    const roleMap: Record<string, string> = {
      owner: 'closer',
      sales_rep: 'closer',
    }
    const storageRole = roleMap[body.role] || body.role

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

    const overrideAmount =
      body.override_amount == null ? null : Number(body.override_amount)

    const { data: existing } = await supabase
      .from('deal_commission_roles')
      .select('id, override_amount')
      .eq('job_id', body.job_id)
      .eq('user_id', body.user_id)
      .eq('role', storageRole)
      .eq('org_id', orgId)
      .maybeSingle()

    const payload = {
      org_id: orgId,
      job_id: body.job_id,
      user_id: body.user_id,
      role: storageRole,
      override_amount: Number.isFinite(overrideAmount as number) ? overrideAmount : null,
    }

    const { data: saved, error } = existing
      ? await supabase
          .from('deal_commission_roles')
          .update({ override_amount: payload.override_amount })
          .eq('id', existing.id)
          .select('id, job_id, user_id, role, override_amount')
          .single()
      : await supabase
          .from('deal_commission_roles')
          .insert(payload)
          .select('id, job_id, user_id, role, override_amount')
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
      reason: body.reason?.trim() || 'Statement override amount',
      before_value: { override_amount: existing?.override_amount ?? null },
      after_value: { override_amount: saved.override_amount },
    })

    return NextResponse.json({ role: saved })
  } catch (e) {
    console.error('PATCH deal-commission-roles', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
