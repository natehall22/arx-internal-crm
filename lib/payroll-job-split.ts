/**
 * The "Change" sheet: who gets what % on ONE job, on an open week, with one reason — replacing the old multi-step recipe
 * (docs/payroll-per-job-commission-overrides.md: zero each producer, add custom rows, suppress each derived line, check the export).
 *
 * The sheet shows the job's lines exactly as the planner prices them (planPayrollPeriod, same inputs as the Pay screen). The office
 * types the final split; `planJobSplitWrites` turns it into deal_commission_roles rows (the storage the planner already reads), and
 * `payroll_set_job_split` (migration 202611120010) writes them all + one audit row each in ONE transaction, refused once the job is
 * paid. Nothing else changes: attribution, sale credit and the 18% pool rule stay as they are (all lines still scale inside the cap).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { roundMoney } from '@/lib/money'
import { producerStorageRoleForParticipant } from '@/lib/payroll-export'
import { planPayrollPeriod, type PlannedPayoutRow } from '@/lib/payroll-period-materialization'
import { payoutRoleWord, resolvePayWeekPeriod, type PayWeekPeriod } from '@/lib/payroll-pay-week'

const PRODUCER_PARTICIPANT_ROLES = new Set(['sales_rep', 'owner', 'setter'])

/** The deal_commission_roles role a payout line is stored under. Pure. */
export function storageRoleForLine(participantRole: string): string {
  return PRODUCER_PARTICIPANT_ROLES.has(participantRole) ? producerStorageRoleForParticipant(participantRole as never) : participantRole
}

export type SplitLine = {
  key: string
  userId: string
  name: string
  /** Payout role on the line (setter, sales_rep, inspector, custom …). */
  role: string
  storageRole: string
  word: string
  /** Share of the commission base before the pool cap (what the office types). */
  percent: number
  /** What the line pays now (after the pool cap). */
  amount: number
  /** The office already set this line by hand (it can go back to the plan). */
  setByOffice: boolean
}

export type JobSplit = {
  periodId: string
  job: { id: string; number: string; address: string; base: number }
  /** The most the job's sales commission may total, as a % of the base (lines above it are all reduced to fit). */
  capPercent: number | null
  /** "Pays on this check" or the reason it is waiting. */
  status: string
  lines: SplitLine[]
  people: Array<{ id: string; name: string }>
}

export type SplitEdit = {
  /** The final % for each existing line, by `key`; null = take this person off the job. Lines not listed stay as they are. */
  lines: Array<{ key: string; percent: number | null; backToPlan?: boolean }>
  /** New people on the job (a separate "custom" line each). */
  added: Array<{ userId: string; percent: number }>
}

export type SplitWriteRow = { user_id: string; role: string; override_percent: number | null; override_amount: number | null; clear: boolean }

const pctOf = (amount: number, base: number) => (base > 0 ? Math.round((amount / base) * 10000) / 100 : 0)

/** Turns the office's final split into the stored rows, writing only what actually changes. Pure. */
export function planJobSplitWrites(split: Pick<JobSplit, 'lines'>, edit: SplitEdit): { ok: true; rows: SplitWriteRow[] } | { ok: false; error: string } {
  const byKey = new Map(split.lines.map((l) => [l.key, l]))
  const rows: SplitWriteRow[] = []
  const valid = (p: number) => Number.isFinite(p) && p >= 0 && p <= 100
  for (const e of edit.lines) {
    const line = byKey.get(e.key)
    if (!line) return { ok: false, error: 'That line is no longer on this job. Refresh.' }
    if (e.backToPlan) {
      if (line.setByOffice) rows.push({ user_id: line.userId, role: line.storageRole, override_percent: null, override_amount: null, clear: true })
      continue
    }
    const next = e.percent == null ? 0 : Number(e.percent)
    if (!valid(next)) return { ok: false, error: 'Each share must be between 0% and 100%.' }
    if (Math.abs(next - line.percent) < 0.005) continue
    rows.push({ user_id: line.userId, role: line.storageRole, override_percent: roundMoney(next), override_amount: null, clear: false })
  }
  const seen = new Set<string>()
  for (const a of edit.added) {
    const p = Number(a.percent)
    if (!a.userId || !valid(p) || p === 0) return { ok: false, error: 'Pick the person and their share (above 0%).' }
    if (seen.has(a.userId)) return { ok: false, error: 'That person is added twice.' }
    if (split.lines.some((l) => l.userId === a.userId && l.role === 'custom')) return { ok: false, error: 'That person already has their own line on this job: change it there.' }
    seen.add(a.userId)
    rows.push({ user_id: a.userId, role: 'custom', override_percent: roundMoney(p), override_amount: null, clear: false })
  }
  const total = split.lines.reduce((s, l) => {
    const e = edit.lines.find((x) => x.key === l.key)
    return s + (e ? (e.backToPlan ? l.percent : e.percent ?? 0) : l.percent)
  }, 0) + edit.added.reduce((s, a) => s + (Number(a.percent) || 0), 0)
  if (total > 100) return { ok: false, error: 'The shares add up to more than 100% of the job.' }
  return { ok: true, rows }
}

