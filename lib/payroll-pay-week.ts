/**
 * "Pay this week": everything the screen shows, from the one payroll calculation.
 *  - draft  : `planPayrollPeriod` (lib/payroll-period-materialization.ts) — the same function Approve runs
 *  - approved: the stored payout lines of the locked period
 * Both are composed by `composeWeek`, so the people list, the by-job view, the totals and the CSV cannot disagree.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { computePeriodUnitEarningsForUser, loadStoredUnitEarnings, resolvePayrollPeriodWindow, type PeriodUnitEarningsResult, type UnitEarnings } from '@/lib/comp-plan-period-unit-earnings'
import { compPlanRoleLabel } from '@/lib/comp-plan-roles'
import { loadEndedPlanPeople, loadPayPlanGaps } from '@/lib/comp-plan-defaults-db'
import { roundMoney } from '@/lib/money'
import { loadPeriodAdjustments, type PayrollAdjustment } from '@/lib/payroll-adjustments'
import { loadOpenDisputes } from '@/lib/payroll-disputes'
import { loadHourlyRoster, loadPlanForWeek, loadWeekPeople, type HourlyRosterRow } from '@/lib/payroll-hours'
import { planPayrollPeriod, type PlannedPayoutRow, type WaitingJob } from '@/lib/payroll-period-materialization'
import { computeNetPayout } from '@/lib/payroll-statement'
import { addEasternDays, cutoffYmdEt, getLastWeeklyPayrollCutoffEtAtOrBefore, weekStartYmd, weeklyPayrollPayDateForCutoff, ymdEt } from '@/lib/weekly-payroll/cutoff'

/** A single line over this amount is flagged above the Approve button. */
export const BIG_LINE_THRESHOLD = 3000

export type PayWeekPeriod = {
  id: string
  label: string
  cutoffAt: string
  payDate: string
  status: string
  /** Per-unit pay was stored when this week was approved: read it, never recalculate. */
  unitsFrozen: boolean
  /** First day of the week this run pays (Eastern, YYYY-MM-DD). */
  weekStart: string
  weekEnding: string
}

export type PayWeekLine = {
  kind: 'Commission' | 'Hourly' | 'Units' | 'Bonus' | 'Adjustment'
  what: string
  math: string
  amount: number
  jobId?: string
  jobNumber?: string
  /** Payout role of a commission line (for "Change"): setter, sales_rep, inspector… */
  participantRole?: string
  /** Set on 'Adjustment' lines so a fix on an open week can be removed. */
  adjustmentId?: string
}

export type PayWeekPerson = {
  userId: string
  name: string
  roleLabel: string
  /** What they are paid (never below $0). */
  total: number
  /** Sum of their lines before the $0 floor. */
  raw: number
  hoursMissing: boolean
  lines: PayWeekLine[]
}

export type PayWeekJobView = {
  jobId: string
  jobNumber: string
  address: string
  commissionBase: number
  total: number
  paid: Array<{ userId: string; name: string; roleLabel: string; amount: number; math: string }>
}

export type PayWeekWaiting = {
  jobId: string
  jobNumber: string
  address: string
  reason: string
  /** What each credited person will get once it clears (estimates from the same engine). */
  who: Array<{ name: string; roleLabel: string; estimate: number }>
}

export type PayWeekNeed =
  | { kind: 'hours'; userId: string; name: string; rate: number }
  | { kind: 'bonus'; id: string; userId: string; name: string; amount: number; what: string; /** Set when the bonus is stuck on an earlier, already-approved week. */ fromWeek?: string }
  | { kind: 'plans'; text: string; names: string[]; href: string }
  | { kind: 'conflict'; text: string; jobNumbers: string[] }
  | { kind: 'dispute'; id: string; userId: string; name: string; label: string; message: string }

export type PayWeekWarning = { code: string; text: string }

