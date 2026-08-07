/**
 * Works out which manager(s) earn the 1% override on a job, so the override can be
 * paid without an admin hand-entering a `deal_commission_roles` row for every deal.
 *
 * Source of truth is the effective-dated `user_manager_assignments` history seeded
 * from `users.manager_user_id` only from the migration date forward. Payroll resolves
 * the chart on the job's sale date; it never uses today's hierarchy to rewrite older
 * pay. A timeframe with no recorded assignment stays blank.
 *
 * ── Stated assumptions (a human must confirm these before the rate is switched on) ──
 *
 * 1. ONE ACTIVE RUNG. The override stops at the first ACTIVE manager above a
 *    participant. The published ladder (arx-website `src/lib/comp-plan.ts`) defines a
 *    single manager rung taking 1% of "team revenue + own revenue"; it does not
 *    describe a grandparent manager also taking 1%.
 *
 *    An inactive user is a TRANSPARENT LINK in the chain, not a terminal one: the
 *    override rolls up past them (rule set by ownership 2026-08-05). So with
 *    Archer → Corey (inactive) → Evan (active), a deal Archer set pays Evan, not
 *    Corey. If no active manager exists anywhere up the chain, NO override line is
 *    emitted — the payout is never allowed to land on a deactivated user.
 *    `MANAGER_OVERRIDE_MAX_LEVELS` counts ACTIVE levels, not raw hops.
 *
 * 2. "OWN REVENUE" = a participant who is themselves an ACTIVE manager. The published
 *    plan pays the override on the manager's own production as well as the team's, and
 *    the only signal available for "this person holds a manager seat" is that at least
 *    one other user reports to them. So an ACTIVE participant with at least one direct
 *    report earns the override on their own deal. An inactive manager producing their
 *    own deal collects nothing, and it rolls up to their first active manager by the
 *    same walk as rule 1.
 *
 *    Rules 1 and 2 compose: when Corey (an active manager) personally produces a deal,
 *    Corey takes the own-production override AND Evan — the first active rung above
 *    the PRODUCER — takes the team override. When Corey's report Archer produces and
 *    Corey is active, Corey is that rung and Evan gets nothing. Both cases pay exactly
 *    one active rung above the person who did the work.
 *
 * 3. ONE LINE PER MANAGER PER JOB. A manager who both closed a job and manages its
 *    setter earns 1%, not 2%. Recipients are deduped by user id.
 *
 * 4. `users.active` IS THE SIGNAL, and it is `boolean NOT NULL DEFAULT true` in this
 *    schema. Only a strict `false` is treated as inactive — a missing or null value is
 *    treated as active, so a column that fails to load can never silently strip
 *    somebody's override.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DealCommissionRoleParticipant } from '@/lib/payroll-export'
import { normalizeCommissionRatePercent } from '@/lib/commission-rate'

/** The `deal_commission_roles.role` the derived override is written as. */
export const MANAGER_OVERRIDE_ROLE = 'field_manager' as const

/**
 * How many ACTIVE rungs up the `manager_user_id` chain the override is paid. 1 = only
 * the first active manager above a participant. Inactive users passed over on the way
 * there do not consume a level. See assumption 1 above.
 */
export const MANAGER_OVERRIDE_MAX_LEVELS = 1

/**
 * Roles that mean "an admin has taken manual control of this job's manager override".
 * Any of them present suppresses the derived line entirely, including a deliberate $0.
 */
const EXPLICIT_MANAGER_ROLES: ReadonlySet<string> = new Set(['field_manager', 'senior_manager'])

export type OrgManagerHierarchy = {
  /** user id → their direct manager's user id. Self-references are dropped. */
  managerByUser: Map<string, string>
  /** Users that at least one other user reports to — i.e. holders of a manager seat. */
  usersWithReports: Set<string>
  /**
   * Users whose `users.active` is strictly `false`. Membership here means the override
   * rolls PAST them to the next rung; absence means active (see assumption 4).
   */
  inactiveUserIds: Set<string>
}

export type EffectiveManagerAssignmentRow = {
  userId: string
  managerUserId: string
  effectiveFrom: string
  effectiveTo: string | null
}

export type EffectiveUserActiveRow = {
  userId: string
  isActive: boolean
  effectiveFrom: string
}

