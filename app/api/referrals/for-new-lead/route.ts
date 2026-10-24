import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * Records the referral for a lead that was just created on the new-lead form. The browser used to find-or-create the referrer's
 * customer and insert the referral itself, using the referrer's phone / email it had searched up. That needs read access to
 * people who are not the setter's own work, so it now happens here with the service role: the form sends only WHO (type + id).
 */
export async function POST(request: NextRequest) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as { referrer_type?: string; referrer_id?: string; referred_lead_id?: string; bonus_amount?: number } | null
  if (!body?.referrer_id || !body.referred_lead_id || (body.referrer_type !== 'customer' && body.referrer_type !== 'lead')) {
    return NextResponse.json({ error: 'referrer_type, referrer_id and referred_lead_id are required' }, { status: 400 })
  }
  const admin = createServiceClient()
  const orgId = profile.org_id

  // The new lead must be the caller's own (they just created it).
  const { data: lead } = await admin.from('leads').select('id, homeowner_name, phone, email, address_text, owner_user_id').eq('id', body.referred_lead_id).eq('org_id', orgId).maybeSingle()
  if (!lead || lead.owner_user_id !== profile.id) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  let customerId: string | null = null
  let name: string | null = null
  let phone: string | null = null
  let email: string | null = null
  if (body.referrer_type === 'customer') {
    const { data: c } = await admin.from('customers').select('id, name, phone, email').eq('id', body.referrer_id).eq('org_id', orgId).maybeSingle()
    if (!c) return NextResponse.json({ error: 'Referrer not found' }, { status: 404 })
    ;({ id: customerId, name, phone, email } = c as { id: string; name: string | null; phone: string | null; email: string | null })
  } else {
    const { data: r } = await admin.from('leads').select('id, homeowner_name, phone, email, address_text, customer_id').eq('id', body.referrer_id).eq('org_id', orgId).maybeSingle()
    if (!r) return NextResponse.json({ error: 'Referrer not found' }, { status: 404 })
    name = r.homeowner_name as string | null
    phone = r.phone as string | null
    email = r.email as string | null
    customerId = (r.customer_id as string | null) ?? null
    if (!customerId && phone) {
      const { data } = await admin.from('customers').select('id').eq('org_id', orgId).eq('phone', phone).limit(1).maybeSingle()
      customerId = data?.id ?? null
    }
    if (!customerId && name) {
      const { data } = await admin.from('customers').select('id').eq('org_id', orgId).eq('name', name).limit(1).maybeSingle()
      customerId = data?.id ?? null
    }
    if (!customerId) {
      const { data: created } = await admin.from('customers').insert({ org_id: orgId, name, phone, email, address_text: r.address_text }).select('id').single()
      customerId = created?.id ?? null
    }
  }
  if (!customerId) return NextResponse.json({ error: 'Could not resolve the referrer' }, { status: 422 })

  const bonus = Number.isFinite(body.bonus_amount) ? Number(body.bonus_amount) : 100
  const { error } = await admin.from('referrals').insert({
    org_id: orgId,
    referrer_customer_id: customerId,
    referrer_name: name,
    referrer_email: email,
    referrer_phone: phone,
    referred_name: lead.homeowner_name || 'New Lead',
    referred_email: lead.email,
    referred_phone: lead.phone,
    referred_address: lead.address_text,
    referred_lead_id: lead.id,
    bonus_amount: bonus,
    bonus_type: 'cash',
    status: 'pending',
    created_by: profile.id,
  })
  if (error) {
    console.error('referral create', error)
    return NextResponse.json({ error: 'Could not record the referral' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