export type PayWeek = {
  period: PayWeekPeriod
  state: 'draft' | 'approved'
  totals: { amount: number; people: number }
  /**
   * Calculated on the server: true when Approve has something to DO — jobs to snapshot or negative balances to carry — even if the
   * payable total is $0. The screen enables Approve from this, never from `total > 0`.
   */
  canApprove: boolean
  needs: PayWeekNeed[]
  warnings: PayWeekWarning[]
  /** Jobs that finished before this week and are paid for the first time here (shown in the Approve confirmation). */
  backlog: { jobs: number; amount: number; since: string }
  people: PayWeekPerson[]
  jobs: PayWeekJobView[]
  waiting: PayWeekWaiting[]
  /** Other weeks, newest first, for the "Earlier weeks" picker. */
  earlier: Array<{ id: string; weekEnding: string; payDate: string; status: string }>
  /** Fixes already queued on the week after this one (shown when this week is approved). */
  /** Everyone active, for the "Fix a mistake" picker. */
  directory: Array<{ id: string; name: string }>
  nextWeek: { periodId: string; weekEnding: string; payDate: string; fixes: Array<{ id: string; name: string; amount: number; reason: string }> } | null
}

const ROLE_WORDS: Record<string, string> = {
  sales_rep: 'closer',
  owner: 'closer',
  setter: 'setter',
  inspector: 'inspection',
  self_gen: 'self-generated lead',
  setter_manager_override: 'setter manager override',
  closer_manager_override: 'sales manager override',
  field_manager: 'manager override',
  senior_manager: 'manager override',
  custom: 'custom line',
}
export const payoutRoleWord = (role: string) => ROLE_WORDS[role] ?? role.replace(/_/g, ' ')

/** A real UUID (8-4-4-4-12 hex), not just 36 hex-or-dash characters. */
export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

