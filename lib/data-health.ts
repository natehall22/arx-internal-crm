/**
 * Data health — the daily "Needs you" list.
 *
 * One function answers "which jobs have missing or conflicting inputs", and the
 * same answer feeds three places: the ops dashboard list, the morning-update
 * email, and {@link isJobPayable} (payroll's gate — Nathan, 2026-10-21: "payroll
 * will not pay a job until it's fixed"). Do not re-derive any of these rules
 * elsewhere; call this.
 *
 * Rules (owner decisions, BUILD-BRIEF 2026-10-21):
 * - Commission base = signed sale agreement total + signed commissionable change
 *   orders. Missing, or off by more than $0.05, is a problem.
 * - "Collected" must agree with recorded payments vs contract + change orders,
 *   within $0.05. A collected job that is short counts only when it was forced
 *   through (an explicit force column if one exists — see {@link isCollectedForced}).
 * - Sale credit: a closer, and a setter unless the deal is self-generated.
 * - A complete/collected job needs at least one cost line (job_cost_lines is the
 *   one cost ledger).
 * - Ops: materials not ordered within N days of install, a permit still pending
 *   at install, every crew done but the job not marked complete.
 * - Past appointments with no outcome.
 *
 * Read-only. Never writes.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { addDaysToDateOnly } from '@/lib/install-calendar'
import { ymdInBusinessTz } from '@/lib/calendar-business-tz'
import { SALE_AGREEMENT_TYPES } from '@/lib/sales-metrics'
import { loadPayPlanGaps, type PayPlanGap } from '@/lib/comp-plan-defaults-db'

/** Paid-in-full tolerance (owner decision #2). */
export const PAID_TOLERANCE_CENTS = 5
/** Base-vs-sale tolerance, same $0.05. */
export const MONEY_TOLERANCE = 0.05
/** Materials should be ordered at least this many days before the crew's first day. */
export const MATERIALS_LEAD_DAYS = 3
/** An appointment needs an outcome this long after it was due to end. */
export const APPOINTMENT_OUTCOME_GRACE_HOURS = 2

export type HealthArea = 'money' | 'credit' | 'ops' | 'sales'

export type HealthProblemCode =
  | 'no_signed_contract'
  | 'missing_commission_base'
  | 'commission_base_mismatch'
  | 'sale_amount_mismatch'
  | 'collected_but_short'
  | 'paid_not_marked_collected'
  | 'no_deal_linked'
  | 'no_closer'
  | 'no_setter'
  | 'self_gen_setter_conflict'
  | 'completed_no_costs'
  | 'not_installed'
  | 'materials_not_ordered'
  | 'permit_pending'
  | 'crews_done_job_open'
  | 'appointment_no_outcome'

export type HealthProblem = {
  code: HealthProblemCode
  area: HealthArea
  /** Plain English, one line, no jargon. */
  message: string
  fixLabel: string
  fixHref: string
  /** True when payroll must not pay the job until this is fixed. */
  blocksPay: boolean
}

export type JobHealth = {
  kind: 'job'
  jobId: string
  jobNumber: string
  status: string
  addressText: string | null
  problems: HealthProblem[]
}

export type AppointmentHealth = {
  kind: 'appointment'
  appointmentId: string
  scheduledFor: string
  appointmentType: string
  addressText: string | null
  problems: HealthProblem[]
}

export type DataHealthReport = {
  generatedAt: string
  jobs: JobHealth[]
  appointments: AppointmentHealth[]
  /**
   * People who would be paid nothing for lack of a pay plan, one row per role (money). Not tied to a job.
   * Optional so older report builders stay valid.
   */
  payPlans?: PayPlanGap[]
  /** Total problem rows (jobs with ≥1 problem + appointments + pay-plan gaps). */
  count: number
}

/* ------------------------------------------------------------------------ *
 * Pure rules
 * ------------------------------------------------------------------------ */

