import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { revalidatePath } from 'next/cache'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const leadId = params.id

    let leadQuery = supabase
      .from('leads')
      .select('id, org_id, owner_user_id, closer_user_id, customer_id, homeowner_name, phone, address_text, email, lat, lng, notes, source')
      .eq('id', leadId)
      .eq('org_id', profile.org_id)

    if (profile.role === 'rep') {
      leadQuery = leadQuery.eq('owner_user_id', profile.id)
    }

    const { data: lead, error: leadError } = await leadQuery.maybeSingle()

    if (leadError || !lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const { data: existingOpp } = await supabase
      .from('opportunities')
      .select('id')
      .eq('org_id', profile.org_id)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingOpp?.id) {
      return NextResponse.json(
        { opportunity_id: existingOpp.id, already_exists: true },
        { status: 200 }
      )
    }

    const ownerUserId = lead.closer_user_id || profile.id
    const setterUserId = lead.owner_user_id || null

    const { data: created, error: insertError } = await supabase
      .from('opportunities')
      .insert({
        org_id: profile.org_id,
        lead_id: leadId,
        customer_id: lead.customer_id || null,
        owner_user_id: ownerUserId,
        setter_user_id: setterUserId,
        status: 'open',
        source: lead.source || 'manual_from_lead',
        project_type: 'roofing',
        address_text: lead.address_text || null,
        lat: lead.lat ?? null,
        lng: lead.lng ?? null,
        notes: lead.notes || null,
      })
      .select('id')
      .single()

    if (insertError || !created?.id) {
      console.error('Create opportunity from lead failed:', insertError)
      return NextResponse.json(
        { error: insertError?.message || 'Failed to create opportunity' },
        { status: 500 }
      )
    }

    await supabase
      .from('scheduled_appointments')
      .update({ opportunity_id: created.id })
      .eq('org_id', profile.org_id)
      .eq('lead_id', leadId)
      .is('opportunity_id', null)

    await supabase.from('activities').insert({
      org_id: profile.org_id,
      lead_id: leadId,
      opportunity_id: created.id,
      user_id: profile.id,
      type: 'status_change',
      body: 'Opportunity created manually from lead',
    })

    revalidatePath(`/leads/${leadId}`)
    revalidatePath('/opportunities')

    return NextResponse.json({ opportunity_id: created.id, already_exists: false })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unauthorized'
    const status = message === 'Unauthorized' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