export const EMPTY_MANAGER_HIERARCHY: OrgManagerHierarchy = {
  managerByUser: new Map(),
  usersWithReports: new Set(),
  inactiveUserIds: new Set(),
}

export const EMPTY_MANAGER_ASSIGNMENTS: EffectiveManagerAssignmentRow[] = []

/** Only a strict `false` deactivates. Missing/null is treated as active. */
function isActiveInHierarchy(userId: string, hierarchy: OrgManagerHierarchy): boolean {
  return !hierarchy.inactiveUserIds.has(userId)
}

/**
 * Load the effective-dated reporting history used for payroll. Existing current
 * relationships are seeded only from the migration date; no historical hierarchy
 * is guessed. Missing history for a sale date therefore yields no override.
 */
export async function loadOrgManagerAssignments(
  supabase: SupabaseClient,
  orgId: string
): Promise<EffectiveManagerAssignmentRow[]> {
  const { data, error } = await supabase
    .from('user_manager_assignments')
    .select('user_id, manager_user_id, effective_from, effective_to')
    .eq('org_id', orgId)
    .order('effective_from', { ascending: true })

  if (error) throw error

  return ((data || []) as Array<{
    user_id: string
    manager_user_id: string
    effective_from: string
    effective_to: string | null
  }>).map((row) => ({
    userId: row.user_id,
    managerUserId: row.manager_user_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  }))
}

export async function loadOrgUserActiveHistory(
  supabase: SupabaseClient,
  orgId: string
): Promise<EffectiveUserActiveRow[]> {
  const { data, error } = await supabase
    .from('user_payroll_active_history')
    .select('user_id, is_active, effective_from')
    .eq('org_id', orgId)
    .order('effective_from', { ascending: true })
  if (error) throw error
  return ((data || []) as Array<{
    user_id: string
    is_active: boolean
    effective_from: string
  }>).map((row) => ({
    userId: row.user_id,
    isActive: row.is_active,
    effectiveFrom: row.effective_from,
  }))
}

/** Build the reporting chart that was effective on the job's sale date. */
export function buildManagerHierarchyForDate(
  assignments: readonly EffectiveManagerAssignmentRow[],
  saleDate: string | null | undefined,
  activeHistory: readonly EffectiveUserActiveRow[] = []
): OrgManagerHierarchy {
  const ymd = saleDate?.slice(0, 10) ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return EMPTY_MANAGER_HIERARCHY

  const effective = assignments
    .filter(
      (row) =>
        row.effectiveFrom <= ymd && (row.effectiveTo === null || row.effectiveTo >= ymd)
    )
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))

  const activeByUser = new Map<string, boolean>()
  for (const row of [...activeHistory].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))) {
    if (row.effectiveFrom <= ymd) activeByUser.set(row.userId, row.isActive)
  }

  const rowByUser = new Map<
    string,
    { id: string; manager_user_id: string | null; active: boolean | null }
  >()
  for (const row of effective) {
    rowByUser.set(row.userId, {
      id: row.userId,
      manager_user_id: row.managerUserId,
      active: activeByUser.get(row.userId) ?? null,
    })
    if (!rowByUser.has(row.managerUserId)) {
      rowByUser.set(row.managerUserId, {
        id: row.managerUserId,
        manager_user_id: null,
        active: activeByUser.get(row.managerUserId) ?? null,
      })
    }
  }
  for (const [userId, isActive] of Array.from(activeByUser.entries())) {
    const existing = rowByUser.get(userId)
    if (existing) existing.active = isActive
  }
  return buildManagerHierarchy(Array.from(rowByUser.values()))
}

/** Pure hierarchy builder, so the traversal rules can be tested without a database. */
export function buildManagerHierarchy(
  rows: Array<{ id: string | null; manager_user_id: string | null; active?: boolean | null }>
): OrgManagerHierarchy {
  const managerByUser = new Map<string, string>()
  const usersWithReports = new Set<string>()
  const inactiveUserIds = new Set<string>()

  for (const row of rows) {
    const id = row.id
    if (!id) continue
    // `users.active` is boolean NOT NULL DEFAULT true. Strict `false` only, so an
    // unselected or null column reads as active and never strips an override.
    if (row.active === false) inactiveUserIds.add(id)

    const managerId = row.manager_user_id
    if (!managerId) continue
    // A user recorded as their own manager is a data bug, not a manager seat.
    if (managerId === id) continue
    managerByUser.set(id, managerId)
    usersWithReports.add(managerId)
  }

  return { managerByUser, usersWithReports, inactiveUserIds }
}

