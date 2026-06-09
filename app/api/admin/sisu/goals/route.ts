import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const ADMIN_ROLES = new Set([
  'admin', 'owner', 'regional_manager', 'regional_setter_manager',
  'sales_manager', 'setter_manager', 'manager', 'operations',
])

export async function PUT(request: NextRequest) {
  const supabase = createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createServiceClient()
  const { data: profile } = await admin
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  if (!profile?.role || !ADMIN_ROLES.has(profile.role as string)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body.user_id !== 'string') {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 })
  }

  const { user_id, weekly_doors_target, weekly_inspections_target, weekly_sales_target } = body as {
    user_id: string
    weekly_doors_target?: number | null
    weekly_inspections_target?: number | null
    weekly_sales_target?: number | null
  }

  // Verify the target user belongs to the same org
  const { data: targetUser } = await admin
    .from('users')
    .select('id')
    .eq('id', user_id)
    .eq('org_id', profile.org_id)
    .single()

  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const todayIso = new Date().toISOString().slice(0, 10)

  const { error: upsertError } = await admin
    .from('user_incentive_goals')
    .upsert(
      {
        org_id: profile.org_id,
        user_id,
        weekly_doors_target: weekly_doors_target ?? null,
        weekly_inspections_target: weekly_inspections_target ?? null,
        weekly_sales_target: weekly_sales_target ?? null,
        effective_from: todayIso,
        set_by: user.id,
      },
      { onConflict: 'user_id,effective_from' }
    )

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
