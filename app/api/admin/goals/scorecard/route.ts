import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { assertGoalsAdminAccess } from '@/lib/goals-admin-access'
import { buildScorecardPayload } from '@/lib/goals-scorecard'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    let profile
    try {
      profile = (await requireAuthApi()).profile
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!assertGoalsAdminAccess(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const month = request.nextUrl.searchParams.get('month')
    if (!month) {
      return NextResponse.json({ error: 'month query param required (YYYY-MM)' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const scorecard = await buildScorecardPayload(supabase, profile.org_id, month)
    return NextResponse.json(scorecard)
  } catch (error) {
    console.error('GET /api/admin/goals/scorecard failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