const fmtMoney = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`

/** "$20,000 × 7% closer = $1,400", with the reason when the pool cap or an office override changed it. Pure. */
export function describeCommission(row: Pick<PlannedPayoutRow, 'participant_role' | 'gross_amount' | 'net_amount' | 'comp_plan_snapshot'>, base: number | null): string {
  const word = payoutRoleWord(row.participant_role)
  const snap = (row.comp_plan_snapshot ?? {}) as { source?: string; note?: string; basis?: string; override_amount?: number | null }
  const net = Number(row.net_amount) || 0
  const gross = Number(row.gross_amount) || 0
  if (snap.source === 'deal_commission_roles_producer_override') return `Set by the office on this job (${word}) = ${fmtMoney(net)}`
  if (!base || base <= 0) return `${word} = ${fmtMoney(net)}`
  const rate = Math.round((gross / base) * 10000) / 100
  const capped = Math.abs(net - gross) >= 0.01
  const flat = snap.basis === 'flat'
  const head = flat ? `${fmtMoney(gross)} flat ${word}` : `${fmtMoney(base)} × ${rate}% ${word}`
  return capped ? `${head} = ${fmtMoney(gross)}, reduced to ${fmtMoney(net)} to stay inside the 18% pool` : `${head} = ${fmtMoney(net)}`
}

type JobInfo = { id: string; job_number: string; address_text: string | null; commission_comp_base: number | null }

export type WeekInputs = {
  rows: Array<Pick<PlannedPayoutRow, 'job_id' | 'user_id' | 'participant_role' | 'gross_amount' | 'net_amount' | 'comp_plan_snapshot'>>
  jobs: Map<string, JobInfo>
  names: Map<string, { name: string; role: string }>
  hours: HourlyRosterRow[]
  units: Map<string, number>
  bonuses: Array<{ id: string; userId: string; amount: number; description: string | null; bonusType: string }>
  adjustments?: PayrollAdjustment[]
}

/** Turns rows + hours + units + bonuses into the people list and the by-job view. Pure. */
export function composeWeek(inp: WeekInputs): { people: PayWeekPerson[]; jobs: PayWeekJobView[] } {
  const person = (id: string): PayWeekPerson => {
    let p = byUser.get(id)
    if (!p) {
      const n = inp.names.get(id)
      p = { userId: id, name: n?.name ?? 'Unknown', roleLabel: n?.role ? compPlanRoleLabel(n.role) : '', total: 0, raw: 0, hoursMissing: false, lines: [] }
      byUser.set(id, p)
    }
    return p
  }
  const byUser = new Map<string, PayWeekPerson>()
  const byJob = new Map<string, PayWeekJobView>()

  for (const r of inp.rows) {
    const job = inp.jobs.get(r.job_id)
    const base = job?.commission_comp_base != null ? Number(job.commission_comp_base) : null
    const amount = roundMoney(Number(r.net_amount) || 0)
    const math = describeCommission(r, base)
    const p = person(r.user_id)
    p.lines.push({ kind: 'Commission', what: `${job?.job_number ?? ''}${job?.address_text ? ` · ${job.address_text}` : ''}`.trim(), math, amount, jobId: r.job_id, jobNumber: job?.job_number, participantRole: r.participant_role })
    let jv = byJob.get(r.job_id)
    if (!jv) {
      jv = { jobId: r.job_id, jobNumber: job?.job_number ?? '', address: job?.address_text ?? '', commissionBase: base ?? 0, total: 0, paid: [] }
      byJob.set(r.job_id, jv)
    }
    jv.paid.push({ userId: r.user_id, name: p.name, roleLabel: payoutRoleWord(r.participant_role), amount, math })
    jv.total = roundMoney(jv.total + amount)
  }
  for (const h of inp.hours) {
    const p = person(h.user_id)
    if (!h.has_entry) {
      p.hoursMissing = true
      continue
    }
    if (h.hourly_earnings > 0) {
      const ot = h.overtime_hours > 0 ? ` + ${h.overtime_hours} overtime hrs` : ''
      p.lines.push({ kind: 'Hourly', what: 'Hourly', math: `${h.regular_hours} hrs × ${fmtMoney(h.hourly_rate ?? 0)}${ot}`, amount: roundMoney(h.hourly_earnings) })
    }
  }
  for (const [userId, total] of Array.from(inp.units.entries())) {
    if (total > 0) person(userId).lines.push({ kind: 'Units', what: 'Per-unit pay', math: 'Per-unit pay from the comp plan', amount: roundMoney(total) })
  }
  for (const b of inp.bonuses) {
    person(b.userId).lines.push({ kind: 'Bonus', what: b.description || (b.bonusType === 'manual' ? 'Bonus' : b.bonusType.replace(/_/g, ' ')), math: 'Approved bonus', amount: roundMoney(b.amount) })
  }
  for (const a of inp.adjustments ?? []) {
    person(a.userId).lines.push({ kind: 'Adjustment', what: a.kind === 'balance' ? 'Balance carried over' : 'Fix', math: a.reason, amount: a.amount, adjustmentId: a.id, jobId: a.jobId ?? undefined })
  }
  for (const p of Array.from(byUser.values())) {
    const parts = { commission: 0, hourly: 0, units: 0, bonus: 0, chargebacks: 0, adjustments: 0 }
    for (const l of p.lines) {
      if (l.kind === 'Commission') parts.commission += l.amount
      else if (l.kind === 'Hourly') parts.hourly += l.amount
      else if (l.kind === 'Units') parts.units += l.amount
      else if (l.kind === 'Adjustment') parts.adjustments += l.amount
      else parts.bonus += l.amount
    }
    p.raw = roundMoney(computeNetPayout(parts))
    p.total = Math.max(0, p.raw)
  }
  const people = Array.from(byUser.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  const jobs = Array.from(byJob.values()).sort((a, b) => a.jobNumber.localeCompare(b.jobNumber))
  return { people, jobs }
}

/** Plain-English flags shown above Approve. Pure. */
export function buildWarnings(args: { people: PayWeekPerson[]; firstTimePayees: Set<string>; backlogJobs: number; weekStart: string }): PayWeekWarning[] {
  const out: PayWeekWarning[] = []
  for (const p of args.people) {
    if (p.raw < 0) out.push({ code: 'negative', text: `${p.name}'s check would be below $0 (${fmtMoney(p.raw)}); it is paid as $0.` })
    const big = p.lines.filter((l) => l.amount > BIG_LINE_THRESHOLD)
    for (const l of big) out.push({ code: 'big_line', text: `${p.name} has a single line of ${fmtMoney(l.amount)} (${l.what || l.kind}).` })
    if (args.firstTimePayees.has(p.userId) && p.total > 0) out.push({ code: 'first_time', text: `${p.name} is being paid for the first time.` })
  }
  if (args.backlogJobs > 0) {
    out.push({ code: 'backlog', text: `${args.backlogJobs} job${args.backlogJobs === 1 ? '' : 's'} that finished before ${args.weekStart} ${args.backlogJobs === 1 ? 'is' : 'are'} included — nothing has paid ${args.backlogJobs === 1 ? 'it' : 'them'} yet.` })
  }
  return out
}

