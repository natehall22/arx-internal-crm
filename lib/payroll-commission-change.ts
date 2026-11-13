/**
 * Commission change lines — when a job's commission base moves AFTER the job was paid on an approved week, the paid week never
 * changes: the next OPEN week gets one signed line per person, `that person's PERCENT rate × the base change`, with the math in
 * plain words.
 * - Time & materials: more hours billed and PAID, or a paid invoice voided / refunded (the paid-for base, below).
 * - Fixed price (money sweep 2026-11-13): a change order signed after the payout (or one that stops counting) moves the base the
 *   one writer keeps (`production_jobs.commission_comp_base`, lib/job-commission-base.ts). A DROP is taken back at once; a RISE is
 *   paid only once the job is paid in full again (`evaluateJobCollection`, the one rule — commission follows the money, as the
 *   original payout did). Only payouts approved on/after FIXED_PRICE_CHANGES_FROM count: earlier weeks were paid on the old
 *   dealer-fee-deducted base, and following them would restate that pay.
 *
 * - Only percentage pay scales. Flat dollars never do: a flat per-job override (the Change sheet's $), a plan's flat
 *   per-job amount, a flat-rate plan, a volume-bonus flat — all were paid once and stay as they are.
 *   A person's rate = the percentage their paid lines were figured at (plan: effective rate incl. a volume-bonus %;
 *   override / additive line: its percent), times how much the pool cap scaled that line down, as paid.
 * - The base followed here is what the customer has PAID for: the issued invoices' pre-tax total in proportion to the money
 *   in (job payments, the same money "paid in full" counts) — capped at all of it. New hours pay commission once their
 *   invoice is paid; a voided invoice or a refund takes it back. Invoice statuses are not used: job payments are often
 *   recorded without being applied to an invoice, so "paid" is read from the money, as paid-in-full does.
 * - These are ordinary payroll fixes (`payroll_adjustments`, kind 'commission_change', PAY_LINE_SOURCES 'Adjustment'); a
 *   negative check carries forward at approve like any other fix. Writer: SQL payroll_add_commission_changes (migration
 *   202611120030), per-job lock + "base covered so far" check, so re-running never pays the same dollars twice.
 * - Not written now → the job is marked due (`production_jobs.commission_change_due_at` + `commission_change_wait`) and retried
 *   (`retryDueCommissionChanges`: the morning cron and the Pay this week screen): an approval mid-claim ('approval_running'),
 *   or the new pay week is not switched on yet ('pay_week_off' — the legacy payroll never reads these lines; owners see
 *   "N commission changes waiting for the new payroll" on Today and in the morning email; docs/payroll-cutover.md).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Queue as TodayQueue } from '@/lib/today'

import { evaluateJobCollection, sumCollectedCents } from '@/lib/job-collection'
import { collectionInvoiceFields, loadJobInvoiceFacts } from '@/lib/job-invoice-tax'
import { roundMoney } from '@/lib/money'
import { isPayWeekEnabled } from '@/lib/payroll-flag'
import { orgDb } from '@/lib/supabase/org-db'

/** A paid payout line as payroll stored it (payroll_payout_lines + the job snapshot's base). */
export type PaidJobLine = {
  userId: string
  net: number
  gross: number
  /** The commission base the job was paid on (payroll_job_snapshots.commission_base). */
  base: number
  snapshot: Record<string, unknown> | null
  periodId: string
  cutoffAt: string
}

/**
 * Pure: the share of ONE paid line that scales with the base (a fraction, e.g. 0.07). Flat dollars → 0. A line whose
 * shape isn't known (older rows) → 0: never pay on a guess.
 */
export function percentRateOfLine(l: Pick<PaidJobLine, 'net' | 'gross' | 'base' | 'snapshot'>): number {
  const s = l.snapshot ?? {}
  if (!(l.base > 0)) return 0
  const basis = typeof s.basis === 'string' ? s.basis : null
  // Per-job overrides and additive lines (inspector, manager, self-gen): a percent of the base, or flat dollars.
  if (basis) {
    if (basis !== 'percent' || !(l.net > 0) || !(l.gross > 0)) return 0
    return l.net / l.base // percent × base, scaled by the pool cap exactly as paid
  }
  // Comp-plan lines: the effective rate (base + volume-bonus %) on the base; flat-rate plans, $-per-job and flat bonuses don't scale.
  const plan = (s.plan ?? null) as { plan_type?: string } | null
  const calc = (s.calculation ?? null) as { effectiveRate?: number; totalAmount?: number } | null
  if (!plan || !calc || plan.plan_type === 'flat_rate') return 0
  const rate = Number(calc.effectiveRate) || 0
  const total = Number(calc.totalAmount) || 0
  if (!(rate > 0) || !(total > 0)) return 0
  // The pool cap scales the plan amount (never the flat bonus): net − flat bonus over the plan amount, as paid.
  const flatBonus = Math.max(0, roundMoney(l.gross - total))
  const scale = Math.min(1, Math.max(0, (l.net - flatBonus) / total))
  return (rate / 100) * scale
}