/** The job's current split on an open week, priced by the planner exactly as the Pay screen prices it. */
export async function loadJobSplit(admin: SupabaseClient, orgId: string, periodId: string, jobId: string, now: Date = new Date()): Promise<{ ok: true; value: JobSplit } | { ok: false; status: number; error: string }> {
  let period: PayWeekPeriod
  try {
    period = await resolvePayWeekPeriod(admin, orgId, now, periodId)
  } catch {
    return { ok: false, status: 404, error: 'Week not found' }
  }
  if (period.status !== 'open') return { ok: false, status: 409, error: 'This week is already approved. A fix goes on next week’s check.' }

  const plan = await planPayrollPeriod(admin, { orgId, periodId: period.id, onlyJobIds: [jobId], includeWaiting: true, timeZone: period.clock.timeZone, lateFundingUntil: period.lateFundingUntil, now })
  const paying = plan.jobs.find((j) => j.job.id === jobId)
  const waiting = plan.waiting.find((w) => w.job.id === jobId)
  if (!paying && !waiting) return { ok: false, status: 409, error: 'This job is not ahead of payroll (already paid, settled outside the CRM, or not sold).' }
  const rows: PlannedPayoutRow[] = paying ? paying.rows : waiting!.rows
  const jobRow = paying ? paying.job : waiting!.job

  const [{ data: info }, { data: office }, { data: users }] = await Promise.all([
    admin.from('production_jobs').select('id, job_number, address_text, commission_comp_base').eq('org_id', orgId).eq('id', jobId).maybeSingle(),
    admin.from('deal_commission_roles').select('user_id, role, override_amount, override_percent').eq('org_id', orgId).eq('job_id', jobId),
    admin.from('users').select('id, full_name, active').eq('org_id', orgId),
  ])
  const base = Number(info?.commission_comp_base ?? jobRow.commission_comp_base) || 0
  const names = new Map((users ?? []).map((u) => [u.id as string, (u.full_name as string) || 'Unnamed']))
  const officeSet = new Set((office ?? []).filter((r) => r.override_amount != null || r.override_percent != null).map((r) => `${r.user_id}|${r.role}`))

  const lines: SplitLine[] = rows.map((r) => {
    const storageRole = storageRoleForLine(r.participant_role)
    return {
      key: `${r.user_id}|${r.participant_role}`,
      userId: r.user_id,
      name: names.get(r.user_id) ?? 'Unknown',
      role: r.participant_role,
      storageRole,
      word: payoutRoleWord(r.participant_role),
      percent: pctOf(Number(r.gross_amount) || 0, base),
      amount: roundMoney(Number(r.net_amount) || 0),
      setByOffice: officeSet.has(`${r.user_id}|${storageRole}`),
    }
  })
  const cap = paying?.poolCap
  return {
    ok: true,
    value: {
      periodId: period.id,
      job: { id: jobId, number: (info?.job_number as string) ?? jobRow.job_number, address: (info?.address_text as string) ?? '', base },
      capPercent: cap != null && base > 0 ? pctOf(cap, base) : null,
      status: paying ? 'Pays on this check' : waiting!.reasonText,
      lines,
      people: (users ?? []).filter((u) => u.active !== false).map((u) => ({ id: u.id as string, name: (u.full_name as string) || 'Unnamed' })).sort((a, b) => a.name.localeCompare(b.name)),
    },
  }
}

/** Plain words for a refusal from payroll_set_job_split. Pure. */
export function jobSplitErrorMessage(error: { message?: string; code?: string }): { status: number; error: string } {
  const m = String(error.message ?? '')
  if (/job_split:already_paid/.test(m)) return { status: 409, error: 'This job was already paid on an approved week. Put a fix on the next open week instead.' }
  if (/job_split:settled_externally/.test(m)) return { status: 409, error: 'This job was settled outside the CRM, so the CRM does not pay it.' }
  if (/job_split:reason_required/.test(m)) return { status: 400, error: 'Say why (one line).' }
  if (/job_split:user_not_found/.test(m)) return { status: 404, error: 'That person is not in this company.' }
  if (/job_split:job_not_found/.test(m)) return { status: 404, error: 'Job not found' }
  if (/job_split:bad_/.test(m)) return { status: 400, error: 'Each share must be between 0% and 100%.' }
  if (/payroll_period_claimed/.test(m) || error.code === '55006') return { status: 409, error: 'This week is being approved right now. Try again in a minute.' }
  if (error.code === 'PGRST202' || error.code === '42883') return { status: 503, error: 'This needs the database update first.' }
  return { status: 500, error: 'Could not save the change. Nothing was changed.' }
}
