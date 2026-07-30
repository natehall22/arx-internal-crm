import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { isReferralManagerRole } from '@/lib/referral-links'

export const dynamic = 'force-dynamic'

/**
 * Advances a referral's payout status (qualify -> installed -> paid).
 *
 * Was two browser-client `.update()` calls, gated only by 028's manager-only RLS
 * UPDATE policy. That RLS check is a real backstop, but a caller whose cookie session
 * had not been applied hit it as an unauthenticated request and got the generic 42501
 * Postgres message rather than an actionable one -- same failure class as the create
 * path, on the status buttons instead. Routed through the server so the permission
 * check runs against a resolved profile with a clear error, and RLS stays in place as
 * defense in depth underneath the service-role write.
 *
 * Kept separate from /api/referrals/from-customer: that route is gated to
 * customers:edit for the fields anyone taking a referral can set; this one is gated to
 * REFERRAL_MANAGER_ROLES for the fields that trigger a payout.
 */
const ALLOWED_STATUSES = ['qualified', 'installed', 'paid'] as const
const ALLOWED_STATUSES_SET = new Set<string>(ALLOWED_STATUSES)

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Your session has expired — sign in again.' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    if (!isReferralManagerRole(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      status?: unknown
      payment_method?: unknown
    }

    if (typeof body.status !== 'string' || !ALLOWED_STATUSES_SET.has(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }
    const status = body.status as 'qualified' | 'installed' | 'paid'

    const update: Record<string, unknown> = { status }

    if (status === 'installed') {
      update.install_date = new Date().toISOString().split('T')[0]
    }

    if (status === 'paid') {
      if (typeof body.payment_method !== 'string' || !body.payment_method.trim()) {
        return NextResponse.json({ error: 'payment_method is required to mark a referral paid' }, { status: 400 })
      }
      update.paid_at = new Date().toISOString()
      update.payment_method = body.payment_method.trim()
    }

    const { data: referral, error } = await adminClient
      .from('referrals')
      .update(update)
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .select('*')
      .single()

    if (error) {
      console.error('Referral status update error:', error)
      return NextResponse.json({ error: `Failed to update status: ${error.message}` }, { status: 400 })
    }

    return NextResponse.json({ referral })
  } catch (error) {
    console.error('Referral status API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update status' },
      { status: 500 }
    )
  }
}
