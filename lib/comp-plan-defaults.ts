/**
 * Org default pay plan per role.
 *
 * Payroll pays from an explicit `user_comp_plans` assignment. A person with none used to be silently skipped
 * (materializePayrollPeriod: `if (!plan) continue`) — paid nothing, with no warning. A default fills that gap:
 *  - only when there is NO assignment on the sale date;
 *  - only for sale dates on/after the default's `effective_from` (history is never restated);
 *  - the latest default for the person's role with effective_from <= saleDate wins.
 * Pure helpers here; the DB read lives in lib/payroll-export.ts next to the assignment read, so there is one resolver.
 */

export type OrgDefaultCompPlanRow = {
  role: string
  comp_plan_id: string
  effective_from: string
}

export function selectDefaultForRole<T extends OrgDefaultCompPlanRow>(rows: readonly T[], role: string | null | undefined, saleDateYmd: string): T | null {
  if (!role) return null
  const matches = rows.filter((r) => r.role === role && r.effective_from <= saleDateYmd)
  if (matches.length === 0) return null
  return [...matches].sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : 0))[0]
}

export type PlanForSuggestion = {
  id: string
  name: string
  is_active: boolean
  base_percentage: number | string | null
  applicable_roles: string[] | null
  plan_purpose: string | null
  is_manager_plan: boolean | null
  plan_type: string | null
}

/** The company base rate each role is paid at (CLAUDE.md / comp ladder): setter 5%, closer 7%. */
export const COMPANY_BASE_RATE_BY_ROLE: Record<string, number> = {
  setter: 5,
  sales_rep: 7,
  closer: 7,
}

/**
 * The one plan we would suggest as a role's default: a primary, non-manager percentage plan tagged for the role
 * whose base rate is the company rate. `null` when there is not exactly one — then a person picks.
 * Inactive plans are allowed (an inactive plan still prices correctly; "active" only hides it from new assignments).
 */
export function suggestDefaultPlan(role: string, plans: readonly PlanForSuggestion[]): PlanForSuggestion | null {
  const rate = COMPANY_BASE_RATE_BY_ROLE[role]
  if (rate === undefined) return null
  const candidates = plans.filter(
    (p) =>
      (p.plan_purpose ?? 'primary') === 'primary' &&
      !p.is_manager_plan &&
      p.plan_type === 'percentage' &&
      (p.applicable_roles ?? []).includes(role) &&
      Number(p.base_percentage) === rate
  )
  return candidates.length === 1 ? candidates[0] : null
}

export type PayPlanCandidate = { id: string; full_name: string | null; role: string }

/**
 * People who should have a pay plan but would be paid nothing: active, earn commission (a commission role, or
 * credited on a deal recently), and have neither a current assignment nor a default for their role.
 */
export function usersMissingPayPlan(args: {
  users: readonly PayPlanCandidate[]
  assignedUserIds: ReadonlySet<string>
  /** Anyone who has EVER had an assignment: their plan was ended on purpose, so the default never applies (see usersWithEndedPlan). */
  everAssignedUserIds?: ReadonlySet<string>
  defaultRoles: ReadonlySet<string>
  creditedUserIds: ReadonlySet<string>
}): PayPlanCandidate[] {
  return args.users.filter(
    (u) =>
      !args.assignedUserIds.has(u.id) &&
      !args.everAssignedUserIds?.has(u.id) &&
      !args.defaultRoles.has(u.role) &&
      (COMMISSION_ROLES.has(u.role) || args.creditedUserIds.has(u.id))
  )
}

/** Roles that earn commission by being the role. (Admins/owners only count when credited on a deal.) */
export const COMMISSION_ROLES: ReadonlySet<string> = new Set([
  'sales_rep',
  'closer',
  'setter',
  'canvasser',
  'setter_manager',
  'sales_manager',
  'regional_manager',
  'regional_setter_manager',
  'inside_sales',
  'call_center',
  'rep',
])


export type ActiveHistoryRow = { effectiveFrom: string; isActive: boolean }

