import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { sendCloserBriefingEmail } from '@/lib/closer-briefing-email'

const ROLES_CAN_SUBMIT = new Set([
  'admin', 'owner', 'setter_manager', 'regional_setter_manager',
  'sales_manager', 'regional_manager', 'rep',
])

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const admin = createServiceClient()

    const { data, error } = await admin
      .from('inspection_results')
      .select('*')
      .eq('opportunity_id', params.id)
      .eq('org_id', profile.org_id)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ result: data })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()

    if (!ROLES_CAN_SUBMIT.has(profile.role)) {
      return NextResponse.json({ error: 'Not authorized to submit inspection results' }, { status: 403 })
    }

    const admin = createServiceClient()
    const rawBody = await request.json()

    const ALLOWED_FIELDS = new Set([
      'outcome', 'both_dms_present', 'absent_dm_name', 'damage_found',
      'roof_slopes', 'photos_confirmed', 'homeowner_emotional_state',
      'consequence_questions_asked', 'insurance_mentioned', 'urgency_level',
      'notes', 'close_appointment_id',
    ])
    const upsertData: Record<string, unknown> = {
      org_id: profile.org_id,
      opportunity_id: params.id,
      submitted_by_user_id: profile.id,
      submitted_at: new Date().toISOString(),
    }
    for (const key of Object.keys(rawBody)) {
      if (ALLOWED_FIELDS.has(key)) upsertData[key] = rawBody[key]
    }

    if (!upsertData.outcome) {
      return NextResponse.json({ error: 'outcome is required' }, { status: 400 })
    }

    const { data: result, error } = await admin
      .from('inspection_results')
      .upsert(upsertData, { onConflict: 'opportunity_id' })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Send briefing email to the assigned closer if requested
    if (rawBody.send_email && result) {
      try {
        const { data: opp } = await admin
          .from('opportunities')
          .select('owner_user_id, address_text, leads(homeowner_name), customers(name)')
          .eq('id', params.id)
          .eq('org_id', profile.org_id)
          .single()

        if (opp?.owner_user_id) {
          const { data: closer } = await admin
            .from('users')
            .select('full_name, email')
            .eq('id', opp.owner_user_id)
            .single()

          const customerName =
            (opp.leads as any)?.homeowner_name ||
            (opp.customers as any)?.name ||
            'Customer'

          if (closer?.email) {
            await sendCloserBriefingEmail({
              to: closer.email,
              closerName: closer.full_name,
              customerName,
              address: opp.address_text || '',
              inspectorName: profile.full_name,
              result,
            })

            await admin
              .from('inspection_results')
              .update({ briefing_email_sent_at: new Date().toISOString() })
              .eq('id', result.id)
          }
        }
      } catch (emailErr) {
        console.error('Failed to send closer briefing email:', emailErr)
        // Non-fatal — result already saved
      }
    }

    return NextResponse.json({ result })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