/** Pure: the base commission changes follow = issued invoices (pre-tax) × the share of them the money in covers (≤ 1). */
export function payableBaseFromFacts(f: { issuedTotalCents: number; issuedPreTaxCents: number }, collectedCents: number): number {
  if (!(f.issuedTotalCents > 0)) return 0
  const covered = Math.min(1, Math.max(0, collectedCents) / f.issuedTotalCents)
  return roundMoney(Math.round(f.issuedPreTaxCents * covered) / 100)
}

export type CommissionChangeLine = { userId: string; baseDelta: number; amount: number; reason: string; expectedPrior: number }

const fmt = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * The day the commission base got its one writer and stopped deducting the dealer fee (Nathan, 2026-10-22). A fixed-price payout
 * approved before it was figured on the old base, so its job is never followed (no restatement of old pay).
 */
export const FIXED_PRICE_CHANGES_FROM = '2026-10-22'

/**
 * Pure: the lines to add now. `prior` = per person, the base already covered by earlier change lines on this job.
 * `holdIncreases`: a rise is not paid yet (a fixed-price job not paid in full again); a drop still is.
 */
export function planCommissionChanges(input: { jobNumber: string | null; currentBase: number; paid: readonly PaidJobLine[]; prior: ReadonlyMap<string, number>; holdIncreases?: boolean; hourly?: boolean }): CommissionChangeLine[] {
  const byUser = new Map<string, { rate: number; base: number }>()
  for (const l of input.paid) {
    const u = byUser.get(l.userId) ?? { rate: 0, base: l.base }
    u.rate += percentRateOfLine(l)
    u.base = Math.max(u.base, l.base)
    byUser.set(l.userId, u)
  }
  const out: CommissionChangeLine[] = []
  for (const [userId, u] of Array.from(byUser.entries())) {
    if (!(u.base > 0) || !(u.rate > 0)) continue // nothing that scales (flat pay only, or paid on a $0 base)
    const prior = roundMoney(input.prior.get(userId) ?? 0)
    const covered = roundMoney(u.base + prior)
    const baseDelta = roundMoney(input.currentBase - covered)
    if (baseDelta === 0) continue
    if (baseDelta > 0 && input.holdIncreases) continue
    const amount = roundMoney(baseDelta * u.rate)
    if (amount === 0) continue
    const job = input.jobNumber ? `job ${input.jobNumber}` : input.hourly === false ? 'a job' : 'a job billed by the hour'
    out.push({
      userId,
      baseDelta,
      amount,
      expectedPrior: prior,
      reason: `Commission change, ${job}: paid base ${fmt(covered)} → ${fmt(input.currentBase)} (${baseDelta > 0 ? '+' : ''}${fmt(baseDelta)}) × ${(u.rate * 100).toFixed(4)}% = ${fmt(amount)}`,
    })
  }
  return out.sort((a, b) => a.userId.localeCompare(b.userId))
}