export type HealthJobRow = {
  id: string
  job_number: string
  status: string
  address_text?: string | null
  sale_amount?: number | string | null
  commission_comp_base?: number | string | null
  salesperson_id?: string | null
  scheduled_date?: string | null
  materials_status?: string | null
  permit_required?: boolean | null
  permit_status?: string | null
  allow_close_with_balance?: boolean | null
  close_balance_reason?: string | null
  /** Any other column — read defensively for force flags that may not exist yet. */
  [key: string]: unknown
}

export type HealthDealRow = {
  owner_user_id?: string | null
  setter_user_id?: string | null
  is_self_generated?: boolean | null
}

export type JobHealthInput = {
  job: HealthJobRow
  /** Sum of the job's completed sale agreements (installation/repair), or null when none. */
  contractTotal: number | null
  /** Σ (updated_total − original_amount) over the job's completed change orders. */
  changeOrderDelta: number
  /** Same, commissionable change orders only. */
  commissionableChangeOrderDelta: number
  /** Cleared payments, cents (refunds negative). */
  paidCents: number
  costLineCount: number
  deal: HealthDealRow | null
  trades: { status: string }[]
  todayYmd: string
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function money(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

const FORCE_KEY = /(^|_)force(d)?(_|$)/

/**
 * Was "collected" forced through with a balance? Honors, in order:
 * - any `*force*` / `*forced*` column on the job that is set (the super-admin
 *   force the money-inputs work adds — read defensively so this works before
 *   and after that migration), and
 * - the "close with balance" acknowledgement: after the money-inputs migration
 *   only when a super admin stamped it (`close_balance_by`); before it, only
 *   when it carries a written reason (a bare checkbox with no reason is not a decision anyone can
 *   audit; 6 live jobs have exactly that).
 */
export function isCollectedForced(job: HealthJobRow): boolean {
  for (const [key, value] of Object.entries(job)) {
    if (!FORCE_KEY.test(key)) continue
    if (value === true) return true
    if (typeof value === 'string' && value.trim().length > 0 && value !== 'false') return true
  }
  if (!job.allow_close_with_balance) return false
  // Once the money-inputs migration adds `close_balance_by` (set only by a super admin via
  // force-paid), that is the ONLY thing that counts — a legacy checkbox without it does not.
  if (Object.prototype.hasOwnProperty.call(job, 'close_balance_by')) {
    return typeof job.close_balance_by === 'string' && job.close_balance_by.length > 0
  }
  // Before that migration: the old acknowledgement counts only with a written reason.
  return String(job.close_balance_reason ?? '').trim().length > 0
}

/** What the customer owes: signed agreement + signed change orders, else the job's sale amount. */
export function expectedSaleAmount(input: Pick<JobHealthInput, 'contractTotal' | 'changeOrderDelta' | 'job'>): number | null {
  if (input.contractTotal != null) return round2(input.contractTotal + input.changeOrderDelta)
  return num(input.job.sale_amount)
}

/** Owner decision #1: base = signed agreement + signed commissionable change orders. */
export function expectedCommissionBase(
  input: Pick<JobHealthInput, 'contractTotal' | 'commissionableChangeOrderDelta'>
): number | null {
  if (input.contractTotal == null) return null
  return round2(input.contractTotal + input.commissionableChangeOrderDelta)
}

const INSTALLED_STATUSES = new Set(['complete', 'collected'])
const PRE_INSTALL_STATUSES = new Set(['sold', 'materials', 'scheduled'])

export function jobHref(jobId: string, hash?: string): string {
  return `/ops/jobs/${jobId}${hash ? `#${hash}` : ''}`
}

export function evaluateJobHealth(input: JobHealthInput): HealthProblem[] {
  const { job } = input
  if (job.status === 'cancelled') return []
  const problems: HealthProblem[] = []
  const href = jobHref(job.id)
  const installed = INSTALLED_STATUSES.has(job.status)

  // ── Money ──────────────────────────────────────────────────────────────
  if (input.contractTotal == null) {
    problems.push({
      code: 'no_signed_contract',
      area: 'money',
      message: 'No signed sale agreement is linked to this job.',
      fixLabel: 'Open job',
      fixHref: href,
      blocksPay: true,
    })
  }

  const base = num(job.commission_comp_base)
  const expectedBase = expectedCommissionBase(input)
  if (base == null || base <= 0) {
    problems.push({
      code: 'missing_commission_base',
      area: 'money',
      message:
        expectedBase != null
          ? `Commission base is blank. It should be ${money(expectedBase)} (agreement + change orders).`
          : 'Commission base is blank.',
      fixLabel: 'Open job',
      fixHref: href,
      blocksPay: true,
    })
  } else if (expectedBase != null && Math.abs(base - expectedBase) > MONEY_TOLERANCE) {
    problems.push({
      code: 'commission_base_mismatch',
      area: 'money',
      message: `Commission base is ${money(base)} but the agreement + change orders come to ${money(expectedBase)}.`,
      fixLabel: 'Open job',
      fixHref: href,
      blocksPay: true,
    })
  }

  const sale = num(job.sale_amount)
  const owed = expectedSaleAmount(input)
  if (input.contractTotal != null && owed != null && (sale == null || Math.abs(sale - owed) > MONEY_TOLERANCE)) {
    problems.push({
      code: 'sale_amount_mismatch',
      area: 'money',
      message: `Sale amount is ${sale == null ? 'blank' : money(sale)} but the agreement + change orders come to ${money(owed)}.`,
      fixLabel: 'Open job',
      fixHref: href,
      blocksPay: true,
    })
  }

  if (owed != null && owed > 0) {
    const owedCents = Math.round(owed * 100)
    const shortCents = owedCents - input.paidCents
    const paidInFull = shortCents <= PAID_TOLERANCE_CENTS
    if (job.status === 'collected' && !paidInFull && !isCollectedForced(job)) {
      problems.push({
        code: 'collected_but_short',
        area: 'money',
        message: `Marked collected, but payments are ${money(shortCents / 100)} short.`,
        fixLabel: 'Record payment',
        fixHref: jobHref(job.id, 'payments-section'),
        blocksPay: true,
      })
    } else if (job.status === 'complete' && paidInFull) {
      problems.push({
        code: 'paid_not_marked_collected',
        area: 'money',
        message: 'Paid in full but not marked collected.',
        fixLabel: 'Mark collected',
        fixHref: href,
        blocksPay: false,
      })
    }
  }

  if (installed && input.costLineCount === 0) {
    problems.push({
      code: 'completed_no_costs',
      area: 'money',
      message: 'Job is done but has no costs entered (labor, materials).',
      fixLabel: 'Add costs',
      fixHref: jobHref(job.id, 'job-files-workspace-section'),
      blocksPay: true,
    })
  }

  // ── Sale credit ────────────────────────────────────────────────────────
  const deal = input.deal
  if (!deal) {
    problems.push({
      code: 'no_deal_linked',
      area: 'credit',
      message: "No deal is linked, so sale credit (setter / closer) can't be confirmed.",
      fixLabel: 'Open job',
      fixHref: href,
      blocksPay: true,
    })
  } else {
    if (!job.salesperson_id && !deal.owner_user_id) {
      problems.push({
        code: 'no_closer',
        area: 'credit',
        message: 'No closer is credited on this sale.',
        fixLabel: 'Fix sale credit',
        fixHref: jobHref(job.id, 'payroll-attribution-section'),
        blocksPay: true,
      })
    }
    if (deal.is_self_generated === true) {
      if (deal.setter_user_id && deal.setter_user_id !== deal.owner_user_id) {
        problems.push({
          code: 'self_gen_setter_conflict',
          area: 'credit',
          message: 'Marked self-generated but also has a different setter.',
          fixLabel: 'Fix sale credit',
          fixHref: jobHref(job.id, 'payroll-attribution-section'),
          blocksPay: true,
        })
      }
    } else if (!deal.setter_user_id) {
      problems.push({
        code: 'no_setter',
        area: 'credit',
        message: 'No setter is credited (and the deal is not marked self-generated).',
        fixLabel: 'Fix sale credit',
        fixHref: jobHref(job.id, 'payroll-attribution-section'),
        blocksPay: true,
      })
    }
  }

  // ── Ops ────────────────────────────────────────────────────────────────
  const scheduled = typeof job.scheduled_date === 'string' ? job.scheduled_date : null
  const soonCutoff = addDaysToDateOnly(input.todayYmd, MATERIALS_LEAD_DAYS)
  if (
    PRE_INSTALL_STATUSES.has(job.status) &&
    scheduled &&
    scheduled <= soonCutoff &&
    (job.materials_status || 'not_ordered') === 'not_ordered'
  ) {
    problems.push({
      code: 'materials_not_ordered',
      area: 'ops',
      message: `Crew starts ${scheduled} and materials aren't marked ordered.`,
      fixLabel: 'Mark materials ordered',
      fixHref: href,
      blocksPay: false,
    })
  }
  if (
    PRE_INSTALL_STATUSES.has(job.status) &&
    scheduled &&
    scheduled <= soonCutoff &&
    job.permit_required &&
    job.permit_status !== 'approved'
  ) {
    problems.push({
      code: 'permit_pending',
      area: 'ops',
      message: `Crew starts ${scheduled} and the permit isn't approved yet.`,
      fixLabel: 'Update permit',
      fixHref: href,
      blocksPay: false,
    })
  }
  const activeTrades = input.trades.filter((t) => t.status !== 'cancelled')
  if (
    (job.status === 'in_progress' || job.status === 'scheduled') &&
    activeTrades.length > 0 &&
    activeTrades.every((t) => t.status === 'completed')
  ) {
    problems.push({
      code: 'crews_done_job_open',
      area: 'ops',
      message: 'Every crew is done (photos in) but the job is not marked complete.',
      fixLabel: 'Mark job complete',
      fixHref: href,
      blocksPay: false,
    })
  }

  return problems
}

export type HealthAppointmentRow = {
  id: string
  status: string
  scheduled_for: string
  duration_minutes?: number | null
  appointment_type?: string | null
  lead_id?: string | null
  opportunity_id?: string | null
  address_text?: string | null
}

/** Pure: is this appointment past due for an outcome? */
export function appointmentNeedsOutcome(appt: HealthAppointmentRow, now: Date): boolean {
  if (appt.status !== 'scheduled') return false
  const start = Date.parse(appt.scheduled_for)
  if (!Number.isFinite(start)) return false
  const durationMs = Math.max(0, Number(appt.duration_minutes) || 60) * 60_000
  return start + durationMs + APPOINTMENT_OUTCOME_GRACE_HOURS * 3_600_000 < now.getTime()
}

/** Where the outcome for this appointment is logged today (one tap from the list). */
export function appointmentOutcomeHref(appt: HealthAppointmentRow): string {
  const type = appt.appointment_type || 'inspection'
  if (type === 'inspection') {
    const params = new URLSearchParams({ id: appt.id })
    if (appt.lead_id) params.set('lead_id', appt.lead_id)
    return `/appointments/feedback?${params.toString()}`
  }
  if (appt.opportunity_id) return `/opportunities/${appt.opportunity_id}`
  if (appt.lead_id) return `/leads/${appt.lead_id}`
  return `/appointments/feedback?id=${encodeURIComponent(appt.id)}`
}

const APPOINTMENT_TYPE_LABELS: Record<string, string> = {
  inspection: 'Inspection',
  close: 'Close',
  insurance_call: 'Insurance call',
  insurance_follow_up: 'Insurance follow-up',
}

export function appointmentTypeLabel(type: string | null | undefined): string {
  const t = type || 'inspection'
  return APPOINTMENT_TYPE_LABELS[t] ?? t.replace(/_/g, ' ')
}

export function evaluateAppointmentHealth(appt: HealthAppointmentRow, now: Date): HealthProblem[] {
  if (!appointmentNeedsOutcome(appt, now)) return []
  return [
    {
      code: 'appointment_no_outcome',
      area: 'sales',
      message: `${appointmentTypeLabel(appt.appointment_type)} on ${ymdInBusinessTz(new Date(appt.scheduled_for))} has no outcome.`,
      fixLabel: 'Log outcome',
      fixHref: appointmentOutcomeHref(appt),
      blocksPay: false,
    },
  ]
}

/** Problems that stop payroll, plus "not installed" — payroll's own floor. */
export function payabilityFromProblems(
  job: Pick<HealthJobRow, 'status'>,
  problems: HealthProblem[]
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (job.status === 'cancelled') reasons.push('Job is cancelled.')
  else if (!INSTALLED_STATUSES.has(job.status)) reasons.push("Job isn't marked complete yet.")
  for (const p of problems) if (p.blocksPay) reasons.push(p.message)
  return { ok: reasons.length === 0, reasons }
}

/* ------------------------------------------------------------------------ *
 * Loader
 * ------------------------------------------------------------------------ */

const PAGE = 1000
const IN_CHUNK = 200

async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data as T[] | null) ?? []
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

async function selectIn<T>(
  ids: string[],
  build: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await build(ids.slice(i, i + IN_CHUNK))
    if (error) throw new Error(error.message)
    out.push(...(((data as T[] | null) ?? []) as T[]))
  }
  return out
}

