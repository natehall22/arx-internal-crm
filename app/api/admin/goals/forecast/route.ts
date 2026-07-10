import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { assertGoalsAdminAccess } from '@/lib/goals-admin-access'
import { buildForecastPayload, getForecastPresetRange } from '@/lib/goals-scorecard'
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

    const url = request.nextUrl
    const preset = url.searchParams.get('preset') as 'mtd' | 'this_quarter' | 'last_vs_this_quarter' | null

    let start = url.searchParams.get('start')
    let end = url.searchParams.get('end')
    let compareStart = url.searchParams.get('compareStart')
    let compareEnd = url.searchParams.get('compareEnd')

    if (preset) {
      const resolved = getForecastPresetRange(preset)
      start = resolved.start
      end = resolved.end
      compareStart = resolved.compareStart ?? compareStart
      compareEnd = resolved.compareEnd ?? compareEnd
    }

    if (!start || !end) {
      return NextResponse.json(
        { error: 'start and end query params required (YYYY-MM-DD), or use preset=' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const payload = await buildForecastPayload(supabase, profile.org_id, {
      start,
      end,
      compareStart,
      compareEnd,
    })

    return NextResponse.json(payload)
  } catch (error) {
    console.error('GET /api/admin/goals/forecast failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
