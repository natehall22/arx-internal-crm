/**
 * Pure sale-date resolver for management compensation overlays.
 *
 * Primary sales compensation and management compensation are intentionally separate.
 * This module resolves no dollars and performs no database work: it identifies the
 * single fixed-percent overlay payable in each production lane, leaving callers to
 * apply the percent to the snapshotted commission base.
 */

export const MANAGEMENT_OVERLAY_LANES = ['setter', 'closer'] as const
export type ManagementOverlayLane = (typeof MANAGEMENT_OVERLAY_LANES)[number]

export type EffectiveManagerAssignment = {
  id: string
  userId: string
  managerUserId: string
  effectiveFrom: string
  effectiveTo: string | null
}

export type EffectiveManagementOverlayAssignment = {
  assignmentId: string
  managerUserId: string
  compPlanId: string
  lane: ManagementOverlayLane
  effectiveFrom: string
  effectiveTo: string | null
}

export type EffectiveUserPayrollActiveRow = {
  userId: string
  isActive: boolean
  effectiveFrom: string
}

/** Append-only terms for a management overlay plan. */
export type ManagementOverlayPlanVersion = {
  versionId: string
  compPlanId: string
  lane: ManagementOverlayLane
  ratePercent: number
  effectiveFrom: string
}

export type ManagementOverlayLine = {
  lane: ManagementOverlayLane
  producerUserId: string
  recipientUserId: string
  ratePercent: number
  overlayAssignmentId: string
  overlayVersionId: string
  /** Null for a manager's own production; otherwise the direct-report link used. */
  managerAssignmentId: string | null
  source: 'own_production' | 'direct_report'
}

export type ManagementOverlayResolutionIssue = {
  lane: ManagementOverlayLane | null
  code:
    | 'invalid_sale_date'
    | 'ambiguous_manager_assignment'
    | 'ambiguous_overlay_assignment'
    | 'ambiguous_plan_version'
    | 'invalid_overlay_rate'
  userId: string | null
}

export type ResolveManagementCompOverlaysInput = {
  saleDate: string | null | undefined
  setterProducerUserId?: string | null
  closerProducerUserId?: string | null
  managerAssignments: readonly EffectiveManagerAssignment[]
  overlayAssignments: readonly EffectiveManagementOverlayAssignment[]
  planVersions: readonly ManagementOverlayPlanVersion[]
  /** Sale-date payroll activity. Missing history is treated as active for compatibility. */
  userActiveHistory?: readonly EffectiveUserPayrollActiveRow[]
  /** An explicit/manual line (including a deliberate $0) suppresses only its lane. */
  suppressedLanes?: readonly ManagementOverlayLane[]
}

export type ResolveManagementCompOverlaysResult = {
  lines: ManagementOverlayLine[]
  issues: ManagementOverlayResolutionIssue[]
}

function isYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isEffective(
  row: { effectiveFrom: string; effectiveTo: string | null },
  ymd: string
): boolean {
  return (
    isYmd(row.effectiveFrom) &&
    row.effectiveFrom <= ymd &&
    (row.effectiveTo === null || (isYmd(row.effectiveTo) && row.effectiveTo >= ymd))
  )
}

/**
 * Resolve setter and closer overlays independently in stable lane order.
 *
 * Per lane, an effective overlay held by the producer wins as own production.
 * Otherwise the producer's one effective direct manager is considered. Overlapping
 * dated manager links or overlay versions are ambiguous payroll inputs: the lane is
 * left blank and an issue is returned rather than guessing who should be paid.
 */
