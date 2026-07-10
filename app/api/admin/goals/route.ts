import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { assertGoalsAdminAccess } from '@/lib/goals-admin-access'
import { getOrgMonthlyGoal, upsertOrgMonthlyGoal } from '@/lib/goals-scorecard'
import { normalizeGoalMonth } from '@/lib/goals-period'
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
    const goal = await getOrgMonthlyGoal(supabase, profile.org_id, month)
    return NextResponse.json({ goal })
  } catch (error) {
    console.error('GET /api/admin/goals failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    let profile
    let userId: string
    try {
      const ctx = await requireAuthApi()
      profile = ctx.profile
      userId = ctx.authUser.id
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!assertGoalsAdminAccess(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body.month !== 'string') {
      return NextResponse.json({ error: 'month required (YYYY-MM)' }, { status: 400 })
    }

    try {
      normalizeGoalMonth(body.month)
    } catch {
      return NextResponse.json({ error: 'Invalid month format' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const goal = await upsertOrgMonthlyGoal(supabase, profile.org_id, userId, {
      month: body.month,
      doors_target: body.doors_target,
      sets_target: body.sets_target,
      sits_target: body.sits_target,
      sales_target: body.sales_target,
      revenue_target: body.revenue_target,
      notes: body.notes,
    })

    return NextResponse.json({ goal })
  } catch (error) {
    console.error('PUT /api/admin/goals failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
