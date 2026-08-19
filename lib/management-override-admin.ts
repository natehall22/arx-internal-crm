/**
 * Read-model for the manager override, shared by the admin summary card and the
 * assign flow so the two can never describe the same override differently.
 *
 * The override is NOT an org rate. Payroll builds each override line from three
 * effective-dated records (see lib/job-derived-commission-lines.ts and
 * lib/management-comp-overlay.ts):
 *
 *   1. `user_management_comp_overlay_assignments` — which manager holds an override,
 *      in which production lane (setter/closer), between which dates.
 *   2. `management_comp_overlay_plan_versions` — the percent that overlay plan pays in
 *      that lane, from a given date. Append-only; the rate on a sale date is the latest
 *      version at or before it.
 *   3. `user_manager_assignments` — whose production rolls up to that manager on the
 *      sale date. A manager with no active direct report earns nothing, which is why
 *      `assign_management_comp_overlay` refuses to assign one.
 *
 * Everything here is pure: no database, no clock. Callers pass `today` so the same
 * input always renders the same output.
 */

export type OverlayLane = 'setter' | 'closer'

/** Where an assignment sits relative to today. Mirrors the wording used in the UI. */
export type OverlayStatus = 'current' | 'scheduled' | 'ending' | 'historical'

export type OverlayAssignmentInput = {
  id: string
  user_id: string
  comp_plan_id: string
  lane: OverlayLane
  effective_from: string
  effective_to: string | null
  ended_at?: string | null
  comp_plans?: { name: string } | null
}

export type OverlayVersionInput = {
  comp_plan_id: string
  lane: OverlayLane
  override_percent: number
  effective_from: string
}

export type ManagerAssignmentInput = {
  user_id: string
  manager_user_id: string
  effective_from: string
  effective_to: string | null
}

export type OverrideSummaryRow = {
  assignmentId: string
  lane: OverlayLane
  managerUserId: string
  managerName: string
  planId: string
  planName: string
  /** Null when the overlay plan has no version at or before the date being described. */
  ratePercent: number | null
  effectiveFrom: string
  effectiveTo: string | null
  status: OverlayStatus
  /** Active direct reports whose production rolls up on the date being described. */
  reportCount: number
}

function isEffectiveOn(
  row: { effective_from: string; effective_to: string | null },
  date: string
): boolean {
  return row.effective_from <= date && (!row.effective_to || row.effective_to >= date)
}

/**
 * The percent in force for an overlay plan + lane on a date: the latest version at or
 * before it. Returns null when the plan has no version yet — which is not the same as
 * 0%, and the UI must not render it as one.
 */
export function resolveOverlayRatePercent(
  versions: readonly OverlayVersionInput[],
  planId: string,
  lane: OverlayLane,
  onDate: string
): number | null {
  const version = versions
    .filter((row) => row.comp_plan_id === planId && row.lane === lane && row.effective_from <= onDate)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]
  return version ? Number(version.override_percent) : null
}

/**
 * The date each status should be priced at. A scheduled override is quoted at the rate
 * that will be in force when it starts, not today's; a historical one at its last day.
 */
function rateDateForStatus(
  status: OverlayStatus,
  assignment: OverlayAssignmentInput,
  today: string
): string {
  if (status === 'current' || status === 'ending') return today
  if (status === 'scheduled') return assignment.effective_from
  return assignment.effective_to || assignment.effective_from
}

function countActiveReports(
  managerAssignments: readonly ManagerAssignmentInput[],
  activeUserIds: ReadonlySet<string>,
  managerUserId: string,
  onDate: string
): number {
  const reportIds = new Set(
    managerAssignments
      .filter(
        (row) =>
          row.manager_user_id === managerUserId &&
          activeUserIds.has(row.user_id) &&
          isEffectiveOn(row, onDate)
      )
      .map((row) => row.user_id)
  )
  return reportIds.size
}

/**
 * One row per (manager, lane) worth showing: the override in force today, plus any
 * scheduled change, plus the most recent ended one when nothing is live. Sorted by lane
 * then manager name so the card is stable across reloads.
 */
export function summarizeManagerOverrides(input: {
  assignments: readonly OverlayAssignmentInput[]
  versions: readonly OverlayVersionInput[]
  managerAssignments: readonly ManagerAssignmentInput[]
  userNamesById: ReadonlyMap<string, string>
  activeUserIds: ReadonlySet<string>
  today: string
}): OverrideSummaryRow[] {
  const { assignments, versions, managerAssignments, userNamesById, activeUserIds, today } = input

  const byManagerLane = new Map<string, OverlayAssignmentInput[]>()
  for (const assignment of assignments) {
    const key = `${assignment.user_id}::${assignment.lane}`
    const existing = byManagerLane.get(key) || []
    existing.push(assignment)
    byManagerLane.set(key, existing)
  }

  const rows: OverrideSummaryRow[] = []
  for (const group of Array.from(byManagerLane.values())) {
    const sorted = [...group].sort((a, b) => b.effective_from.localeCompare(a.effective_from))
    const current = sorted.find((row) => isEffectiveOn(row, today))
    const scheduled = [...sorted]
      .filter((row) => row.effective_from > today)
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0]
    const historical = sorted.find((row) => row.effective_to && row.effective_to < today)

    const picked: Array<{ assignment: OverlayAssignmentInput; status: OverlayStatus }> = []
    if (current) {
      picked.push({ assignment: current, status: current.ended_at ? 'ending' : 'current' })
    }
    if (scheduled) picked.push({ assignment: scheduled, status: 'scheduled' })
    if (!current && !scheduled && historical) {
      picked.push({ assignment: historical, status: 'historical' })
    }

    for (const { assignment, status } of picked) {
      const rateDate = rateDateForStatus(status, assignment, today)
      rows.push({
        assignmentId: assignment.id,
        lane: assignment.lane,
        managerUserId: assignment.user_id,
        managerName: userNamesById.get(assignment.user_id) || 'Unknown user',
        planId: assignment.comp_plan_id,
        planName: assignment.comp_plans?.name || 'Unknown overlay plan',
        ratePercent: resolveOverlayRatePercent(versions, assignment.comp_plan_id, assignment.lane, rateDate),
        effectiveFrom: assignment.effective_from,
        effectiveTo: assignment.effective_to,
        status,
        reportCount: countActiveReports(managerAssignments, activeUserIds, assignment.user_id, rateDate),
      })
    }
  }

  return rows.sort((a, b) => {
    if (a.lane !== b.lane) return a.lane === 'setter' ? -1 : 1
    if (a.managerName !== b.managerName) return a.managerName.localeCompare(b.managerName)
    return a.effectiveFrom.localeCompare(b.effectiveFrom)
  })
}

/**
 * Managers who may be given an override starting on `onDate`, matching the eligibility
 * `assign_management_comp_overlay` enforces server-side: an active user with at least
 * one active direct report effective that day. Returned as ids so the caller can order
 * and label them however it already does.
 */
export function eligibleOverrideManagerIds(input: {
  managerAssignments: readonly ManagerAssignmentInput[]
  activeUserIds: ReadonlySet<string>
  onDate: string
}): Set<string> {
  const { managerAssignments, activeUserIds, onDate } = input
  return new Set(
    managerAssignments
      .filter((row) => activeUserIds.has(row.user_id) && isEffectiveOn(row, onDate))
      .map((row) => row.manager_user_id)
      .filter((managerUserId) => activeUserIds.has(managerUserId))
  )
}