/** What the job's approved (locked / paid) weeks paid each person, with the base it was paid on. */
async function loadPaidJobLines(admin: SupabaseClient, orgId: string, jobId: string): Promise<PaidJobLine[] | null> {
  const { data: lines, error } = await orgDb(admin, orgId)
    .from('payroll_payout_lines')
    .select('user_id, net_amount, gross_amount, comp_plan_snapshot, payroll_period_id, payroll_job_snapshot_id')
    .eq('job_id', jobId)
    .limit(500)
  if (error) return null
  const rows = (lines ?? []) as Array<{ user_id: string; net_amount: number | string; gross_amount: number | string; comp_plan_snapshot: Record<string, unknown> | null; payroll_period_id: string; payroll_job_snapshot_id: string }>
  if (!rows.length) return []
  const periodIds = Array.from(new Set(rows.map((r) => r.payroll_period_id)))
  const { data: periods } = await orgDb(admin, orgId).from('payroll_periods').select('id, status, cutoff_at').in('id', periodIds)
  const approved = new Map(((periods ?? []) as Array<{ id: string; status: string; cutoff_at: string }>).filter((p) => p.status === 'locked' || p.status === 'paid').map((p) => [p.id, p.cutoff_at]))
  const snapIds = Array.from(new Set(rows.map((r) => r.payroll_job_snapshot_id)))
  const { data: snaps } = await orgDb(admin, orgId).from('payroll_job_snapshots').select('id, commission_base').in('id', snapIds)
  const base = new Map(((snaps ?? []) as Array<{ id: string; commission_base: number | string | null }>).map((s) => [s.id, Number(s.commission_base) || 0]))
  return rows
    .filter((r) => approved.has(r.payroll_period_id))
    .map((r) => ({
      userId: r.user_id,
      net: Number(r.net_amount) || 0,
      gross: Number(r.gross_amount) || 0,
      base: base.get(r.payroll_job_snapshot_id) ?? 0,
      snapshot: r.comp_plan_snapshot ?? null,
      periodId: r.payroll_period_id,
      cutoffAt: approved.get(r.payroll_period_id) as string,
    }))
}

async function loadPrior(admin: SupabaseClient, orgId: string, jobId: string): Promise<Map<string, number>> {
  const { data } = await orgDb(admin, orgId).from('payroll_adjustments').select('user_id, base_delta, status, kind').eq('job_id', jobId).eq('kind', 'commission_change').neq('status', 'void').limit(5000)
  const out = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ user_id: string; base_delta: number | string | null }>) out.set(r.user_id, roundMoney((out.get(r.user_id) ?? 0) + (Number(r.base_delta) || 0)))
  return out
}

/** The base commission changes follow for a job: issued invoices (pre-tax) as far as the money in covers them. */
async function loadPayableBase(admin: SupabaseClient, orgId: string, jobId: string): Promise<number> {
  const facts = (await loadJobInvoiceFacts(admin, [jobId])).get(jobId)
  if (!facts) return 0
  // org-scope-ok: jobId is the caller's job, loaded company-scoped above (production_jobs by id + org); job_payments hang off it
  const { data } = await admin.from('job_payments').select('amount_cents, funding_status').eq('job_id', jobId)
  return payableBaseFromFacts(facts, sumCollectedCents((data ?? []) as Array<{ amount_cents: number | null; funding_status?: string | null }>))
}

type FollowedJob = {
  id: string
  job_number: string | null
  billing_mode?: string | null
  commission_change_due_at?: string | null
  commission_comp_base: number | string | null
  sale_amount: number | string | null
  allow_close_with_balance?: boolean | null
  close_balance_by?: string | null
}

/**
 * A fixed-price job's base to follow: the one writer's `commission_comp_base`. Rises wait until the job is paid in full again
 * (the one paid-in-full rule, incl. invoice tax and an owner's force-paid). No base on file → nothing (never claw back everything
 * because a base is missing; data health flags it).
 */
async function fixedPriceTarget(admin: SupabaseClient, jobId: string, job: FollowedJob): Promise<{ base: number; holdIncreases: boolean } | null> {
  const base = job.commission_comp_base == null ? NaN : Number(job.commission_comp_base)
  if (!Number.isFinite(base) || base <= 0) return null
  const facts = (await loadJobInvoiceFacts(admin, [jobId])).get(jobId)
  // org-scope-ok: jobId is the caller's job, loaded company-scoped above (production_jobs by id + org); job_payments hang off it
  const { data } = await admin.from('job_payments').select('amount_cents, funding_status').eq('job_id', jobId)
  const c = evaluateJobCollection({
    saleAmount: job.sale_amount == null ? null : Number(job.sale_amount),
    ...collectionInvoiceFields(facts),
    collectedCents: sumCollectedCents((data ?? []) as Array<{ amount_cents: number | null; funding_status?: string | null }>),
    allowCloseWithBalance: job.allow_close_with_balance ?? null,
    closeBalanceBy: job.close_balance_by ?? null,
  })
  return { base: roundMoney(base), holdIncreases: !c.paidInFull }
}

export type CommissionChangeWait = 'approval_running' | 'pay_week_off' | 'retry_error'

async function markDue(admin: SupabaseClient, orgId: string, jobId: string, wait: CommissionChangeWait | null): Promise<void> {
  const { error } = await orgDb(admin, orgId)
    .from('production_jobs')
    .update(wait ? { commission_change_due_at: new Date().toISOString(), commission_change_wait: wait } : { commission_change_due_at: null, commission_change_wait: null })
    .eq('id', jobId)
  if (error) console.error('[commission change] could not mark the job', { orgId, jobId, wait, error })
}

