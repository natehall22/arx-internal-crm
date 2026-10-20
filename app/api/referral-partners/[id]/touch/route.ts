import { NextRequest, NextResponse } from 'next/server'

import { partnerApiError, partnerRequestContext } from '@/lib/referral-partner-api'
import { TOUCH_BUTTONS, canWorkPartner, isTouchType } from '@/lib/referral-partners'

export const dynamic = 'force-dynamic'

/** Called / Texted / Emailed / Visited. The DB trigger on activities resets the clock. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { supabase, userId, orgId, access } = await partnerRequestContext()
    const body = await request.json()
    if (!isTouchType(body.type)) {
      return NextResponse.json({ error: 'Pick Called, Texted, Emailed or Visited' }, { status: 400 })
    }

    const { data: partner } = await supabase
      .from('referral_partners')
      .select('id, name, status, assigned_user_id')
      .eq('id', params.id)
      .eq('org_id', orgId)
      .maybeSingle()
    if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!canWorkPartner(partner, userId, access)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const label = TOUCH_BUTTONS.find((b) => b.type === body.type)!.label
    const note = String(body.note ?? '').trim()
    const { error } = await supabase.from('activities').insert({
      org_id: orgId,
      referral_partner_id: partner.id,
      user_id: userId,
      type: body.type,
      body: note || label,
    })
    if (error) throw error

    const { data: refreshed } = await supabase
      .from('referral_partners')
      .select('last_touched_at')
      .eq('id', partner.id)
      .single()
    return NextResponse.json({ success: true, last_touched_at: refreshed?.last_touched_at ?? null })
  } catch (error) {
    return partnerApiError(error, 'referral-partners touch')
  }
}
