import { NextRequest, NextResponse } from 'next/server'

import { partnerApiError, partnerRequestContext } from '@/lib/referral-partner-api'

export const dynamic = 'force-dynamic'

/**
 * Who a partner is Assigned To.
 * Managers only, reason required: `reassign` / `company_relationship` / `open`. Reps never
 * self-assign; a partner that opened up goes back to an admin to reassign.
 * The audit trigger records who/when/why; history is what past commissions resolve from.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { supabase, userId, orgId, access } = await partnerRequestContext()
    const body = await request.json()
    const action = String(body.action ?? '')
    const reason = String(body.reason ?? '').trim()

    const { data: partner } = await supabase
      .from('referral_partners')
      .select('id, status')
      .eq('id', params.id)
      .eq('org_id', orgId)
      .maybeSingle()
    if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    let toUser: string | null = null
    let status: 'assigned' | 'open' | 'company_relationship'

    if (access.canManage) {
      if (!reason) return NextResponse.json({ error: 'A reason is required' }, { status: 400 })
      if (action === 'reassign') {
        status = 'assigned'
        toUser = String(body.user_id ?? '')
        const { data: target } = await supabase
          .from('users')
          .select('id')
          .eq('id', toUser)
          .eq('org_id', orgId)
          .eq('active', true)
          .maybeSingle()
        if (!target) return NextResponse.json({ error: 'Pick an active rep' }, { status: 400 })
      } else if (action === 'company_relationship') {
        status = 'company_relationship'
      } else if (action === 'open') {
        status = 'open'
      } else {
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
      }
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: changed, error } = await supabase.rpc('referral_partner_set_assignment', {
      p_partner: partner.id,
      p_to_user: toUser,
      p_status: status,
      p_reason: reason,
      p_actor: userId,
    })
    if (error) throw error
    if (!changed) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error) {
    return partnerApiError(error, 'referral-partners assignment')
  }
}