type ContractRow = { opportunity_id: string | null; proposal_id: string | null; project_cost: number | string | null }

/**
 * Batch form of the job → signed-contract lookup in `findJobSignedContracts`
 * (lib/job-contract.ts): the job's proposal first, then its deal; `completed`
 * sale agreements only. Kept in step with that function's precedence.
 */
export function contractTotalForJob(
  ids: { proposalId: string | null; opportunityId: string | null },
  byProposal: Map<string, ContractRow[]>,
  byOpportunity: Map<string, ContractRow[]>
): number | null {
  const rows =
    (ids.proposalId ? byProposal.get(ids.proposalId) : undefined) ??
    (ids.opportunityId ? byOpportunity.get(ids.opportunityId) : undefined)
  if (!rows || rows.length === 0) return null
  return round2(rows.reduce((sum, r) => sum + (num(r.project_cost) ?? 0), 0))
}

function groupBy<T>(rows: T[], key: (row: T) => string | null | undefined): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    if (!k) continue
    const list = map.get(k) ?? []
    list.push(row)
    map.set(k, list)
  }
  return map
}

export async function loadDataHealth(
  admin: SupabaseClient,
  orgId: string,
  opts: { now?: Date; jobIds?: string[]; includeAppointments?: boolean } = {}
): Promise<DataHealthReport> {
  const now = opts.now ?? new Date()
  const todayYmd = ymdInBusinessTz(now)
  const includeAppointments = opts.includeAppointments ?? !opts.jobIds

  // `*` on purpose: force columns from the money-inputs work may or may not exist yet.
  const jobs = opts.jobIds
    ? await selectIn<HealthJobRow>(opts.jobIds, (chunk) =>
        admin.from('production_jobs').select('*').eq('org_id', orgId).in('id', chunk)
      )
    : await selectAll<HealthJobRow>((from, to) =>
        admin
          .from('production_jobs')
          .select('*')
          .eq('org_id', orgId)
          .neq('status', 'cancelled')
          .order('job_number', { ascending: true })
          .range(from, to)
      )

  const jobIds = jobs.map((j) => j.id)
  const projectIds = Array.from(new Set(jobs.map((j) => j.project_id).filter((v): v is string => typeof v === 'string')))

  const [projects, contracts, changeOrders, payments, costLines, trades] = await Promise.all([
    selectIn<{ id: string; opportunity_id: string | null }>(projectIds, (chunk) =>
      admin.from('projects').select('id, opportunity_id').eq('org_id', orgId).in('id', chunk)
    ),
    selectAll<ContractRow>((from, to) =>
      admin
        .from('order_form_contracts')
        .select('opportunity_id, proposal_id, project_cost')
        .eq('org_id', orgId)
        .eq('status', 'completed')
        .in('agreement_type', [...SALE_AGREEMENT_TYPES])
        .range(from, to)
    ),
    selectIn<{ job_id: string; original_amount: number | string; updated_total: number | string; is_commissionable: boolean | null }>(
      jobIds,
      (chunk) =>
        admin
          .from('job_change_orders')
          .select('job_id, original_amount, updated_total, is_commissionable')
          .eq('org_id', orgId)
          .eq('status', 'completed')
          .in('job_id', chunk)
    ),
    selectIn<{ job_id: string; amount_cents: number; funding_status: string | null }>(jobIds, (chunk) =>
      admin.from('job_payments').select('job_id, amount_cents, funding_status').in('job_id', chunk)
    ),
    selectIn<{ job_id: string }>(jobIds, (chunk) =>
      admin.from('job_cost_lines').select('job_id').eq('org_id', orgId).is('deleted_at', null).in('job_id', chunk)
    ),
    selectIn<{ job_id: string; status: string }>(jobIds, (chunk) =>
      admin
        .from('work_orders')
        .select('job_id, status')
        .eq('org_id', orgId)
        .not('trade', 'is', null)
        .in('job_id', chunk)
    ),
  ])

  const oppByProject = new Map(projects.map((p) => [p.id, p.opportunity_id]))
  const opportunityIds = Array.from(
    new Set(projects.map((p) => p.opportunity_id).filter((v): v is string => Boolean(v)))
  )
  const deals = await selectIn<HealthDealRow & { id: string }>(opportunityIds, (chunk) =>
    admin
      .from('opportunities')
      .select('id, owner_user_id, setter_user_id, is_self_generated')
      .eq('org_id', orgId)
      .in('id', chunk)
  )
  const dealById = new Map(deals.map((d) => [d.id, d]))

  const contractsByProposal = groupBy(contracts, (c) => c.proposal_id)
  const contractsByOpportunity = groupBy(contracts, (c) => c.opportunity_id)
  const cosByJob = groupBy(changeOrders, (c) => c.job_id)
  const paymentsByJob = groupBy(payments, (p) => p.job_id)
  const costCountByJob = new Map<string, number>()
  for (const line of costLines) costCountByJob.set(line.job_id, (costCountByJob.get(line.job_id) ?? 0) + 1)
  const tradesByJob = groupBy(trades, (t) => t.job_id)

  const jobHealth: JobHealth[] = []
  for (const job of jobs) {
    const opportunityId = typeof job.project_id === 'string' ? oppByProject.get(job.project_id) ?? null : null
    const proposalId =
      (typeof job.linked_proposal_id === 'string' && job.linked_proposal_id) ||
      (typeof job.accepted_proposal_id === 'string' && job.accepted_proposal_id) ||
      null
    const cos = cosByJob.get(job.id) ?? []
    const delta = (c: { original_amount: number | string; updated_total: number | string }) =>
      (num(c.updated_total) ?? 0) - (num(c.original_amount) ?? 0)
    const problems = evaluateJobHealth({
      job,
      contractTotal: contractTotalForJob({ proposalId, opportunityId }, contractsByProposal, contractsByOpportunity),
      changeOrderDelta: round2(cos.reduce((s, c) => s + delta(c), 0)),
      commissionableChangeOrderDelta: round2(cos.filter((c) => c.is_commissionable !== false).reduce((s, c) => s + delta(c), 0)),
      paidCents: (paymentsByJob.get(job.id) ?? [])
        // Same rule as the collected logic (lib/job-collection.ts on money-inputs): pending money doesn't count.
        .filter((p) => p.funding_status !== 'pending')
        .reduce((s, p) => s + (Number(p.amount_cents) || 0), 0),
      costLineCount: costCountByJob.get(job.id) ?? 0,
      deal: opportunityId ? dealById.get(opportunityId) ?? null : null,
      trades: tradesByJob.get(job.id) ?? [],
      todayYmd,
    })
    jobHealth.push({
      kind: 'job',
      jobId: job.id,
      jobNumber: job.job_number,
      status: job.status,
      addressText: job.address_text ?? null,
      problems,
    })
  }

  let appointmentHealth: AppointmentHealth[] = []
  if (includeAppointments) {
    const cutoffIso = new Date(now.getTime() - APPOINTMENT_OUTCOME_GRACE_HOURS * 3_600_000).toISOString()
    const appts = await selectAll<HealthAppointmentRow>((from, to) =>
      admin
        .from('scheduled_appointments')
        .select('id, status, scheduled_for, duration_minutes, appointment_type, lead_id, opportunity_id, address_text')
        .eq('org_id', orgId)
        .eq('status', 'scheduled')
        .lt('scheduled_for', cutoffIso)
        .order('scheduled_for', { ascending: false })
        .range(from, to)
    )
    appointmentHealth = appts
      .map((a) => ({
        kind: 'appointment' as const,
        appointmentId: a.id,
        scheduledFor: a.scheduled_for,
        appointmentType: a.appointment_type || 'inspection',
        addressText: a.address_text ?? null,
        problems: evaluateAppointmentHealth(a, now),
      }))
      .filter((a) => a.problems.length > 0)
  }

  const flaggedJobs = jobHealth.filter((j) => j.problems.length > 0)
  // Org-level check, only on the full report (not the single-job payability gate).
  const payPlans = opts.jobIds ? [] : await loadPayPlanGaps(admin, orgId, now)
  return {
    generatedAt: now.toISOString(),
    jobs: flaggedJobs,
    appointments: appointmentHealth,
    payPlans,
    count: flaggedJobs.length + appointmentHealth.length + payPlans.length,
  }
}

