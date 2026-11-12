import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { undoJobPayment } from '@/lib/job-payment-undo'
import { isOwnerProfile } from '@/lib/super-admin'

// POST { reason } - Undo a payment: a negative payment through the one payment writer (never a delete).
export async function POST(request: Request, { params }: { params: { id: string; paymentId: string } }) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const admin = createServiceClient()
    if (!(await callerCanAccessJobBilling(admin, profile))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = (await request.json().catch(() => ({}))) as { reason?: unknown }
    const result = await undoJobPayment(admin, {
      orgId: profile.org_id,
      jobId: params.id,
      paymentId: params.paymentId,
      reason: typeof body.reason === 'string' ? body.reason : '',
      actor: { id: profile.id, isOwner: isOwnerProfile(profile as Parameters<typeof isOwnerProfile>[0]) },
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true, payment: result.reversal, already_undone: result.alreadyUndone })
  } catch (error) {
    console.error('Error in POST /api/ops/jobs/[id]/payments/[paymentId]/undo:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
