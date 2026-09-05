import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { getAttributedCanvassLeadUserId } from '@/lib/canvass-lead-attribution'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const LEAD_LIMIT = 500

/**
 * GET /api/mobile/leads
 * Caller-owned canvass leads for ARX Sales (Bearer auth).
 * Ownership: attributed pin user OR owner_user_id (pin_attributed takes precedence via helper).
 */
export async function GET() {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createServiceClient()
    const profile = authContext.profile
    const userId = authContext.authUser.id

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Over-fetch by 1 to detect hasMore; SQL prefilter then apply attribution helper.
    const { data: rows, error } = await admin
      .from('leads')
      .select(
        'id, lat, lng, address_text, homeowner_name, phone, canvass_disposition, canvass_notes, status, created_at, updated_at, owner_user_id, pin_attributed_user_id, ownership_reassigned_at'
      )
      .eq('org_id', profile.org_id)
      .or(`owner_user_id.eq.${userId},pin_attributed_user_id.eq.${userId}`)
      .order('updated_at', { ascending: false })
      .limit(LEAD_LIMIT + 1)

    if (error) {
      console.error('mobile leads list', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const mine = (rows || []).filter(
      (lead) =>
        getAttributedCanvassLeadUserId(lead) === userId || lead.owner_user_id === userId
    )

    // Measured on the DB result, not the filtered one. The SQL prefilter matches pins where
    // EITHER column is this user, but the attribution helper now drops a pin transferred away
    // from them (owner moved to the rep who re-knocked it). Deriving hasMore from `mine` would
    // read that attrition as "no more leads" and silently truncate the rep's list.
    const hasMore = (rows || []).length > LEAD_LIMIT
    const sliced = mine.slice(0, LEAD_LIMIT)

    const leads = sliced.map((lead) => ({
      id: lead.id,
      lat: lead.lat,
      lng: lead.lng,
      address_text: lead.address_text,
      homeowner_name: lead.homeowner_name,
      phone: lead.phone,
      canvass_disposition: lead.canvass_disposition,
      canvass_notes: lead.canvass_notes,
      status: lead.status,
      created_at: lead.created_at,
      updated_at: lead.updated_at,
    }))

    return NextResponse.json({ leads, hasMore })
  } catch (error) {
    console.error('Mobile leads error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load leads' },
      { status: 500 }
    )
  }
}
