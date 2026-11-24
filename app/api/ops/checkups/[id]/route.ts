import { NextResponse } from 'next/server'

import { categoryScopeOf, inScopeJobIds } from '@/lib/category-scope'
import { requireAuthApi } from '@/lib/auth'
import { applyCheckupAction, parseCheckupAction } from '@/lib/checkups'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'

/** Book / complete / decline / can't-reach / reopen a customer checkup, or record a call attempt on it. Job-board people only. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    auth = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { authUser, profile } = auth
  const admin = createServiceClient()
  const { canJobBoard } = await resolveOpsAccess(admin, authUser.id, profile)
  if (!canJobBoard) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Limited to some work categories: a checkup on a job outside them is "not found".
  const scope = categoryScopeOf(profile)
  if (scope.limited) {
    const { data: row } = await admin.from('job_checkups').select('production_job_id, customer_id').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
    const r = row as { production_job_id: string; customer_id: string | null } | null
    if (!r || !(await inScopeJobIds(admin, profile.org_id, scope, [{ id: r.production_job_id, customer_id: r.customer_id }])).has(r.production_job_id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const action = parseCheckupAction(body)
  if ('error' in action) return NextResponse.json({ error: action.error }, { status: 400 })

  // A call attempt may only point at a contact row in this company.
  if (action.action === 'contact' && action.activityId) {
    const { data: act } = await admin.from('activities').select('id').eq('id', action.activityId).eq('org_id', profile.org_id).maybeSingle()
    if (!act) action.activityId = null
  }

  const res = await applyCheckupAction(admin, profile.org_id, params.id, action, authUser.id)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true })
}