/**
 * Payroll's gate. `ok` only when the job is installed and has no problem that
 * blocks pay. Not wired into payroll yet (deliberately — see the status-paths
 * README); payroll calls this when it is.
 */
export async function isJobPayable(
  admin: SupabaseClient,
  jobId: string,
  opts: { orgId?: string; now?: Date } = {}
): Promise<{ ok: boolean; reasons: string[] }> {
  let orgId = opts.orgId
  const { data: job } = await admin
    .from('production_jobs')
    .select('id, org_id, status')
    .eq('id', jobId)
    .maybeSingle()
  if (!job || (orgId && job.org_id !== orgId)) return { ok: false, reasons: ['Job not found.'] }
  orgId = job.org_id as string
  const report = await loadDataHealth(admin, orgId, { jobIds: [jobId], now: opts.now, includeAppointments: false })
  const found = report.jobs.find((j) => j.jobId === jobId)
  return payabilityFromProblems({ status: job.status as string }, found?.problems ?? [])
}

/* ------------------------------------------------------------------------ *
 * Display helpers (shared by the dashboard list and the email)
 * ------------------------------------------------------------------------ */

/** Areas a viewer may see. Money/credit rows are for payroll admins only. */
export function filterReportForViewer(report: DataHealthReport, canSeeMoney: boolean): DataHealthReport {
  if (canSeeMoney) return report
  const jobs = report.jobs
    .map((j) => ({ ...j, problems: j.problems.filter((p) => p.area === 'ops' || p.area === 'sales') }))
    .filter((j) => j.problems.length > 0)
  return { ...report, jobs, payPlans: [], count: jobs.length + report.appointments.length }
}
