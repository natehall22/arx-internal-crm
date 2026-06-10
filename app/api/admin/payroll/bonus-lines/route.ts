import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isPayrollAdminRole, isRegionalBonusApproverRole } from '@/lib/payroll-admin-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * Walk the manager_user_id tree downward from `rootId` to collect all
 * descendant user IDs (reps under this manager at any depth).
 * `userMap` is keyed by user id, value is their manager_user_id.
 */
function collectDescendants(
  rootId: string,
  userMap: Map<string, string | null>,
): Set<string> {
  const result = new Set<string>()
  const queue = [rootId]
  while (queue.length > 0) {
    const current = queue.shift()!
    Array.from(userMap.entries()).forEach(([userId, managerId]) => {
      if (managerId === current && !result.has(userId)) {
        result.add(userId)
        queue.push(userId)
      }
    })
  }
  return result
}

export async function GET(request: NextRequest) {
  try {
    let profile
    let actorUserId: string
    try {
      const ctx = await requireAuthApi()
      profile = ctx.profile
      actorUserId = ctx.authUser.id
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const isFullAdmin = isPayrollAdminRole(profile.role)
    const isRegionalApprover = isRegionalBonusApproverRole(profile.role)

    if (!isFullAdmin && !isRegionalApprover) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = new URL(request.url)
    const VALID_STATUS_FILTERS = new Set(['pending_approval', 'approved', 'rejected', 'paid', 'all'])
    const rawStatus = url.searchParams.get('status') ?? 'pending_approval'
    const statusFilter = VALID_STATUS_FILTERS.has(rawStatus) ? rawStatus : 'pending_approval'
    const periodId = url.searchParams.get('period_id') ?? null

    const supabase = createServiceClient()

    // For regional approvers, collect the set of user IDs in their hierarchy
    let allowedUserIds: Set<string> | null = null
    if (!isFullAdmin && isRegionalApprover) {
      const { data: orgUsers, error: usersError } = await supabase
        .from('users')
        .select('id, manager_user_id')
        .eq('org_id', profile.org_id)
        .eq('active', true)

      if (usersError) {
        return NextResponse.json({ error: usersError.message }, { status: 500 })
      }

      const userMap = new Map<string, string | null>(
        (orgUsers ?? []).map((u: { id: string; manager_user_id: string | null }) => [
          u.id,
          u.manager_user_id,
        ]),
      )

      allowedUserIds = collectDescendants(actorUserId, userMap)

      if (allowedUserIds.size === 0) {
        // No direct reports — return empty list
        return NextResponse.json({ bonus_lines: [] })
      }
    }

    // Build bonus lines query
    let query = supabase
      .from('payroll_bonus_lines')
      .select(
        `
        id,
        org_id,
        payroll_period_id,
        user_id,
        bonus_type,
        amount,
        description,
        status,
        reviewed_by,
        reviewed_at,
        review_note,
        created_at,
        user:users!payroll_bonus_lines_user_id_fkey (
          id,
          full_name,
          role
        ),
        period:payroll_periods!payroll_bonus_lines_payroll_period_id_fkey (
          id,
          period_label,
          cutoff_at,
          lock_at,
          scheduled_pay_date,
          status
        ),
        reviewer:users!payroll_bonus_lines_reviewed_by_fkey (
          id,
          full_name
        )
        `.trim(),
      )
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }
    if (periodId) {
      query = query.eq('payroll_period_id', periodId)
    }
    // Push hierarchy filter to DB — never over-fetch then JS-filter
    if (allowedUserIds !== null) {
      query = query.in('user_id', Array.from(allowedUserIds))
    }

    const { data: bonusLines, error: bonusError } = await query

    if (bonusError) {
      return NextResponse.json({ error: bonusError.message }, { status: 500 })
    }

    return NextResponse.json({ bonus_lines: bonusLines ?? [] })
  } catch (error) {
    console.error('GET admin/payroll/bonus-lines', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
