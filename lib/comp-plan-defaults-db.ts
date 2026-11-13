import type { SupabaseClient } from '@supabase/supabase-js'

import { ymdInBusinessTz } from '@/lib/calendar-business-tz'
import {
  suggestDefaultPlan,
  usersMissingPayPlan,
  usersWithEndedPlan,
  type PayPlanCandidate,
  type PlanForSuggestion,
} from '@/lib/comp-plan-defaults'
import { compPlanRoleLabel } from '@/lib/comp-plan-roles'
import { formatDate } from '@/lib/format'
import {
  collectParticipants,
  hasResolvableCompPlanForUserOnDate,
  loadProducerCommissionOverrides,
  producerOverrideKey,
  producerStorageRoleForParticipant,
  resolveProducerOverrideAmount,
} from '@/lib/payroll-export'

/** A deal credited this recently makes someone "earning commission" even if their role isn't a commission role. */
const CREDIT_LOOKBACK_DAYS = 120

export type EndedPlanPerson = { id: string; name: string; role: string; roleLabel: string; endedOn: string }

export type PayPlanGap = {
  /** 'no_plan' (default): nobody set up today. 'sale_date': has a plan, but not on the sale date of a job not yet paid — that job waits. */
  kind?: 'no_plan' | 'sale_date'
  role: string
  roleLabel: string
  /** `detail` (sale-date gaps only): "26-0043, sold Sep 3, 2026". */
  people: Array<{ id: string; name: string; detail?: string }>
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
    loadUsers(admin, orgId),
    admin.from('user_comp_plans').select('user_id, effective_from, effective_to').eq('org_id', orgId),
    admin.from('org_default_comp_plans').select('role, effective_from').eq('org_id', orgId).lte('effective_from', today),
    admin.from('comp_plans').select('id, name, is_active, base_percentage, applicable_roles, plan_purpose, is_manager_plan, plan_type').eq('org_id', orgId),
    admin.from('opportunities').select('owner_user_id').eq('org_id', orgId).gte('created_at', since).not('owner_user_id', 'is', null).limit(5000),
    admin.from('opportunities').select('setter_user_id').eq('org_id', orgId).gte('created_at', since).not('setter_user_id', 'is', null).limit(5000),
    admin.from('production_jobs').select('salesperson_id').eq('org_id', orgId).gte('sale_date', since.slice(0, 10)).not('salesperson_id', 'is', null).limit(5000),
  ])
  // Before the defaults table exists, or on any read problem, say nothing rather than raise a false alarm.
  if (usersRes.error || assignRes.error || defaultsRes.error || plansRes.error) return []

  const allAssignments = (assignRes.data ?? []) as Array<{ user_id: string; effective_from: string; effective_to: string | null }>
  // Covered today, or starting in the future (a replacement is already lined up).
  const assigned = new Set(allAssignments.filter((a) => !a.effective_to || a.effective_to >= today).map((a) => a.user_id))
  // Anyone who has EVER had a plan is not "never set up": an ended plan is its own Needs-you item.
  const everAssigned = new Set(allAssignments.map((a) => a.user_id))
  const credited = new Set<string>([
    ...((ownersRes.data ?? []) as Array<{ owner_user_id: string }>).map((r) => r.owner_user_id),
    ...((settersRes.data ?? []) as Array<{ setter_user_id: string }>).map((r) => r.setter_user_id),
    ...((jobsRes.data ?? []) as Array<{ salesperson_id: string }>).map((r) => r.salesperson_id),
  ])
  const users = ((usersRes.data ?? []) as Array<PayPlanCandidate & { active: boolean | null; is_test_account?: boolean | null }>).filter((u) => u.active !== false && u.is_test_account !== true)
  const missing = usersMissingPayPlan({
    users,
    assignedUserIds: assigned,
    everAssignedUserIds: everAssigned,
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
  const missingIds = new Set(missing.map((u) => u.id))
  // The SALE date decides which plan pays a job (loadActiveCompPlanForUser), so "has a plan today" is not enough: someone whose plan
  // has a gap over a sold, not-yet-paid job holds that whole job (planPayrollPeriod, no_pay_plan_on_sale_date).
  const saleDateGaps = await loadSaleDatePlanGaps(
    admin,
    orgId,
    allAssignments,
    ((usersRes.data ?? []) as Array<{ id: string; full_name: string | null; role: string; is_test_account?: boolean | null }>).filter((u) => u.is_test_account !== true && !missingIds.has(u.id)),
    now
  ).catch((error) => {
    console.error('loadPayPlanGaps: sale-date check failed', { orgId, error })
    return [] as PayPlanGap[]
  })
  return [...Array.from(byRole.values()).sort((a, b) => b.people.length - a.people.length), ...saleDateGaps]
}

/** How far back a sold, unpaid job is checked. Older unpaid jobs are rare and still show on the Pay screen's waiting list. */
const SALE_DATE_LOOKBACK_DAYS = 365
const ID_CHUNK = 200

/**
 * People credited (closer / setter / salesperson, as payroll collects them) on a sold job that is not paid yet, with no pay plan on that
 * job's SALE date — the same answer the payroll engine gets (`hasResolvableCompPlanForUserOnDate`, which also applies the role default
 * rules). A per-job override for that person replaces the plan, so it is not a gap. Assignments are checked in memory first; the engine's
 * own lookup runs only for a pair no assignment covers.
 */
async function loadSaleDatePlanGaps(
  admin: SupabaseClient,
  orgId: string,
  assignments: Array<{ user_id: string; effective_from: string; effective_to: string | null }>,
  users: Array<{ id: string; full_name: string | null; role: string }>,
  now: Date
): Promise<PayPlanGap[]> {
  const since = ymdInBusinessTz(new Date(now.getTime() - SALE_DATE_LOOKBACK_DAYS * 86_400_000))
  const { data: jobData, error: jobError } = await admin
    .from('production_jobs')
    .select('id, job_number, sale_date, salesperson_id, project_id')
    .eq('org_id', orgId)
    .neq('status', 'cancelled')
    .is('payroll_settled_externally_at', null)
    .not('sale_date', 'is', null)
    .gte('sale_date', since)
    .order('sale_date', { ascending: true })
    .limit(2000)
  if (jobError) throw jobError
  const allJobs = (jobData ?? []) as Array<{ id: string; job_number: string; sale_date: string; salesperson_id: string | null; project_id: string | null }>
  if (allJobs.length === 0) return []

  const paid = new Set<string>()
  const projectIds = Array.from(new Set(allJobs.map((j) => j.project_id).filter((v): v is string => Boolean(v))))
  const oppIdByProject = new Map<string, string>()
  for (let i = 0; i < allJobs.length; i += ID_CHUNK) {
    const ids = allJobs.slice(i, i + ID_CHUNK).map((j) => j.id)
    const { data, error } = await admin.from('payroll_job_snapshots').select('job_id').eq('org_id', orgId).in('job_id', ids)
    if (error) throw error
    for (const r of data ?? []) paid.add(r.job_id as string)
  }
  for (let i = 0; i < projectIds.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('projects').select('id, opportunity_id').eq('org_id', orgId).in('id', projectIds.slice(i, i + ID_CHUNK))
    if (error) throw error
    for (const p of data ?? []) if (p.opportunity_id) oppIdByProject.set(p.id as string, p.opportunity_id as string)
  }
  const oppIds = Array.from(new Set(Array.from(oppIdByProject.values())))
  const oppById = new Map<string, { owner_user_id: string | null; setter_user_id: string | null }>()
  for (let i = 0; i < oppIds.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('opportunities').select('id, owner_user_id, setter_user_id').eq('org_id', orgId).in('id', oppIds.slice(i, i + ID_CHUNK))
    if (error) throw error
    for (const o of data ?? []) oppById.set(o.id as string, { owner_user_id: (o.owner_user_id as string) ?? null, setter_user_id: (o.setter_user_id as string) ?? null })
  }
  const jobs = allJobs.filter((j) => !paid.has(j.id))
  if (jobs.length === 0) return []
  const overrides = await loadProducerCommissionOverrides(admin, orgId, jobs.map((j) => j.id))

  const userById = new Map(users.map((u) => [u.id, u]))
  const covered = (userId: string, ymd: string) =>
    assignments.some((a) => a.user_id === userId && a.effective_from <= ymd && (a.effective_to === null || a.effective_to >= ymd))
  const engineCache = new Map<string, boolean>()
  const byRole = new Map<string, PayPlanGap>()
  for (const job of jobs) {
    const ymd = job.sale_date.slice(0, 10)
    const oppId = job.project_id ? oppIdByProject.get(job.project_id) : undefined
    for (const participant of collectParticipants(job, oppId ? oppById.get(oppId) ?? null : null)) {
      const user = userById.get(participant.userId)
      // Test accounts (filtered out of `users`) and people already listed as having no plan at all are not repeated here.
      if (!user) continue
      if (resolveProducerOverrideAmount(overrides.get(producerOverrideKey(job.id, participant.userId, producerStorageRoleForParticipant(participant.role))), 0)) continue
      if (covered(participant.userId, ymd)) continue
      const key = `${participant.userId}|${ymd}`
      if (!engineCache.has(key)) engineCache.set(key, await hasResolvableCompPlanForUserOnDate(admin, orgId, participant.userId, ymd))
      if (engineCache.get(key)) continue
      const gap =
        byRole.get(user.role) ??
        (() => {
          const g: PayPlanGap = { kind: 'sale_date', role: user.role, roleLabel: compPlanRoleLabel(user.role), people: [], suggestion: null }
          byRole.set(user.role, g)
          return g
        })()
      const detail = `${job.job_number}, sold ${formatDate(ymd)}`
      const existing = gap.people.find((p) => p.id === user.id)
      if (existing) existing.detail = `${existing.detail}; ${detail}`
      else gap.people.push({ id: user.id, name: user.full_name || 'Unnamed', detail })
    }
  }
  return Array.from(byRole.values())
}


async function loadUsers(admin: SupabaseClient, orgId: string) {
  // `is_test_account` is an additive column: fall back to the old shape if it isn't there yet.
  const r = await admin.from('users').select('id, full_name, role, active, is_test_account').eq('org_id', orgId)
  if (r.error && (r.error as { code?: string }).code === '42703') return admin.from('users').select('id, full_name, role, active').eq('org_id', orgId)
  return r
}

/** Active people whose pay plan was ended and not replaced. They are paid nothing (a default never applies to them). */
export async function loadEndedPlanPeople(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<EndedPlanPerson[]> {
  const today = ymdInBusinessTz(now)
  const [usersRes, assignRes] = await Promise.all([
    loadUsers(admin, orgId),
    admin.from('user_comp_plans').select('user_id, effective_from, effective_to').eq('org_id', orgId),
  ])
  if (usersRes.error || assignRes.error) return []
  const users = ((usersRes.data ?? []) as Array<PayPlanCandidate & { active: boolean | null; is_test_account?: boolean | null }>).map((u) => ({
    ...u,
    isTestAccount: u.is_test_account === true,
  }))
  return usersWithEndedPlan({ users, assignments: (assignRes.data ?? []) as Array<{ user_id: string; effective_from: string; effective_to: string | null }>, today }).map((u) => ({
    id: u.id,
    name: u.full_name || 'Unnamed',
    role: u.role,
    roleLabel: compPlanRoleLabel(u.role),
    endedOn: u.endedOn,
  }))
}
