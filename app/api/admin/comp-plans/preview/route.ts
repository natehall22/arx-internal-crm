/** POST { id, ...plan fields as the edit form sends them } — last 4 weeks of pay, current terms vs the proposed ones, per person. Writes nothing. */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { COMP_PLAN_BODY_FIELDS, compPlanBodyChanged } from '@/lib/comp-plan-version'
import { isPayWeekEnabled } from '@/lib/payroll-flag'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { isUuid } from '@/lib/payroll-pay-week'
import { previewPlanChange } from '@/lib/payroll-plan-preview'
import { parseWeeklyMinimum } from '@/lib/payroll-weekly-minimum'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  // The preview reads the pay-week model: with the flag off it does not exist (the plan form just saves).
  if (!isPayWeekEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isPayrollAdminRole(profile.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!b || !isUuid(b.id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const admin = createServiceClient()
  const { data: plan } = await admin.from('comp_plans').select('*').eq('id', b.id as string).eq('org_id', profile.org_id).maybeSingle()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  const body: Record<string, unknown> = {}
  for (const f of COMP_PLAN_BODY_FIELDS) body[f] = b[f] ?? null
  const weeklyMinimum = 'weekly_minimum' in b ? b.weekly_minimum : plan.weekly_minimum
  const termsChanged = compPlanBodyChanged(plan as Record<string, unknown>, body)
  const minimumChanged = JSON.stringify(parseWeeklyMinimum(weeklyMinimum)) !== JSON.stringify(parseWeeklyMinimum(plan.weekly_minimum))
  // Nothing that pays changed (a name, a description): nothing to preview.
  if (!termsChanged && !minimumChanged) return NextResponse.json({ changed: false })
  try {
    const preview = await previewPlanChange(admin, profile.org_id, { planId: b.id as string, body, weeklyMinimum })
    return NextResponse.json({ changed: true, ...preview })
  } catch (e) {
    console.error('comp plan preview', e)
    return NextResponse.json({ error: 'Could not work out the preview' }, { status: 500 })
  }
}
