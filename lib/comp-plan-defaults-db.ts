import type { SupabaseClient } from '@supabase/supabase-js'

import { ymdInBusinessTz } from '@/lib/calendar-business-tz'
import {
  suggestDefaultPlan,
  usersMissingPayPlan,
  type PayPlanCandidate,
  type PlanForSuggestion,
} from '@/lib/comp-plan-defaults'
import { compPlanRoleLabel } from '@/lib/comp-plan-roles'

/** A deal credited this recently makes someone "earning commission" even if their role isn't a commission role. */
const CREDIT_LOOKBACK_DAYS = 120

export type PayPlanGap = {
  role: string
  roleLabel: string
  people: Array<{ id: string; name: string }>
  /** The one plan we would use as this role's default, or null when a person has to choose. */
  suggestion: { id: string; name: string; ratePercent: number } | null
}

/**
 * Who would be paid nothing for lack of a pay plan, grouped by role. One read, used by "Needs you" and the
 * defaults card so the two can never disagree.
 */
export async function loadPayPlanGaps(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<PayPlanGap[]> {
  const today = ymdInBusinessTz(now)
  const since = new Date(now.getTime() - CREDIT_LOOKBACK_DAYS * 86_400_000).toISOString()

  const [usersRes, assignRes, defaultsRes, plansRes, ownersRes, settersRes, jobsRes] = await Promise.all([
    admin.from('users').select('id, full_name, role, active').eq('org_id', orgId),
    admin.from('user_comp_plans').select('user_id, effective_from, effective_to').eq('org_id', orgId).lte('effective_from', today),
    admin.from('org_default_comp_plans').select('role, effective_from').eq('org_id', orgId).lte('effective_from', today),
    admin.from('comp_plans').select('id, name, is_active, base_percentage, applicable_roles, plan_purpose, is_manager_plan, plan_type').eq('org_id', orgId),
    admin.from('opportunities').select('owner_user_id').eq('org_id', orgId).gte('created_at', since).not('owner_user_id', 'is', null).limit(5000),
    admin.from('opportunities').select('setter_user_id').eq('org_id', orgId).gte('created_at', since).not('setter_user_id', 'is', null).limit(5000),
    admin.from('production_jobs').select('salesperson_id').eq('org_id', orgId).gte('sale_date', since.slice(0, 10)).not('salesperson_id', 'is', null).limit(5000),
  ])
  // Before the defaults table exists, or on any read problem, say nothing rather than raise a false alarm.
  if (usersRes.error || assignRes.error || defaultsRes.error || plansRes.error) return []

  const assigned = new Set(
    ((assignRes.data ?? []) as Array<{ user_id: string; effective_to: string | null }>)
      .filter((a) => !a.effective_to || a.effective_to >= today)
      .map((a) => a.user_id)
  )
  const credited = new Set<string>([
    ...((ownersRes.data ?? []) as Array<{ owner_user_id: string }>).map((r) => r.owner_user_id),
    ...((settersRes.data ?? []) as Array<{ setter_user_id: string }>).map((r) => r.setter_user_id),
    ...((jobsRes.data ?? []) as Array<{ salesperson_id: string }>).map((r) => r.salesperson_id),
  ])
  const users = ((usersRes.data ?? []) as Array<PayPlanCandidate & { active: boolean | null }>).filter((u) => u.active !== false)
  const missing = usersMissingPayPlan({
    users,
    assignedUserIds: assigned,
    defaultRoles: new Set(((defaultsRes.data ?? []) as Array<{ role: string }>).map((d) => d.role)),
    creditedUserIds: credited,
  })

  const plans = (plansRes.data ?? []) as PlanForSuggestion[]
  const byRole = new Map<string, PayPlanGap>()
  for (const u of missing) {
    const gap =
      byRole.get(u.role) ??
      (() => {
        const s = suggestDefaultPlan(u.role, plans)
        const g: PayPlanGap = {
          role: u.role,
          roleLabel: compPlanRoleLabel(u.role),
          people: [],
          suggestion: s ? { id: s.id, name: s.name, ratePercent: Number(s.base_percentage) } : null,
        }
        byRole.set(u.role, g)
        return g
      })()
    gap.people.push({ id: u.id, name: u.full_name || 'Unnamed' })
  }
  return Array.from(byRole.values()).sort((a, b) => b.people.length - a.people.length)
}