function toPeriod(row: { id: string; period_label: string | null; cutoff_at: string; scheduled_pay_date: string; status: string; units_frozen_at?: string | null }): PayWeekPeriod {
  const cutoff = new Date(row.cutoff_at)
  const end = ymdEt(cutoff)
  const start = weekStartYmd(cutoff)
  return { id: row.id, label: row.period_label ?? end, cutoffAt: row.cutoff_at, payDate: row.scheduled_pay_date, status: row.status, unitsFrozen: Boolean(row.units_frozen_at), weekStart: start, weekEnding: end }
}

/**
 * The period "Pay this week" works on. Explicit id wins; otherwise the week that just ended (last Wednesday cutoff),
 * created on first use — there is nothing to set up. An existing period whose cutoff is within 36 hours counts as that
 * week (legacy periods have hand-typed cutoffs).
 */
export async function resolvePayWeekPeriod(admin: SupabaseClient, orgId: string, now: Date, periodId?: string | null): Promise<PayWeekPeriod> {
  const cols = 'id, period_label, cutoff_at, scheduled_pay_date, status, units_frozen_at, created_at'
  if (periodId) {
    const { data, error } = await admin.from('payroll_periods').select(cols).eq('id', periodId).eq('org_id', orgId).maybeSingle()
    if (error) throw error
    if (!data || (data as { status?: string }).status === 'cancelled') throw new Error('Pay period not found')
    return toPeriod(data as never)
  }
  const target = getLastWeeklyPayrollCutoffEtAtOrBefore(now)
  const from = new Date(target.getTime() - 36 * 3_600_000).toISOString()
  const to = new Date(target.getTime() + 36 * 3_600_000).toISOString()
  const find = async () => {
    const { data, error } = await admin
      .from('payroll_periods')
      .select(cols)
      .eq('org_id', orgId)
      .neq('status', 'cancelled')
      .gte('cutoff_at', from)
      .lte('cutoff_at', to)
      .order('created_at', { ascending: true })
      .limit(1)
    if (error) throw error
    return (data ?? [])[0] as never
  }
  let row = await find()
  if (!row) {
    const payDate = weeklyPayrollPayDateForCutoff(target)
    const { error } = await admin.from('payroll_periods').insert({
      org_id: orgId,
      period_label: `Week ending ${ymdEt(target)}`,
      cutoff_at: target.toISOString(),
      lock_at: target.toISOString(),
      scheduled_pay_date: payDate,
      status: 'open',
    })
    // Two people opening Payroll at once: the loser's insert hits the unique label — that is fine, just read the winner's row.
    if (error && (error as { code?: string }).code !== '23505') throw error
    row = await find() // re-read: if two admins raced, both settle on the earliest-created row
  }
  return toPeriod(row)
}

/** The current pay week if it already exists — never creates one (a rep opening My pay is a read). */
export async function findCurrentPayWeekPeriod(admin: SupabaseClient, orgId: string, now: Date): Promise<PayWeekPeriod | null> {
  const target = getLastWeeklyPayrollCutoffEtAtOrBefore(now)
  const { data, error } = await admin
    .from('payroll_periods')
        .select('id, period_label, cutoff_at, scheduled_pay_date, status, units_frozen_at, created_at')
    .eq('org_id', orgId)
    .neq('status', 'cancelled')
    .gte('cutoff_at', new Date(target.getTime() - 36 * 3_600_000).toISOString())
    .lte('cutoff_at', new Date(target.getTime() + 36 * 3_600_000).toISOString())
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw error
  const row = (data ?? [])[0]
  return row ? toPeriod(row as never) : null
}

async function loadNames(admin: SupabaseClient, orgId: string, ids: string[]) {
  const names = new Map<string, { name: string; role: string }>()
  if (ids.length === 0) return names
  const { data, error } = await admin.from('users').select('id, full_name, role').eq('org_id', orgId).in('id', ids)
  if (error) throw error
  for (const u of data ?? []) names.set(u.id as string, { name: (u.full_name as string) || 'Unnamed', role: (u.role as string) || '' })
  return names
}

