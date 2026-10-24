/**
 * Canonical explicit rules for weekly sales payroll, funding, comp plans,
 * payment deduplication, post-lock supplements, commission base floors,
 * participant snapshots, and row explainability.
 *
 * Downstream APIs and lock jobs should import from here — do not re-encode
 * business rules ad hoc in route handlers.
 */

import type { PaymentType } from '@/lib/types/job-payments'
import type { FundingStatus } from '@/lib/types/job-payments'
import { collectParticipants, type PayrollParticipant } from '@/lib/payroll-export'

// ── Funding status ───────────────────────────────────────────────────────────

/**
 * **Definition**
 * - `cleared`: funds count toward “fully funded” and may set `fully_funded_at`
 *   when the running cleared total crosses the funding target.
 * - `pending`: payment is recorded but does **not** count toward fully funded
 *   until explicitly moved to `cleared` (ACH in flight, check not deposited, etc.).
 *
 * **Default**
 * - New rows default to `cleared` for backward compatibility (legacy rows had no column).
 * - ACH and check **should** be inserted as `pending` when the bank has not cleared;
 *   cash/card/financing/insurance (carrier-paid) may be `cleared` per org policy.
 */
export const FUNDING_STATUS = {
  CLEARED: 'cleared' as const satisfies FundingStatus,
  PENDING: 'pending' as const satisfies FundingStatus,
}

export function countsTowardFullyFunded(fundingStatus: FundingStatus | null | undefined): boolean {
  return (fundingStatus ?? FUNDING_STATUS.CLEARED) === FUNDING_STATUS.CLEARED
}

/** Methods that typically require a pending → cleared transition (org may still override on insert). */
export const METHODS_OFTEN_PENDING_UNTIL_CLEAR = new Set(['ach', 'check'])

// ── Comp plan effective dates ────────────────────────────────────────────────

/**
 * **Rule**
 * A `user_comp_plans` row is **active on** payroll date `D` (YYYY-MM-DD) iff:
 * - `effective_from <= D`, and
 * - `effective_to` is null OR `effective_to >= D`.
 *
 * **Resolution**
 * - If multiple rows match, use the row with the **latest** `effective_from`
 *   (same as `loadActiveCompPlanForUser` in `lib/payroll-export.ts`).
 * - Payroll lock snapshots must store the **resolved** `comp_plan_id` (and version
 *   payload), not a live pointer — plans may change after lock.
 */
export function isCompPlanAssignmentEffectiveOn(
  effectiveFrom: string,
  effectiveTo: string | null | undefined,
  asOfDateYmd: string
): boolean {
  if (asOfDateYmd < effectiveFrom) return false
  if (effectiveTo != null && effectiveTo !== '' && asOfDateYmd > effectiveTo) return false
  return true
}

/** Pick best-matching assignment from an unsorted list (caller loads from DB). */
export function selectLatestEffectiveCompPlanAssignment<
  T extends { effective_from: string; effective_to?: string | null }
>(rows: T[], asOfDateYmd: string): T | null {
  const matches = rows.filter((r) => isCompPlanAssignmentEffectiveOn(r.effective_from, r.effective_to, asOfDateYmd))
  if (matches.length === 0) return null
  return matches.sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : 0))[0]
}

// ── Duplicate payment guards ───────────────────────────────────────────────────

/**
 * **Tier 1 — Idempotency (strong)**
 * If `idempotency_key` is present on insert, **reject** a second row with the same
 * `(job_id, idempotency_key)` (DB unique partial index).
 *
 * **Tier 2 — Natural key (soft / advisory)**
 * Treat as **likely duplicate** when an existing row on the same job has the same:
 * `paid_at` (calendar date string), `amount_cents`, `method`, `payer`, `payment_type`.
 * UI/API should warn or require confirmation; do not auto-reject without policy flag
 * (two legitimate checks same day are rare but possible).
 */
export function paymentNaturalKey(input: {
  paid_at: string
  amount_cents: number
  method: string
  payer: string
  payment_type: string
}): string {
  const day = input.paid_at.length >= 10 ? input.paid_at.slice(0, 10) : input.paid_at
  return [day, String(input.amount_cents), input.method, input.payer, input.payment_type].join('|')
}

export function findNaturalKeyDuplicates<
  T extends {
    paid_at: string
    amount_cents: number
    method: string
    payer: string
    payment_type: string
  }
>(existing: T[], candidate: T): T[] {
  const key = paymentNaturalKey(candidate)
  return existing.filter((p) => paymentNaturalKey(p) === key)
}

export function idempotencyKeyProvided(key: string | null | undefined): key is string {
  return typeof key === 'string' && key.trim().length > 0
}

// ── Supplements (and similar) after paid payroll ─────────────────────────────

/**
 * Payment types that represent **late carrier / supplement** flows that may land
 * after a job was already locked or paid on payroll.
 *
 * **Rule**
 * - **Never** mutate locked `payroll_job_snapshots` or paid `payroll_payout_lines`.
 * - Record the payment on the job; route financial effect to **next-period
 *   adjustment** (manual or automated adjustment row), and surface on exception
 *   / reconciliation reports.
 */