/**
 * An unexpected error on the way to a job's commission change lines (a database error, the base sync failing): the job is
 * marked due ('retry_error') so the morning cron and Pay this week try again — never only logged. Never throws.
 */
export async function markCommissionChangeRetry(admin: SupabaseClient, orgId: string, jobId: string, error: unknown): Promise<void> {
  console.error('[commission change] failed; marked for retry', { orgId, jobId, error })
  await markDue(admin, orgId, jobId, 'retry_error').catch((e) => console.error('[commission change] could not mark for retry', { orgId, jobId, e }))
}

export type CommissionChangeResult = { added: number; periodId: string | null; lines: CommissionChangeLine[]; waiting: 'approval_running' | 'pay_week_off' | null }

/**
 * Bring a paid job's commission up to (or down to) its current PAID base on the next open week. Nothing paid yet, or nothing
 * changed = nothing written (and any "waiting" mark cleared). Idempotent; a concurrent run is refused by the SQL check and
 * recomputed once; a run refused because a week is being approved is kept waiting and retried — never dropped.
 */
export async function syncCommissionChangesForJob(admin: SupabaseClient, orgId: string, jobId: string, actorUserId: string | null = null): Promise<CommissionChangeResult> {
  try {
    return await syncCommissionChangesOnce(admin, orgId, jobId, actorUserId)
  } catch (e) {
    // Anything unexpected (a read failing, the SQL refusing for another reason): keep the job waiting for a retry, then
    // let the caller know. A job marked here is retried by retryDueCommissionChanges like any other waiting job.
    await markCommissionChangeRetry(admin, orgId, jobId, e)
    throw e
  }
}

async function syncCommissionChangesOnce(admin: SupabaseClient, orgId: string, jobId: string, actorUserId: string | null): Promise<CommissionChangeResult> {
  const none = (waiting: CommissionChangeResult['waiting'] = null): CommissionChangeResult => ({ added: 0, periodId: null, lines: [], waiting })
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: jobData } = await orgDb(admin, orgId)
      .from('production_jobs')
      .select('id, job_number, billing_mode, commission_change_due_at, commission_comp_base, sale_amount, allow_close_with_balance, close_balance_by')
      .eq('id', jobId)
      .maybeSingle()
    if (!jobData) return none()
    const job = jobData as FollowedJob
    const wasDue = !!job.commission_change_due_at
    const hourly = job.billing_mode === 'time_materials'
    const allPaid = await loadPaidJobLines(admin, orgId, jobId)
    // Fixed price: only payouts approved under today's base rule are followed (see FIXED_PRICE_CHANGES_FROM).
    const paid = hourly ? allPaid : (allPaid ?? []).filter((l) => l.cutoffAt.slice(0, 10) >= FIXED_PRICE_CHANGES_FROM)
    const follow = !paid || paid.length === 0 ? null : hourly ? { base: await loadPayableBase(admin, orgId, jobId), holdIncreases: false } : await fixedPriceTarget(admin, jobId, job)
    if (!paid || paid.length === 0 || !follow) {
      if (wasDue) await markDue(admin, orgId, jobId, null)
      return none()
    }
    const lines = planCommissionChanges({
      jobNumber: job.job_number ?? null,
      currentBase: follow.base,
      holdIncreases: follow.holdIncreases,
      hourly,
      paid,
      prior: await loadPrior(admin, orgId, jobId),
    })
    if (!lines.length) {
      if (wasDue) await markDue(admin, orgId, jobId, null)
      return none()
    }
    // The legacy payroll (pay week switched off) never reads these lines: keep them waiting for the new payroll.
    if (!isPayWeekEnabled()) {
      await markDue(admin, orgId, jobId, 'pay_week_off')
      return { ...none('pay_week_off'), lines }
    }
    const latest = paid.reduce((a, b) => (a.cutoffAt > b.cutoffAt ? a : b))
    const { ensureNextOpenPeriod } = await import('@/lib/payroll-periods')
    const target = await ensureNextOpenPeriod(admin, orgId, latest.cutoffAt)
    const { data, error } = await admin.rpc('payroll_add_commission_changes', {
      p_org: orgId,
      p_job: jobId,
      p_period: target.id,
      p_source_period: latest.periodId,
      p_actor: actorUserId,
      p_lines: lines.map((l) => ({ user_id: l.userId, amount: l.amount, base_delta: l.baseDelta, reason: l.reason, expected_prior: l.expectedPrior })),
    })
    if (!error) {
      if (wasDue) await markDue(admin, orgId, jobId, null)
      return { added: Number(data) || lines.length, periodId: target.id, lines, waiting: null }
    }
    if (error.code === '40001' && attempt === 0) continue
    // An approval holds the week (or it closed under us): keep it waiting; the next retry puts it on the next open week.
    if (error.code === '55006') {
      await markDue(admin, orgId, jobId, 'approval_running')
      return { ...none('approval_running'), lines }
    }
    throw new Error(`commission change: ${error.message}`)
  }
  await markDue(admin, orgId, jobId, 'approval_running')
  return none('approval_running')
}

