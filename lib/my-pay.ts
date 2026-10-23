/**
 * "My pay": one person's own view of the payroll, from the same engine as "Pay this week".
 *   This week — their lines on the open week (draft) or the approved week, with the math
 *   Coming    — jobs credited to them that are not payable yet, with the reason and an estimate
 *   Paid      — their last approved weeks, line by line
 * Only the signed-in person's rows ever leave this module (the engine plans the whole org; everything else is dropped
 * before composing).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { roundMoney } from '@/lib/money'
import { loadPeriodAdjustments } from '@/lib/payroll-adjustments'
import { planPayrollPeriod } from '@/lib/payroll-period-materialization'
import { composeWeek, payoutRoleWord, resolvePayWeekPeriod, type PayWeekLine, type PayWeekPeriod } from '@/lib/payroll-pay-week'

export type MyPayJob = { key: string; title: string; why: string; amount: number; math: string; jobId?: string; lineKind: string }

export type MyPayDispute = { id: string; label: string; message: string; status: string; reply: string | null; createdAt: string }

export type MyPay = {
  name: string
  /** The big number: what is (or will be) on the next check. */
  headline: { amount: number; state: 'draft' | 'approved'; payDate: string }
  thisWeek: MyPayJob[]
  coming: MyPayJob[]
  comingTotal: number
  paid: Array<{ periodId: string; payDate: string; total: number; lines: MyPayJob[] }>
  disputes: MyPayDispute[]
  /** Fixes the office queued on next week's check. */
  nextWeekFixes: Array<{ id: string; amount: number; reason: string }>
}

const line = (l: PayWeekLine, why: string, i: number): MyPayJob => ({
  key: `${l.kind}-${l.jobId ?? ''}-${i}`,
  title: l.what || l.kind,
  why,
  amount: l.amount,
  math: l.math,
  jobId: l.jobId,
  lineKind: l.kind,
})

async function myWeekLines(admin: SupabaseClient, orgId: string, userId: string, period: PayWeekPeriod, rows: Parameters<typeof composeWeek>[0]['rows'], name: string) {
  const jobIds = Array.from(new Set(rows.map((r) => r.job_id)))
  const jobs = new Map<string, { id: string; job_number: string; address_text: string | null; commission_comp_base: number | null }>()
  if (jobIds.length) {
    const { data } = await admin.from('production_jobs').select('id, job_number, address_text, commission_comp_base').eq('org_id', orgId).in('id', jobIds)
    for (const j of data ?? []) jobs.set(j.id as string, j as never)
  }
  const [{ data: hoursRow }, { data: bonusRows }, adjustments] = await Promise.all([
    admin.from('payroll_rep_hours').select('regular_hours, overtime_hours, hourly_rate_snapshot, hourly_earnings').eq('org_id', orgId).eq('payroll_period_id', period.id).eq('user_id', userId).maybeSingle(),
    admin.from('payroll_bonus_lines').select('id, bonus_type, amount, description, status').eq('org_id', orgId).eq('payroll_period_id', period.id).eq('user_id', userId).in('status', ['approved', 'paid']),
    loadPeriodAdjustments(admin, orgId, period.id),
  ])
  const hours = hoursRow
    ? [{ user_id: userId, full_name: name, role: '', plan_name: null, plan_type: null, hourly_rate: Number(hoursRow.hourly_rate_snapshot) || 0, regular_hours: Number(hoursRow.regular_hours) || 0, overtime_hours: Number(hoursRow.overtime_hours) || 0, hourly_earnings: Number(hoursRow.hourly_earnings) || 0, notes: null, has_entry: true }]
    : []
  const { people } = composeWeek({
    rows,
    jobs,
    names: new Map([[userId, { name, role: '' }]]),
    hours,
    units: new Map(),
    bonuses: (bonusRows ?? []).map((b) => ({ id: b.id as string, userId, amount: Number(b.amount) || 0, description: (b.description as string) ?? null, bonusType: b.bonus_type as string })),
    adjustments: adjustments.filter((a) => a.userId === userId),
  })
  return people.find((p) => p.userId === userId) ?? null
}