/** Per-unit pay computed live from the comp plans (an open week). `leftOrSaved` = people who may have left mid-week. */
export async function computeUnitEarnings(admin: SupabaseClient, orgId: string, period: PayWeekPeriod, userIds: string[], leftOrSaved: Set<string> = new Set()): Promise<UnitEarnings> {
  const out: UnitEarnings = new Map()
  if (userIds.length === 0) return out
  const window = await resolvePayrollPeriodWindow(admin, orgId, period.id, period.cutoffAt)
  for (const userId of userIds) {
    const assignment = await loadPlanForWeek(admin, userId, orgId, period.cutoffAt, { leftOrSaved: leftOrSaved.has(userId) })
    const plan = assignment?.comp_plans as Record<string, unknown> | null
    if (!plan) continue
    const res = await computePeriodUnitEarningsForUser(admin, {
      orgId,
      userId,
      plan: {
        plan_type: String(plan.plan_type || ''),
        unit_type: (plan.unit_type as string | null) ?? null,
        unit_rate: plan.unit_rate != null ? Number(plan.unit_rate) : null,
        hybrid_components: (plan.hybrid_components as never) ?? null,
      },
      startIso: window.startIso,
      endIso: window.endIso,
    })
    if (res && res.total > 0) out.set(userId, { total: res.total, detail: res })
  }
  return out
}

/**
 * Per-unit pay for a week. An OPEN week is computed live; an approved week reads what was stored at approval and is never
 * recalculated. A week locked before per-unit pay was frozen (no `unitsFrozen`) keeps the old live calculation.
 */
export async function loadWeekUnitEarnings(admin: SupabaseClient, orgId: string, period: PayWeekPeriod, userIds: string[], leftOrSaved: Set<string> = new Set()): Promise<UnitEarnings> {
  if (period.status !== 'open' && period.unitsFrozen) return loadStoredUnitEarnings(admin, orgId, period.id, userIds)
  return computeUnitEarnings(admin, orgId, period, userIds, leftOrSaved)
}

export async function loadUnits(admin: SupabaseClient, orgId: string, period: PayWeekPeriod, userIds: string[]): Promise<Map<string, number>> {
  const res = await loadWeekUnitEarnings(admin, orgId, period, userIds)
  return new Map(Array.from(res.entries()).map(([id, v]) => [id, v.total]))
}

