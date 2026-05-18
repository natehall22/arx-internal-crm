import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { userHasSchedulingCreate } from '@/lib/scheduling-create-permission'

export const dynamic = 'force-dynamic'

/**
 * Gates scheduling with `scheduling:create` (legacy roles, custom roles, or Admin → user permissions).
 * Delegates booking logic to `POST /api/canvass/lead`, which owns round-robin + calendar sync.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()

    const permitted = await userHasSchedulingCreate(supabase, profile.id, profile)
    if (!permitted) {
      return NextResponse.json(
        {
          error:
            'You do not have permission to schedule inspections. Ask an admin to grant “Create Appointments” (scheduling:create) for your role or user.',
          code: 'SCHEDULING_FORBIDDEN',
        },
        { status: 403 }
      )
    }

    let leadQuery = supabase.from('leads').select('*').eq('id', params.id).eq('org_id', profile.org_id)
    if (profile.role === 'rep') {
      leadQuery = leadQuery.eq('owner_user_id', profile.id)
    }
    const { data: lead, error: leadError } = await leadQuery.maybeSingle()

    if (leadError || !lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const inspectionScheduledFor = typeof body.inspection_scheduled_for === 'string' ? body.inspection_scheduled_for : ''
    if (!inspectionScheduledFor.trim()) {
      return NextResponse.json({ error: 'inspection_scheduled_for is required' }, { status: 400 })
    }

    /** When true (default): team picker uses round-robin. Set false when an individual closer UUID is supplied. */
    const useRoundRobin = body.use_round_robin !== false

    let closerUserId: string | null =
      typeof body.closer_user_id === 'string' && body.closer_user_id.trim() ? body.closer_user_id.trim() : null

    if (!useRoundRobin && (!closerUserId || closerUserId.startsWith('team:'))) {
      return NextResponse.json(
        { error: 'Select an individual closer, or enable team round-robin.' },
        { status: 400 }
      )
    }

    const originHost = request.headers.get('x-forwarded-host')
    const originProto = request.headers.get('x-forwarded-proto')
    const origin =
      originHost && originProto ? `${originProto}://${originHost}` : request.nextUrl.origin

    const cookieHeader = request.headers.get('cookie') ?? ''

    const forwardRes = await fetch(`${origin}/api/canvass/lead`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: JSON.stringify({
        lead_id: lead.id,
        schedule_inspection: true,
        closer_user_id: closerUserId,
        inspection_scheduled_for: inspectionScheduledFor.trim(),
        use_round_robin: useRoundRobin,
        homeowner_name: lead.homeowner_name,
        phone: lead.phone,
        email: lead.email,
        address_text: lead.address_text,
        notes: lead.notes,
        canvass_notes: lead.canvass_notes,
        canvass_disposition: lead.canvass_disposition,
      }),
    })

    const data = await forwardRes.json().catch(() => ({ error: 'Invalid response from scheduling service' }))
    return NextResponse.json(data, { status: forwardRes.status })
  } catch (e: any) {
    const msg = String(e?.message || 'Unauthorized')
    if (msg.includes('Unauthorized') || msg.includes('Account disabled')) {
      return NextResponse.json({ error: msg }, { status: 401 })
    }
    console.error('POST /api/leads/[id]/schedule-inspection', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