export function resolveManagementCompOverlays(
  input: ResolveManagementCompOverlaysInput
): ResolveManagementCompOverlaysResult {
  const ymd = input.saleDate?.slice(0, 10) ?? ''
  if (!isYmd(ymd)) {
    return {
      lines: [],
      issues: [{ lane: null, code: 'invalid_sale_date', userId: null }],
    }
  }

  const suppressed = new Set(input.suppressedLanes ?? [])
  const producers: Record<ManagementOverlayLane, string | null> = {
    setter: input.setterProducerUserId || null,
    closer: input.closerProducerUserId || null,
  }
  const lines: ManagementOverlayLine[] = []
  const issues: ManagementOverlayResolutionIssue[] = []

  const assignmentsFor = (managerUserId: string, lane: ManagementOverlayLane) =>
    input.overlayAssignments.filter(
      (row) =>
        row.managerUserId === managerUserId && row.lane === lane && isEffective(row, ymd)
    )

  const isActiveOnSaleDate = (userId: string): boolean => {
    const latest = [...(input.userActiveHistory ?? [])]
      .filter((row) => row.userId === userId && isYmd(row.effectiveFrom) && row.effectiveFrom <= ymd)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
    return latest?.isActive !== false
  }

  for (const lane of MANAGEMENT_OVERLAY_LANES) {
    if (suppressed.has(lane)) continue
    const producerUserId = producers[lane]
    if (!producerUserId) continue

    // A deactivated manager cannot collect an own-production overlay. The new
    // architecture is direct-report only, so this also does not create a roll-up.
    if (!isActiveOnSaleDate(producerUserId)) continue

    const ownAssignments = assignmentsFor(producerUserId, lane)
    if (ownAssignments.length > 1) {
      issues.push({
        lane,
        code: 'ambiguous_overlay_assignment',
        userId: producerUserId,
      })
      continue
    }

    let recipientUserId: string
    let managerAssignmentId: string | null
    let source: ManagementOverlayLine['source']
    let overlayAssignments: EffectiveManagementOverlayAssignment[]

    if (ownAssignments.length === 1) {
      recipientUserId = producerUserId
      managerAssignmentId = null
      source = 'own_production'
      overlayAssignments = ownAssignments
    } else {
      const managerLinks = input.managerAssignments.filter(
        (row) => row.userId === producerUserId && isEffective(row, ymd)
      )
      if (managerLinks.length > 1) {
        issues.push({
          lane,
          code: 'ambiguous_manager_assignment',
          userId: producerUserId,
        })
        continue
      }
      if (managerLinks.length === 0) continue

      const managerLink = managerLinks[0]
      recipientUserId = managerLink.managerUserId
      // Direct reports only: an inactive direct manager is not paid and the lane
      // stays blank instead of walking to an unconfigured regional fallback.
      if (!isActiveOnSaleDate(recipientUserId)) continue
      managerAssignmentId = managerLink.id
      source = 'direct_report'
      overlayAssignments = assignmentsFor(recipientUserId, lane)
      if (overlayAssignments.length > 1) {
        issues.push({
          lane,
          code: 'ambiguous_overlay_assignment',
          userId: recipientUserId,
        })
        continue
      }
      if (overlayAssignments.length === 0) continue
    }

    const overlayAssignment = overlayAssignments[0]
    const eligibleVersions = input.planVersions
      .filter(
        (version) =>
          version.compPlanId === overlayAssignment.compPlanId &&
          version.lane === lane &&
          isYmd(version.effectiveFrom) &&
          version.effectiveFrom <= ymd
      )
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
    if (eligibleVersions.length === 0) continue
    if (
      eligibleVersions.length > 1 &&
      eligibleVersions[0].effectiveFrom === eligibleVersions[1].effectiveFrom
    ) {
      issues.push({ lane, code: 'ambiguous_plan_version', userId: recipientUserId })
      continue
    }

    const version = eligibleVersions[0]
    const ratePercent = Number(version.ratePercent)
    if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
      issues.push({ lane, code: 'invalid_overlay_rate', userId: recipientUserId })
      continue
    }
    // A versioned 0% is an intentional off switch, not malformed payroll data.
    if (ratePercent === 0) continue

    lines.push({
      lane,
      producerUserId,
      recipientUserId,
      ratePercent,
      overlayAssignmentId: overlayAssignment.assignmentId,
      overlayVersionId: version.versionId,
      managerAssignmentId,
      source,
    })
  }

  return { lines, issues }
}