export const POST_LOCK_FUNDS_PAYMENT_TYPES: readonly PaymentType[] = ['insurance_supplement']

export function isPostLockFundsPaymentType(paymentType: PaymentType): boolean {
  return (POST_LOCK_FUNDS_PAYMENT_TYPES as readonly string[]).includes(paymentType)
}

export type PostLockFundsHandling = 'next_period_adjustment' | 'blocked_until_review'

export const POST_LOCK_SUPPLEMENT_DEFAULT: PostLockFundsHandling = 'next_period_adjustment'

// ── Negative commission base ─────────────────────────────────────────────────

/**
 * **Rule**
 * Commission math uses a **non-negative** commissionable base for pool / rate calcs:
 * - `rawBase` = formula output (contract + commissionable CO − dealer − deductible costs).
 * - If `rawBase < 0`, **clamp** to `0` for payout math; carry `was_negative: true`
 *   and the raw value in explainability so admins see margin inversion.
 *
 * Payout lines still must not go negative from chargebacks alone (separate engine).
 */
export function normalizeCommissionBaseForPayroll(rawBaseDollars: number): {
  commissionBaseDollars: number
  was_clamped: boolean
  rawBaseDollars: number
} {
  if (rawBaseDollars >= 0) {
    return { commissionBaseDollars: rawBaseDollars, was_clamped: false, rawBaseDollars: rawBaseDollars }
  }
  return { commissionBaseDollars: 0, was_clamped: true, rawBaseDollars: rawBaseDollars }
}

// ── Participant snapshots (at lock) ────────────────────────────────────────

export const PARTICIPANT_SNAPSHOT_VERSION = 'v1' as const

export type ParticipantSnapshotEntry = PayrollParticipant & {
  /** Stable display order in exports (0 = first). */
  display_order: number
}

/**
 * **Rule**
 * - Participants come from `collectParticipants(job, opportunity)` (sales_rep,
 *   setter, owner/closer); **dedupe** by `userId` already handled there.
 * - Snapshot order is deterministic: **sales_rep**, then **setter**, then **owner**
 *   (remaining roles appended alphabetically by role for forward compatibility).
 */
export function buildParticipantSnapshot(
  job: { salesperson_id?: string | null },
  opportunity: { owner_user_id?: string | null; setter_user_id?: string | null } | null
): { version: typeof PARTICIPANT_SNAPSHOT_VERSION; participants: ParticipantSnapshotEntry[] } {
  const raw = collectParticipants(job, opportunity)
  const orderRank: Record<string, number> = { sales_rep: 0, setter: 1, owner: 2 }
  const sorted = [...raw].sort((a, b) => {
    const ra = orderRank[a.role] ?? 99
    const rb = orderRank[b.role] ?? 99
    if (ra !== rb) return ra - rb
    return a.userId.localeCompare(b.userId)
  })
  const participants: ParticipantSnapshotEntry[] = sorted.map((p, i) => ({
    ...p,
    display_order: i,
  }))
  return { version: PARTICIPANT_SNAPSHOT_VERSION, participants }
}

// ── Row explainability ───────────────────────────────────────────────────────

export type ExplainCode =
  | 'FUNDING_PENDING_EXCLUDED'
  | 'FUNDING_CLEARED_INCLUDED'
  | 'COMP_PLAN_EFFECTIVE'
  | 'DUPLICATE_NATURAL_KEY'
  | 'POST_LOCK_SUPPLEMENT'
  | 'COMMISSION_BASE_CLAMPED'
  | 'PARTICIPANT_ORDER'

export type PayrollExplainSegment = {
  code: ExplainCode
  message: string
}

export function explainFundingStatus(fs: FundingStatus | null | undefined): PayrollExplainSegment {
  if (countsTowardFullyFunded(fs)) {
    return {
      code: 'FUNDING_CLEARED_INCLUDED',
      message: 'Payment counts toward fully funded (funding_status is cleared or legacy default).',
    }
  }
  return {
    code: 'FUNDING_PENDING_EXCLUDED',
    message: 'Payment does not count toward fully funded until marked cleared (e.g. ACH/check pending).',
  }
}

export function explainNegativeBaseClamp(rawBase: number): PayrollExplainSegment[] {
  const n = normalizeCommissionBaseForPayroll(rawBase)
  if (!n.was_clamped) return []
  return [
    {
      code: 'COMMISSION_BASE_CLAMPED',
      message: `Commissionable base was negative (${n.rawBaseDollars.toFixed(2)}); clamped to 0.00 for payroll math.`,
    },
  ]
}

export function explainParticipantSnapshot(participants: ParticipantSnapshotEntry[]): PayrollExplainSegment {
  const order = participants.map((p) => `${p.role}:${p.userId}`).join(' → ')
  return {
    code: 'PARTICIPANT_ORDER',
    message: `Participant snapshot (${PARTICIPANT_SNAPSHOT_VERSION}): ${order}`,
  }
}

export function formatExplainSummary(segments: PayrollExplainSegment[]): string {
  return segments.map((s) => s.message).join(' ')
}
