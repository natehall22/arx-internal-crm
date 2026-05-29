import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { buildPayrollStatement } from '@/lib/payroll-statement'
import { canViewPayrollStatement } from '@/lib/payroll-statement-access'

export const dynamic = 'force-dynamic'

/**
 * GET ?period_id=&user_id=
 * Rep, manager (team hierarchy), or payroll admin. All pay reads via service client.
 */
export async function GET(request: NextRequest) {
  try {
    let profile
    try {
      const ctx = await requireAuthApi()
      profile = ctx.profile
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const periodId = searchParams.get('period_id')
    const userId = searchParams.get('user_id') || profile.id

    if (!periodId) {
      return NextResponse.json({ error: 'period_id is required' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const allowed = await canViewPayrollStatement(supabase, profile, userId)
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const statement = await buildPayrollStatement(supabase, profile.org_id, periodId, userId)
    if (!statement) {
      return NextResponse.json({ error: 'Period not found' }, { status: 404 })
    }

    return NextResponse.json(statement)
  } catch (e) {
    console.error('commissions/statement', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
