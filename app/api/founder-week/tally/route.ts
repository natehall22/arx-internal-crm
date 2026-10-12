import { NextResponse } from 'next/server'
import { requireFounderWeekUser } from '@/lib/founder-week-api'
import { fetchFounderWeekTally } from '@/lib/founder-week-tally'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * GET /api/founder-week/tally — this week's doors, sets, proposals shown and sales for the
 * founder calendar (/foundercalendar). Org-wide aggregate counts only. Access: lib/founder-week-api.ts.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const access = await requireFounderWeekUser()
  if (!access.ok) return access.response
  const headers = { 'Cache-Control': 'no-store' }

  try {
    const tally = await fetchFounderWeekTally(createServiceClient(), access.user.orgId)
    return NextResponse.json(tally, { status: 200, headers })
  } catch (error) {
    console.error('[founder-week/tally] failed', error)
    return NextResponse.json({ error: 'Failed to load tally' }, { status: 500, headers })
  }
}
