import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type UserProfile = {
  id: string
  org_id: string
}

// UUID v4 regex — rejects non-UUID userId before hitting the DB (prevents timing oracle
// and schema-leak via distinguishable error responses).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = request.nextUrl.searchParams.get('userId')
    // Validate format before any DB access — prevents UUID cast errors leaking schema info.
    if (!userId || !UUID_RE.test(userId)) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const admin = createServiceClient()

    const caller: UserProfile = {
      id: authContext.authUser.id,
      org_id: authContext.profile.org_id,
    }

    const { data: targetProfile } = await admin
      .from('users')
      .select('org_id')
      .eq('id', userId)
      .single()

    // Return the same 404 whether the user doesn't exist or belongs to another org.
    // A distinct 403 would leak whether a UUID is a valid user in a different org.
    if (!targetProfile || targetProfile.org_id !== caller.org_id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Security invariant: the `.eq('org_id', caller.org_id)` filter below is defence-in-depth.
    // The primary org gate is the targetProfile check above — do not remove either check.
    const { data: badgeRows, error: badgesError } = await admin
      .from('user_badges')
      .select(
        'id, badge_id, awarded_at, incentive_badges ( name, description, icon_key, color_hex, image_url )',
      )
      .eq('user_id', userId)
      .eq('org_id', caller.org_id)
      .order('awarded_at', { ascending: false })

    if (badgesError) {
      console.error('GET /api/sisu/badges — query error', badgesError)
      return NextResponse.json({ error: 'Failed to load badges' }, { status: 500 })
    }

    return NextResponse.json({ badges: badgeRows ?? [] })
  } catch (error) {
    console.error('GET /api/sisu/badges — unhandled error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