export async function loadMyPay(admin: SupabaseClient, orgId: string, userId: string, now: Date): Promise<MyPay> {
  const { data: me } = await admin.from('users').select('full_name').eq('id', userId).eq('org_id', orgId).maybeSingle()
  const name = (me?.full_name as string) || 'You'
  const period = await resolvePayWeekPeriod(admin, orgId, now)
  const draft = period.status === 'open'

  let rows: Parameters<typeof composeWeek>[0]['rows'] = []
  const coming: MyPayJob[] = []
  if (draft) {
    const plan = await planPayrollPeriod(admin, { orgId, periodId: period.id, includeWaiting: true })
    rows = plan.jobs.flatMap((j) => j.rows).filter((r) => r.user_id === userId)
    const waitingIds = plan.waiting.filter((w) => w.rows.some((r) => r.user_id === userId)).map((w) => w.job.id)
    const info = new Map<string, { job_number: string; address_text: string | null }>()
    if (waitingIds.length) {
      const { data } = await admin.from('production_jobs').select('id, job_number, address_text').eq('org_id', orgId).in('id', waitingIds)
      for (const j of data ?? []) info.set(j.id as string, j as never)
    }
    for (const w of plan.waiting) {
      for (const r of w.rows.filter((x) => x.user_id === userId)) {
        const j = info.get(w.job.id)
        coming.push({
          key: `c-${w.job.id}-${r.participant_role}`,
          title: `${w.job.job_number}${j?.address_text ? ` · ${j.address_text}` : ''}`,
          why: w.reasonText,
          amount: roundMoney(Number(r.net_amount) || 0),
          math: `Estimate: ${payoutRoleWord(r.participant_role)} line on this job`,
          jobId: w.job.id,
          lineKind: 'Commission',
        })
      }
    }
  } else {
    const { data } = await admin.from('payroll_payout_lines').select('job_id, user_id, participant_role, gross_amount, net_amount, comp_plan_snapshot').eq('org_id', orgId).eq('payroll_period_id', period.id).eq('user_id', userId)
    rows = (data ?? []) as typeof rows
  }
  const person = await myWeekLines(admin, orgId, userId, period, rows, name)
  const thisWeek = (person?.lines ?? []).map((l, i) => line(l, draft ? `On Friday's check (${period.payDate}).` : `Approved. Paid ${period.payDate}.`, i))
  const amount = roundMoney(Math.max(0, person?.raw ?? 0))

  // Paid history: the last approved weeks (never the open one)
  const { data: past } = await admin.from('payroll_periods').select('id, cutoff_at, scheduled_pay_date, status, period_label').eq('org_id', orgId).in('status', ['locked', 'paid']).neq('id', period.id).order('cutoff_at', { ascending: false }).limit(6)
  const paid: MyPay['paid'] = []
  for (const p of past ?? []) {
    const pp: PayWeekPeriod = { id: p.id as string, label: (p.period_label as string) ?? '', cutoffAt: p.cutoff_at as string, payDate: p.scheduled_pay_date as string, status: p.status as string, weekStart: '', weekEnding: '' }
    const { data } = await admin.from('payroll_payout_lines').select('job_id, user_id, participant_role, gross_amount, net_amount, comp_plan_snapshot').eq('org_id', orgId).eq('payroll_period_id', pp.id).eq('user_id', userId)
    const pers = await myWeekLines(admin, orgId, userId, pp, (data ?? []) as typeof rows, name)
    if (!pers || (pers.lines.length === 0 && pers.raw === 0)) continue
    paid.push({ periodId: pp.id, payDate: pp.payDate, total: pers.total, lines: pers.lines.map((l, i) => line(l, `Paid ${pp.payDate}.`, i)) })
  }

  const { data: dis } = await admin.from('payroll_disputes').select('id, line_label, message, status, reply, created_at').eq('org_id', orgId).eq('user_id', userId).order('created_at', { ascending: false }).limit(20)

  // Fixes the office queued on next week
  const next = await admin.from('payroll_periods').select('id').eq('org_id', orgId).eq('status', 'open').gt('cutoff_at', period.cutoffAt).order('cutoff_at', { ascending: true }).limit(1)
  const nextId = !draft ? ((next.data ?? [])[0]?.id as string | undefined) : undefined
  const nextWeekFixes = nextId ? (await loadPeriodAdjustments(admin, orgId, nextId)).filter((a) => a.userId === userId).map((a) => ({ id: a.id, amount: a.amount, reason: a.reason })) : []

  return {
    name,
    headline: { amount, state: draft ? 'draft' : 'approved', payDate: period.payDate },
    thisWeek,
    coming,
    comingTotal: roundMoney(coming.reduce((s, c) => s + c.amount, 0)),
    paid,
    disputes: (dis ?? []).map((d) => ({ id: d.id as string, label: d.line_label as string, message: d.message as string, status: d.status as string, reply: (d.reply as string) ?? null, createdAt: d.created_at as string })),
    nextWeekFixes,
  }
}

export async function fileDispute(
  admin: SupabaseClient,
  input: { orgId: string; userId: string; label: string; message: string; periodId?: string | null; jobId?: string | null }
): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  const message = input.message.trim()
  const label = input.label.trim().slice(0, 200)
  if (!message || message.length > 1000) return { ok: false, status: 400, error: 'Tell us what looks wrong (a sentence or two).' }
  if (!label) return { ok: false, status: 400, error: 'Pick the line first.' }
  // The job / week must exist in this org — a rep cannot attach a note to someone else's data.
  if (input.jobId) {
    const { data } = await admin.from('production_jobs').select('id').eq('id', input.jobId).eq('org_id', input.orgId).maybeSingle()
    if (!data) return { ok: false, status: 404, error: 'Job not found' }
  }
  if (input.periodId) {
    const { data } = await admin.from('payroll_periods').select('id').eq('id', input.periodId).eq('org_id', input.orgId).maybeSingle()
    if (!data) return { ok: false, status: 404, error: 'Week not found' }
  }
  // One open question per line at a time.
  const { data: open } = await admin.from('payroll_disputes').select('id').eq('org_id', input.orgId).eq('user_id', input.userId).eq('line_label', label).eq('status', 'open').limit(1)
  if (open?.length) return { ok: false, status: 409, error: 'You already asked about this line. The office will reply.' }
  const { data, error } = await admin.from('payroll_disputes').insert({ org_id: input.orgId, user_id: input.userId, payroll_period_id: input.periodId ?? null, job_id: input.jobId ?? null, line_label: label, message, status: 'open' }).select('id').single()
  if (error || !data) {
    console.error('payroll dispute insert', error)
    return { ok: false, status: 500, error: 'Could not send that. Try again.' }
  }
  return { ok: true, id: data.id as string }
}