/** Retry every job marked waiting (the morning cron, the Pay this week screen). Never throws. */
export async function retryDueCommissionChanges(admin: SupabaseClient, orgId: string): Promise<{ tried: number; written: number; waiting: number }> {
  const out = { tried: 0, written: 0, waiting: 0 }
  const { data, error } = await orgDb(admin, orgId).from('production_jobs').select('id, commission_change_wait').not('commission_change_due_at', 'is', null).limit(200)
  if (error) return out // migration 202611120030 not applied: nothing is ever waiting
  for (const { id, commission_change_wait: wait } of (data ?? []) as Array<{ id: string; commission_change_wait: string | null }>) {
    out.tried++
    try {
      // An error may have stopped the base sync itself: redo it first (it is the one writer and a no-op when in step).
      // Only a job billed by the hour: a fixed-price job's base is the contract's and is never re-synced from here
      // (syncCommissionChangesForJob below follows the base as stored, and clears the mark when there is nothing to do).
      const isHourly = wait === 'retry_error' && (await orgDb(admin, orgId).from('production_jobs').select('billing_mode').eq('id', id).maybeSingle()).data?.billing_mode === 'time_materials'
      if (isHourly) {
        const { syncJobSaleAndCommissionBase } = await import('@/lib/job-commission-base')
        const base = await syncJobSaleAndCommissionBase(admin, { orgId, jobId: id })
        if (base.status === 'error') throw new Error(`base sync: ${(base.error as { message?: string } | null)?.message ?? String(base.error)}`)
      }
      const r = await syncCommissionChangesForJob(admin, orgId, id)
      if (r.added) out.written++
      if (r.waiting) out.waiting++
    } catch (e) {
      out.waiting++
      console.error('[commission change] retry failed', { orgId, jobId: id, error: e })
    }
  }
  return out
}

/** Owners: "N commission changes waiting for the new payroll" (or for an approval to finish). Null when none. */
export async function loadCommissionChangesWaitingQueue(admin: SupabaseClient, orgId: string): Promise<TodayQueue | null> {
  const { data, error } = await orgDb(admin, orgId).from('production_jobs').select('id, job_number, commission_change_wait').not('commission_change_due_at', 'is', null).limit(200)
  if (error || !data?.length) return null
  const rows = data as Array<{ id: string; job_number: string | null; commission_change_wait: string | null }>
  const n = rows.length
  const s = n === 1 ? '' : 's'
  const kinds = new Set(rows.map((r) => r.commission_change_wait ?? 'approval_running'))
  // The title says the real reason; a mix of reasons gets a plain count (each row says its own).
  const title =
    kinds.size > 1
      ? `${n} commission change${s} waiting`
      : kinds.has('pay_week_off')
        ? `${n} commission change${s} waiting for the new payroll`
        : kinds.has('retry_error')
          ? `${n} commission change${s} couldn’t be written — retried every morning`
          : `${n} commission change${s} waiting for an approval to finish`
  return {
    id: 'commission-changes-waiting',
    title,
    count: n,
    empty: 'No commission changes waiting.',
    items: rows.slice(0, 10).map((r) => {
      const ref = r.job_number ? `Job ${r.job_number}` : 'Job'
      const note =
        r.commission_change_wait === 'pay_week_off'
          ? 'the commission base moved after this job was paid — paid once the new Pay this week is on'
          : r.commission_change_wait === 'retry_error'
            ? 'could not be written (a database error) — retried every morning'
            : 'retrying after the approval in progress'
      return { id: r.id, title: ref, detail: note, href: `/ops/jobs/${r.id}`, ref, note }
    }),
  }
}