async function loadJobs(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Map<string, JobInfo>> {
  const out = new Map<string, JobInfo>()
  if (ids.length === 0) return out
  const { data, error } = await admin.from('production_jobs').select('id, job_number, address_text, commission_comp_base').eq('org_id', orgId).in('id', ids)
  if (error) throw error
  for (const j of data ?? []) out.set(j.id as string, j as unknown as JobInfo)
  return out
}

function waitingView(w: WaitingJob, jobs: Map<string, JobInfo>, names: Map<string, { name: string; role: string }>): PayWeekWaiting {
  const base = jobs.get(w.job.id)
  return {
    jobId: w.job.id,
    jobNumber: w.job.job_number,
    address: base?.address_text ?? '',
    reason: w.reasonText,
    who: w.rows.map((r) => ({
      name: names.get(r.user_id)?.name ?? 'Unknown',
      roleLabel: payoutRoleWord(r.participant_role),
      estimate: roundMoney(Number(r.net_amount) || 0),
    })),
  }
}

/** Hours exactly as saved for an approved week (whoever is active today), so an approved week never changes on re-read. */
async function loadStoredHours(admin: SupabaseClient, orgId: string, periodId: string): Promise<HourlyRosterRow[]> {
  const { data, error } = await admin.from('payroll_rep_hours').select('user_id, regular_hours, overtime_hours, hourly_rate_snapshot, hourly_earnings, notes').eq('org_id', orgId).eq('payroll_period_id', periodId)
  if (error) throw error
  return (data ?? []).map((r) => ({
    user_id: r.user_id as string,
    full_name: '',
    role: '',
    plan_name: null,
    plan_type: null,
    hourly_rate: Number(r.hourly_rate_snapshot) || 0,
    regular_hours: Number(r.regular_hours) || 0,
    overtime_hours: Number(r.overtime_hours) || 0,
    hourly_earnings: Number(r.hourly_earnings) || 0,
    notes: (r.notes as string) ?? null,
    has_entry: true,
  }))
}

export type PayWeekFull = {
  week: PayWeek
  /** The plan Approve would commit (draft weeks only). */
  plan: Awaited<ReturnType<typeof planPayrollPeriod>> | null
  /** Per-unit pay behind the totals (computed for a draft, stored for an approved week). */
  units: UnitEarnings
}

export async function loadPayWeek(admin: SupabaseClient, orgId: string, now: Date, periodId?: string | null): Promise<PayWeek> {
  return (await loadPayWeekFull(admin, orgId, now, periodId)).week
}

/** The week plus the plan and per-unit pay it was built from — what Approve commits, so preview and Approve share one read. */
export async function loadPayWeekFull(admin: SupabaseClient, orgId: string, now: Date, periodId?: string | null): Promise<PayWeekFull> {
  const period = await resolvePayWeekPeriod(admin, orgId, now, periodId)
  const draft = period.status === 'open'

  let rows: WeekInputs['rows'] = []
  let fullPlan: PayWeekFull['plan'] = null
  let waiting: WaitingJob[] = []
  let conflictJobIds: string[] = []
  let backlog = { jobs: 0, amount: 0, since: period.weekStart }

  if (draft) {
    const plan = await planPayrollPeriod(admin, { orgId, periodId: period.id, includeWaiting: true })
    fullPlan = plan
    rows = plan.jobs.flatMap((j) => j.rows)
    // Lines already written to this still-open week (debris of an interrupted approval, or a reopened week) are part of what Approve
    // commits — the database total counts every line on the period — so the preview must show them too, or Approve could never match it.
    const { data: existing, error: existingErr } = await admin
      .from('payroll_payout_lines')
      .select('job_id, user_id, participant_role, gross_amount, net_amount, comp_plan_snapshot')
      .eq('org_id', orgId)
      .eq('payroll_period_id', period.id)
    if (existingErr) throw existingErr
    const planned = new Set(rows.map((r) => `${r.job_id}|${r.user_id}|${r.participant_role}`))
    for (const l of (existing ?? []) as WeekInputs['rows']) if (!planned.has(`${l.job_id}|${l.user_id}|${l.participant_role}`)) rows.push(l)
    waiting = plan.waiting
    conflictJobIds = plan.selfGenSetterConflictJobIds
    const old = plan.jobs.filter((j) => ymdEt(new Date(j.eligibleAt)) < period.weekStart)
    backlog = { jobs: old.length, amount: roundMoney(old.reduce((sum, j) => sum + j.rows.reduce((a, r) => a + (Number(r.net_amount) || 0), 0), 0)), since: period.weekStart }
  } else {
    const { data, error } = await admin
      .from('payroll_payout_lines')
      .select('job_id, user_id, participant_role, gross_amount, net_amount, comp_plan_snapshot')
      .eq('org_id', orgId)
      .eq('payroll_period_id', period.id)
    if (error) throw error
    rows = (data ?? []) as WeekInputs['rows']
  }

  const jobIds = Array.from(new Set([...rows.map((r) => r.job_id), ...waiting.map((w) => w.job.id)]))
  // Everyone active on any day of the week: read once, shared by the hours roster and per-unit pay.
  const weekPeople = await loadWeekPeople(admin, orgId, { id: period.id, cutoff_at: period.cutoffAt })
  const [jobs, hours, bonusRes, adjustments] = await Promise.all([
    loadJobs(admin, orgId, jobIds),
    draft ? loadHourlyRoster(admin, orgId, { id: period.id, cutoff_at: period.cutoffAt }, weekPeople) : loadStoredHours(admin, orgId, period.id),
    admin.from('payroll_bonus_lines').select('id, user_id, bonus_type, amount, description, status').eq('org_id', orgId).eq('payroll_period_id', period.id),
    loadPeriodAdjustments(admin, orgId, period.id),
  ])
  if (bonusRes.error) throw bonusRes.error
  const bonusAll = (bonusRes.data ?? []) as Array<{ id: string; user_id: string; bonus_type: string; amount: number; description: string | null; status: string }>
  const approvedBonuses = bonusAll.filter((b) => b.status === 'approved' || b.status === 'paid').map((b) => ({ id: b.id, userId: b.user_id, amount: Number(b.amount) || 0, description: b.description, bonusType: b.bonus_type }))
  const pendingBonuses: Array<(typeof bonusAll)[number] & { fromWeek?: string }> = bonusAll.filter((b) => b.status === 'pending_approval')
  if (draft) {
    // Bonuses the setter-ramp sync dropped into an already-approved week can never be paid there: show them here instead.
    const { data: stuck } = await admin.from('payroll_bonus_lines').select('id, user_id, bonus_type, amount, description, status, payroll_period_id').eq('org_id', orgId).eq('status', 'pending_approval').neq('payroll_period_id', period.id).limit(200)
    const pids = Array.from(new Set((stuck ?? []).map((b) => b.payroll_period_id as string)))
    const pstat = new Map<string, { status: string; cutoff: string }>()
    if (pids.length) {
      const { data: ps } = await admin.from('payroll_periods').select('id, status, cutoff_at').eq('org_id', orgId).in('id', pids)
      for (const x of ps ?? []) pstat.set(x.id as string, { status: x.status as string, cutoff: x.cutoff_at as string })
    }
    for (const b of stuck ?? []) {
      const ps = pstat.get(b.payroll_period_id as string)
      if (ps && (ps.status === 'locked' || ps.status === 'paid')) pendingBonuses.push({ ...(b as unknown as (typeof bonusAll)[number]), fromWeek: ymdEt(new Date(ps.cutoff)) })
    }
  }

  const peopleIds = Array.from(new Set([...rows.map((r) => r.user_id), ...hours.map((h) => h.user_id), ...approvedBonuses.map((b) => b.userId), ...pendingBonuses.map((b) => b.user_id), ...adjustments.map((a) => a.userId), ...waiting.flatMap((w) => w.rows.map((r) => r.user_id))]))
  const names = await loadNames(admin, orgId, peopleIds)
  for (const h of hours) {
    if (!h.full_name) {
      const n = (await loadNames(admin, orgId, [h.user_id])).get(h.user_id)
      h.full_name = n?.name ?? 'Unknown'
      h.role = n?.role ?? ''
    }
    if (!names.has(h.user_id)) names.set(h.user_id, { name: h.full_name, role: h.role })
  }
  // Per-unit pay: everyone who was active on any day of the week is checked (a unit-plan person with no commission rows and no
  // hours still earns it). An approved week reads what was stored at approval.
  const leftOrSaved = new Set(weekPeople.filter((p) => !p.active).map((p) => p.id))
  const unitIds = Array.from(new Set([...weekPeople.map((u) => u.id), ...rows.map((r) => r.user_id), ...hours.map((h) => h.user_id)]))
  const unitEarnings = await loadWeekUnitEarnings(admin, orgId, period, unitIds, new Set([...Array.from(leftOrSaved), ...hours.filter((h) => h.has_entry).map((h) => h.user_id)]))
  const units = new Map(Array.from(unitEarnings.entries()).map(([id, v]) => [id, v.total]))

  const { people, jobs: jobViews } = composeWeek({ rows, jobs, names, hours, units, bonuses: approvedBonuses, adjustments })

  const needs: PayWeekNeed[] = []
  const warnings: PayWeekWarning[] = []
  if (draft) {
    for (const h of hours) if (!h.has_entry) needs.push({ kind: 'hours', userId: h.user_id, name: h.full_name, rate: h.hourly_rate ?? 0 })
    for (const b of pendingBonuses) {
      needs.push({ kind: 'bonus', id: b.id, userId: b.user_id, name: names.get(b.user_id)?.name ?? 'Unknown', amount: Number(b.amount) || 0, what: b.description || b.bonus_type.replace(/_/g, ' '), fromWeek: b.fromWeek })
    }
    const [gaps, ended] = await Promise.all([loadPayPlanGaps(admin, orgId, now), loadEndedPlanPeople(admin, orgId, now)])
    const noPlan = gaps.flatMap((g) => g.people.map((p) => p.name))
    if (noPlan.length) needs.push({ kind: 'plans', text: `${noPlan.length} ${noPlan.length === 1 ? 'person has' : 'people have'} no pay plan, so they are paid nothing`, names: noPlan, href: '/admin/comp-plans' })
    if (ended.length) needs.push({ kind: 'plans', text: `${ended.length} ${ended.length === 1 ? 'person has' : 'people have'} no pay plan because theirs was ended`, names: ended.map((p) => p.name), href: '/admin/comp-plans' })
    for (const d of await loadOpenDisputes(admin, orgId)) needs.push({ kind: 'dispute', id: d.id, userId: d.userId, name: d.name, label: d.label, message: d.message })
    if (conflictJobIds.length) {
      const nums = conflictJobIds.map((id) => jobs.get(id)?.job_number).filter(Boolean) as string[]
      needs.push({ kind: 'conflict', text: 'A self-generated job also has a setter, so the 6% self-generated line was left off', jobNumbers: nums })
    }

    // First-time payees: nobody has ever been paid a commission line outside this period.
    const { data: prior } = await admin.from('payroll_payout_lines').select('user_id').eq('org_id', orgId).neq('payroll_period_id', period.id).in('user_id', people.map((p) => p.userId)).limit(5000)
    const paidBefore = new Set((prior ?? []).map((r) => r.user_id as string))
    const firstTime = new Set(people.filter((p) => !paidBefore.has(p.userId)).map((p) => p.userId))
    warnings.push(...buildWarnings({ people, firstTimePayees: firstTime, backlogJobs: backlog.jobs, weekStart: period.weekStart }))
  }

  const { data: others } = await admin.from('payroll_periods').select('id, cutoff_at, scheduled_pay_date, status').eq('org_id', orgId).neq('id', period.id).neq('status', 'cancelled').lte('cutoff_at', now.toISOString()).order('cutoff_at', { ascending: false }).limit(12)
  const earlier = (others ?? []).map((o) => ({ id: o.id as string, weekEnding: ymdEt(new Date(o.cutoff_at as string)), payDate: o.scheduled_pay_date as string, status: o.status as string }))

  const { data: dirRows } = await admin.from('users').select('id, full_name').eq('org_id', orgId).eq('active', true).order('full_name')
  const directory = (dirRows ?? []).map((u) => ({ id: u.id as string, name: (u.full_name as string) || 'Unnamed' }))

  let nextWeek: PayWeek['nextWeek'] = null
  if (!draft) {
    const nc = addEasternDays(period.cutoffAt, 7)
    const { data: np } = await admin.from('payroll_periods').select('id, cutoff_at, scheduled_pay_date').eq('org_id', orgId).eq('status', 'open').gte('cutoff_at', new Date(nc.getTime() - 36 * 3_600_000).toISOString()).lte('cutoff_at', new Date(nc.getTime() + 36 * 3_600_000).toISOString()).order('created_at', { ascending: true }).limit(1)
    const nrow = (np ?? [])[0]
    if (nrow) {
      const fixes = await loadPeriodAdjustments(admin, orgId, nrow.id as string)
      const fnames = await loadNames(admin, orgId, Array.from(new Set(fixes.map((f) => f.userId))))
      nextWeek = { periodId: nrow.id as string, weekEnding: ymdEt(new Date(nrow.cutoff_at as string)), payDate: nrow.scheduled_pay_date as string, fixes: fixes.map((f) => ({ id: f.id, name: fnames.get(f.userId)?.name ?? 'Unknown', amount: f.amount, reason: f.reason })) }
    }
  }

  const payable = people.filter((p) => p.total > 0)
  const week: PayWeek = {
    period,
    state: draft ? 'draft' : 'approved',
    totals: { amount: roundMoney(payable.reduce((s, p) => s + p.total, 0)), people: payable.length },
    canApprove: draft && (payable.length > 0 || (fullPlan?.jobs.length ?? 0) > 0 || people.some((p) => p.raw < 0)),
    needs,
    warnings,
    backlog,
    people,
    jobs: jobViews,
    waiting: waiting.map((w) => waitingView(w, jobs, names)),
    earlier,
    nextWeek,
    directory,
  }
  return { week, plan: fullPlan, units: unitEarnings }
}

/** One total per person, for the payroll processor. */
export function payWeekCsv(week: PayWeek): string {
  const esc = (v: string | number) => {
    // A name that starts with = + - @ would run as a formula when the file is opened in a spreadsheet.
    const s = typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = ['Name', 'Role', 'Commission', 'Hourly', 'Per-unit', 'Bonus', 'Fixes', 'Total to pay']
  const lines = week.people
    .filter((p) => p.total > 0)
    .map((p) => {
      const sum = (k: PayWeekLine['kind']) => roundMoney(p.lines.filter((l) => l.kind === k).reduce((s, l) => s + l.amount, 0))
      return [p.name, p.roleLabel, sum('Commission'), sum('Hourly'), sum('Units'), sum('Bonus'), sum('Adjustment'), p.total.toFixed(2)].map(esc).join(',')
    })
  return [header.join(','), ...lines, ['TOTAL', '', '', '', '', '', '', week.totals.amount.toFixed(2)].join(',')].join('\n') + '\n'
}