/**
 * Which users earn a manager override on a job with these paying participants.
 *
 * Returned in a stable order (participant order, then chain order) so the same job
 * always produces the same payout lines.
 *
 * Inactive users are skipped WITHOUT consuming a level, so the override rolls up to
 * the first active manager. Cycle-safe: `visited` grows on every hop whether the node
 * is active or not, so a `manager_user_id` loop (a → b → a) terminates instead of
 * hanging payroll — skipping inactive users cannot turn a cycle into an infinite walk.
 */
export function deriveManagerOverrideRecipients(
  participantUserIds: readonly string[],
  hierarchy: OrgManagerHierarchy,
  options?: { maxLevels?: number }
): string[] {
  const maxLevels = Math.max(0, options?.maxLevels ?? MANAGER_OVERRIDE_MAX_LEVELS)
  const recipients: string[] = []
  const seen = new Set<string>()

  const add = (userId: string) => {
    if (seen.has(userId)) return
    seen.add(userId)
    recipients.push(userId)
  }

  for (const participantId of participantUserIds) {
    if (!participantId) continue

    // Own production: an ACTIVE participant who holds a manager seat takes the
    // override on their own deal too. A deactivated one collects nothing — their
    // share rolls up via the same walk below.
    if (
      hierarchy.usersWithReports.has(participantId) &&
      isActiveInHierarchy(participantId, hierarchy)
    ) {
      add(participantId)
    }

    // Team production: walk up until `maxLevels` ACTIVE managers have been paid.
    // Inactive users are transparent links — passed over, not counted, never paid.
    const visited = new Set<string>([participantId])
    let current = hierarchy.managerByUser.get(participantId) ?? null
    let activeLevels = 0
    while (current && activeLevels < maxLevels) {
      if (visited.has(current)) break // cycle guard
      visited.add(current)
      if (isActiveInHierarchy(current, hierarchy)) {
        add(current)
        activeLevels += 1
      }
      current = hierarchy.managerByUser.get(current) ?? null
    }
    // Falling out of the loop with activeLevels === 0 means no active manager exists
    // anywhere up this chain: no override line is emitted, and it is NEVER allowed to
    // fall back onto an inactive user.
  }

  return recipients
}

/**
 * Merge derived manager override lines into the explicit per-job commission roles.
 *
 * Precedence, highest first — identical to `withDerivedInspector`:
 *  1. Any explicit `field_manager` / `senior_manager` row an admin saved for this job.
 *     Present at all ⇒ the derived lines are suppressed entirely, including when the
 *     admin deliberately set $0 or named a different manager.
 *  2. Derived recipients at the org's manager override rate.
 *  3. Nothing, when the rate is 0/unset or no manager can be identified.
 *
 * Pure so the precedence rules can be tested without a database.
 */
export function withDerivedManagerOverride(
  explicit: DealCommissionRoleParticipant[],
  managerUserIds: readonly string[],
  overrideRatePercent: number
): DealCommissionRoleParticipant[] {
  if (!Number.isFinite(overrideRatePercent) || overrideRatePercent <= 0) return explicit
  if (managerUserIds.length === 0) return explicit
  if (explicit.some((p) => EXPLICIT_MANAGER_ROLES.has(p.role))) return explicit

  const added: DealCommissionRoleParticipant[] = []
  const seen = new Set<string>()
  for (const userId of managerUserIds) {
    if (!userId || seen.has(userId)) continue
    seen.add(userId)
    added.push({
      userId,
      role: MANAGER_OVERRIDE_ROLE,
      overrideAmount: null,
      overridePercent: overrideRatePercent,
      premierPricingAmount: null,
    })
  }

  if (added.length === 0) return explicit
  return [...explicit, ...added]
}

/** Org manager override rate, defaulting to 0 (feature off) when unset or unreadable. */
export function normalizeManagerOverrideRate(value: unknown): number {
  return normalizeCommissionRatePercent(value)
}
