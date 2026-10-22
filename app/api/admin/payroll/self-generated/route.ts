import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { createServiceClient } from '@/lib/supabase/service'
import { saveDealSaleCredit } from '@/lib/deal-sale-credit'
import { isSuperAdmin } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest) {
  let profile
  try {
    const ctx = await requireAuthApi()
    profile = ctx.profile
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isPayrollAdminRole(profile.role) && !isSuperAdmin(profile)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    opportunity_id?: unknown
    is_self_generated?: unknown
    reason?: unknown
  }
  if (typeof body.opportunity_id !== 'string' || !body.opportunity_id.trim()) {
    return NextResponse.json({ error: 'opportunity_id is required' }, { status: 400 })
  }
  if (typeof body.is_self_generated !== 'boolean') {
    return NextResponse.json({ error: 'is_self_generated must be true or false' }, { status: 400 })
  }

  // Self-generated is sale credit (the 6% line): after the contract is signed only an owner
  // may change it, with a reason — enforced in the one sale-credit writer.
  const supabase = createServiceClient()
  const saved = await saveDealSaleCredit(supabase, {
    orgId: profile.org_id,
    opportunityId: body.opportunity_id.trim(),
    actor: profile,
    next: { isSelfGenerated: body.is_self_generated },
    reason: typeof body.reason === 'string' ? body.reason : null,
  })
  if (!saved.ok) {
    if (saved.status >= 500) {
      console.error('self-generated confirmation failed', {
        orgId: profile.org_id,
        opportunityId: body.opportunity_id,
        error: saved.error,
      })
    }
    return NextResponse.json({ error: saved.error }, { status: saved.status })
  }

  return NextResponse.json({
    opportunity_id: body.opportunity_id.trim(),
    is_self_generated: body.is_self_generated,
    self_generated_source: 'manual',
  })
}
