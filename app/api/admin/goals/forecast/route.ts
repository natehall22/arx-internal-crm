import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { assertGoalsAdminAccess } from '@/lib/goals-admin-access'
import { buildForecastPayload } from '@/lib/goals-scorecard'
import { getForecastPresetRange, type ForecastPreset } from '@/lib/goals-period'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const FORECAST_PRESETS: ForecastPreset[] = ['mtd', 'this_quarter', 'last_vs_this_quarter']

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/

/**
 * Range params reach date math and a PostgREST `in.(…)` month filter, so they are
 * validated here rather than being allowed to fail as an opaque 500 downstream.
 */
function isValidDateParam(value: string | null): boolean {
  if (!value || !DATE_PARAM.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const parsed = new Date(Date.UTC(y, m - 1, d))
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d
}

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
    const presetParam = url.searchParams.get('preset')

    let start = url.searchParams.get('start')
    let end = url.searchParams.get('end')
    let compareStart = url.searchParams.get('compareStart')
    let compareEnd = url.searchParams.get('compareEnd')

    if (presetParam) {
      if (!FORECAST_PRESETS.includes(presetParam as ForecastPreset)) {
        return NextResponse.json(
          { error: `preset must be one of: ${FORECAST_PRESETS.join(', ')}` },
          { status: 400 }
        )
      }
      const resolved = getForecastPresetRange(presetParam as ForecastPreset)
      start = resolved.start
      end = resolved.end
      compareStart = resolved.compareStart ?? null
      compareEnd = resolved.compareEnd ?? null
    }

    if (!isValidDateParam(start) || !isValidDateParam(end)) {
      return NextResponse.json(
        { error: 'start and end query params required (YYYY-MM-DD), or use preset=' },
        { status: 400 }
      )
    }

    if (start! > end!) {
      return NextResponse.json({ error: 'start must be on or before end' }, { status: 400 })
    }

    // Both compare bounds must be present and valid together, or neither is used.
    const hasCompare = isValidDateParam(compareStart) && isValidDateParam(compareEnd)
    if ((compareStart || compareEnd) && !hasCompare) {
      return NextResponse.json(
        { error: 'compareStart and compareEnd must both be valid dates (YYYY-MM-DD)' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const payload = await buildForecastPayload(supabase, profile.org_id, {
      start: start!,
      end: end!,
      compareStart: hasCompare ? compareStart : null,
      compareEnd: hasCompare ? compareEnd : null,
    })

    return NextResponse.json(payload)
  } catch (error) {
    console.error('GET /api/admin/goals/forecast failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
