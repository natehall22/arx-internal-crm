import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest) {
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

  const body = (await request.json().catch(() => ({}))) as {
    opportunity_id?: unknown
    is_self_generated?: unknown
  }
  if (typeof body.opportunity_id !== 'string' || !body.opportunity_id.trim()) {
    return NextResponse.json({ error: 'opportunity_id is required' }, { status: 400 })
  }
  if (typeof body.is_self_generated !== 'boolean') {
    return NextResponse.json({ error: 'is_self_generated must be true or false' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase.rpc('confirm_opportunity_self_generated', {
    p_org_id: profile.org_id,
    p_opportunity_id: body.opportunity_id.trim(),
    p_is_self_generated: body.is_self_generated,
    p_confirmed_by: profile.id,
  })

  if (error) {
    console.error('self-generated confirmation failed', {
      orgId: profile.org_id,
      opportunityId: body.opportunity_id,
      error: error.message,
    })
    return NextResponse.json({ error: 'Failed to save self-generated attribution' }, { status: 500 })
  }

  return NextResponse.json({
    opportunity_id: body.opportunity_id.trim(),
    is_self_generated: body.is_self_generated,
    self_generated_source: 'manual',
  })
}