const dayBefore = (ymd: string): string => {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * The ONE rule for "when does a role default apply to this person", used by both the base-pay resolver and the
 * derived-line builders so they can never disagree. Returns the date window [from, to] (to = null → open-ended), or
 * null when the default never applies:
 *  - never for a test account;
 *  - only from the default's own start, and only while the person was active ON THE SALE DATE (payroll active history,
 *    falling back to today's flag when there is none) — a pre-departure sale still pays after someone leaves;
 *  - only BEFORE their first assignment: from then on their pay is assignment-driven, and an ended assignment means
 *    "ended on purpose", not "never set up" (see usersWithEndedPlan).
 */
export function defaultWindowForUser(a: {
  defaultFrom: string | null
  isTestAccount?: boolean | null
  activeNow?: boolean | null
  activeHistory: readonly ActiveHistoryRow[]
  assignmentFromDates: readonly string[]
}): { from: string; to: string | null } | null {
  if (!a.defaultFrom || a.isTestAccount === true) return null
  let to: string | null = null
  const hist = [...a.activeHistory].sort((x, y) => x.effectiveFrom.localeCompare(y.effectiveFrom))
  if (hist.length) {
    const last = hist[hist.length - 1]
    if (!last.isActive) to = dayBefore(last.effectiveFrom)
  } else if (a.activeNow === false) {
    return null
  }
  if (a.assignmentFromDates.length) {
    const before = dayBefore([...a.assignmentFromDates].sort()[0])
    if (to === null || before < to) to = before
  }
  if (to !== null && to < a.defaultFrom) return null
  return { from: a.defaultFrom, to }
}

/** Active, non-test people whose pay plan was ended and not replaced: they earn nothing until a plan is assigned. */
export function usersWithEndedPlan(args: {
  users: ReadonlyArray<PayPlanCandidate & { active?: boolean | null; isTestAccount?: boolean | null }>
  assignments: ReadonlyArray<{ user_id: string; effective_from: string; effective_to: string | null }>
  today: string
}): Array<PayPlanCandidate & { endedOn: string }> {
  const byUser = new Map<string, Array<{ effective_from: string; effective_to: string | null }>>()
  for (const a of args.assignments) byUser.set(a.user_id, [...(byUser.get(a.user_id) ?? []), a])
  const out: Array<PayPlanCandidate & { endedOn: string }> = []
  for (const u of args.users) {
    if (u.active === false || u.isTestAccount === true) continue
    const rows = byUser.get(u.id)
    if (!rows?.length) continue
    // Covered today, or about to be (a plan starting in the future is a replacement).
    if (rows.some((r) => r.effective_to === null || r.effective_to >= args.today)) continue
    const endedOn = rows.map((r) => r.effective_to as string).sort().slice(-1)[0]
    out.push({ ...u, endedOn })
  }
  return out.sort((a, b) => b.endedOn.localeCompare(a.endedOn))
}

export type DefaultCoverageRow = { userId: string; effectiveFrom: string; effectiveTo: string | null; isManagerPlan: boolean }

/**
 * Pay-plan "assignments" a role default stands in for, so the derived-line builders (inspection 1.5%, self-gen 6%,
 * manager override) treat a default-plan rep exactly like an assigned one: one row per default segment, over the
 * window defaultWindowForUser allows, carrying that segment's own manager-plan flag.
 */
export function buildDefaultCoverageRows(args: {
  users: ReadonlyArray<{ id: string; role: string; active?: boolean | null; isTestAccount?: boolean | null }>
  activeHistoryByUser: ReadonlyMap<string, ActiveHistoryRow[]>
  assignmentFromDatesByUser: ReadonlyMap<string, string[]>
  defaults: ReadonlyArray<OrgDefaultCompPlanRow & { isManagerPlan?: boolean }>
}): DefaultCoverageRow[] {
  const rows: DefaultCoverageRow[] = []
  for (const u of args.users) {
    const mine = args.defaults.filter((d) => d.role === u.role).sort((a, b) => a.effective_from.localeCompare(b.effective_from))
    if (!mine.length) continue
    const win = defaultWindowForUser({
      defaultFrom: mine[0].effective_from,
      isTestAccount: u.isTestAccount,
      activeNow: u.active,
      activeHistory: args.activeHistoryByUser.get(u.id) ?? [],
      assignmentFromDates: args.assignmentFromDatesByUser.get(u.id) ?? [],
    })
    if (!win) continue
    mine.forEach((d, i) => {
      const segTo = i + 1 < mine.length ? dayBefore(mine[i + 1].effective_from) : null
      const from = d.effective_from > win.from ? d.effective_from : win.from
      const to = segTo === null ? win.to : win.to === null || segTo < win.to ? segTo : win.to
      if (to !== null && to < from) return
      rows.push({ userId: u.id, effectiveFrom: from, effectiveTo: to, isManagerPlan: d.isManagerPlan === true })
    })
  }
  return rows
}
