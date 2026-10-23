/**
 * Org default pay plan per role (used when someone has no assignment; see lib/comp-plan-defaults.ts).
 *   GET  — current defaults, usable plans, and who has no pay plan (payroll admins)
 *   POST — { role, compPlanId, reason? } set a role's default, effective TODAY (never backdated). OWNERS ONLY:
 *          it decides what people are paid.
 * A change is a new effective-dated row; nothing is edited in place.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { ymdInBusinessTz } from '@/lib/calendar-business-tz'
import { loadPayPlanGaps } from '@/lib/comp-plan-defaults-db'
import { compPlanRoleLabel, isKnownCompPlanRole } from '@/lib/comp-plan-roles'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { isOwnerProfile } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

async function authorize(requireOwner: boolean) {
  try {
    const { profile } = await requireAuthApi()
    const ok = requireOwner ? isOwnerProfile(profile) : isPayrollAdminRole(profile.role) || isOwnerProfile(profile)
    if (!ok) return { error: NextResponse.json({ error: requireOwner ? 'Only owners can set default pay plans' : 'Forbidden' }, { status: 403 }) }
    return { profile, admin: createServiceClient() }
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
}

export async function GET() {
  const a = await authorize(false)
  if ('error' in a) return a.error
  const org = a.profile.org_id
  const [defaults, plans, gaps] = await Promise.all([
    a.admin.from('org_default_comp_plans').select('id, role, comp_plan_id, effective_from, change_reason, comp_plans(name, base_percentage)').eq('org_id', org).order('effective_from', { ascending: false }),
    a.admin.from('comp_plans').select('id, name, is_active, base_percentage, applicable_roles, plan_purpose, is_manager_plan').eq('org_id', org).order('name'),
    loadPayPlanGaps(a.admin, org),
  ])
  return NextResponse.json({
    defaults: (defaults.data ?? []).map((d: any) => {
      const plan = Array.isArray(d.comp_plans) ? d.comp_plans[0] : d.comp_plans
      return { id: d.id, role: d.role, roleLabel: compPlanRoleLabel(d.role), planId: d.comp_plan_id, planName: plan?.name ?? null, ratePercent: plan?.base_percentage != null ? Number(plan.base_percentage) : null, effectiveFrom: d.effective_from }
    }),
    plans: (plans.data ?? []).filter((p: any) => (p.plan_purpose ?? 'primary') === 'primary'),
    gaps,
  })
}

export async function POST(request: NextRequest) {
  const a = await authorize(true)
  if ('error' in a) return a.error
  const org = a.profile.org_id
  const body = (await request.json().catch(() => null)) as { role?: unknown; compPlanId?: unknown; reason?: unknown } | null
  const role = typeof body?.role === 'string' ? body.role : ''
  const compPlanId = typeof body?.compPlanId === 'string' ? body.compPlanId : ''
  if (!isKnownCompPlanRole(role)) return NextResponse.json({ error: 'Pick a role' }, { status: 400 })
  if (!/^[0-9a-f-]{36}$/i.test(compPlanId)) return NextResponse.json({ error: 'Pick a plan' }, { status: 400 })

  const { data: plan } = await a.admin.from('comp_plans').select('id, name, plan_purpose, is_manager_plan').eq('org_id', org).eq('id', compPlanId).maybeSingle()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  if ((plan.plan_purpose ?? 'primary') !== 'primary') return NextResponse.json({ error: 'A management overlay can\'t be a default pay plan' }, { status: 400 })

  const today = ymdInBusinessTz(new Date())
  const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 300) : 'Set from Needs you / Comp Plans'
  const { error } = await a.admin
    .from('org_default_comp_plans')
    .upsert({ org_id: org, role, comp_plan_id: compPlanId, effective_from: today, change_reason: reason, created_by: a.profile.id }, { onConflict: 'org_id,role,effective_from' })
  if (error) return NextResponse.json({ error: 'Could not save the default' }, { status: 500 })
  return NextResponse.json({ ok: true, effectiveFrom: today })
}
