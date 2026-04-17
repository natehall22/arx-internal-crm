import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { sendCloserBriefingEmail, type BriefingPhoto } from '@/lib/closer-briefing-email'

const PHOTO_BUCKET = 'inspection-photos'
const PHOTO_SIGNED_URL_TTL = 60 * 60 * 24 * 7 // 7 days

const ROLES_CAN_SUBMIT = new Set([
  'admin', 'owner', 'setter_manager', 'regional_setter_manager',
  'sales_manager', 'regional_manager', 'rep', 'sales_rep', 'closer',
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
  } catch (err) {
    console.error('inspection-result GET:', err)
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
      'roof_slopes', 'homeowner_emotional_state',
      'consequence_questions_asked', 'insurance_mentioned', 'urgency_level',
      'notes', 'close_appointment_id',
    ])
    const upsertData: Record<string, unknown> = {
      org_id: profile.org_id,
      opportunity_id: params.id,
    }
    // submitted_at and submitted_by are only stamped on an explicit final submit,
    // not on intermediate patches (e.g. linking close_appointment_id after scheduling).
    const isFinalSubmit = rawBody.final_submit === true
    if (isFinalSubmit) {
      upsertData.submitted_at = new Date().toISOString()
      upsertData.submitted_by_user_id = profile.id
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

    // Send briefing email only on a real final submit (not intermediate patches)
    if (rawBody.send_email && isFinalSubmit && result) {
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
            // Fetch photos with 7-day signed URLs for inline email grid
            const photos: BriefingPhoto[] = []
            const { data: photoRows } = await admin
              .from('inspection_result_photos')
              .select('id, storage_path, filename')
              .eq('result_id', result.id)
              .eq('org_id', profile.org_id)
              .order('created_at', { ascending: true })

            for (const p of photoRows ?? []) {
              const { data: signed } = await admin.storage
                .from(PHOTO_BUCKET)
                .createSignedUrl(p.storage_path, PHOTO_SIGNED_URL_TTL)
              photos.push({ id: p.id, filename: p.filename, url: signed?.signedUrl ?? null })
            }

            await sendCloserBriefingEmail({
              to: closer.email,
              closerName: closer.full_name,
              customerName,
              address: opp.address_text || '',
              inspectorName: profile.full_name,
              result,
              photos,
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
  } catch (err) {
    console.error('inspection-result POST:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
