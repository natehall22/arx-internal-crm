/**
 * The customer's JOBS in the portal (server only): progress stages, install dates, balance, checkups. Same rules as
 * lib/portal/data.ts — every query is `orgDb` + this customer's job ids; columns by name; plain view types out.
 *
 * Nothing here decides a status. It reads what the app already decided (see lib/portal/job-stages.ts) and shows it in plain
 * words. Never selected: costs, commission, dealer fee, crew names, internal notes, access notes, supplier orders' contents.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { evaluateJobCollection } from '@/lib/job-collection'
import { collectionInvoiceFields, loadJobInvoiceFacts } from '@/lib/job-invoice-tax'
import { deriveMaterialsState } from '@/lib/job-materials-state'
import { isTradeActive } from '@/lib/job-trades'
import { resolveJobOpportunityId, resolveJobProposalId } from '@/lib/job-sold-scope'
import type { Terms } from '@/lib/industry-profiles'
import { tradeLabel, type OrgTrade } from '@/lib/org-trades'
import { buildJobStages, installWhen, isQuietJobStatus, type InstallWhen, type JobStage } from '@/lib/portal/job-stages'
import { orgDb } from '@/lib/supabase/org-db'

/** `inProgress`: the day has come (or passed) and the crew is not marked done: "Install in progress" rather than a blank. */
export type PortalJobInstall = { label: string; when: InstallWhen | null; done: boolean; inProgress: boolean }
/**
 * `contactAboutBalance`: a balance we cannot state plainly (an old "close with balance" flag nobody owns): say "contact us", no number.
 * Money is shown only once the job is installed, or an invoice is open, or it is financed (lender name only): before that an insurance
 * or financed job's "balance" is just what has not been paid YET, which is not what the customer owes today.
 */
export type PortalJobMoney = { totalCents: number; paidCents: number; balanceCents: number; paidInFull: boolean; financedThrough: string | null; contactAboutBalance: boolean }
export type PortalJob = {
  id: string
  address: string
  /** Cancelled or on hold: no stage list, just "contact us" (we never say which, or why). */
  quiet: boolean
  stages: JobStage[]
  installs: PortalJobInstall[]
  money: PortalJobMoney | null
}
export type PortalCheckup = { id: string; title: string; when: string; booked: boolean }

const MAX_JOBS = 6
const JOB_COLS = 'id, status, address_text, scheduled_date, materials_status, sale_amount, allow_close_with_balance, close_balance_by, project_id, linked_proposal_id, accepted_proposal_id, created_at'

async function rows<T>(label: string, fn: () => PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<T[]> {
  const { data, error } = await fn()
  if (error) {
    console.error(`portal jobs: ${label} unavailable:`, error.message)
    return []
  }
  return (data ?? []) as T[]
}

type JobRow = {
  id: string; status: string; address_text: string | null; scheduled_date: string | null; materials_status: string | null; sale_amount: number | null
  allow_close_with_balance: boolean | null; close_balance_by: string | null; project_id: string | null; linked_proposal_id: string | null; accepted_proposal_id: string | null; created_at: string
}

export async function loadPortalJobs(
  admin: SupabaseClient,
  orgId: string,
  customerId: string,
  ctx: { today: string; exactDays: number; terms: Pick<Terms, 'install' | 'installed'>; trades: readonly OrgTrade[]; oppIds: readonly string[]; materialsOf: (jobId: string, stored: string | null) => Promise<ReturnType<typeof deriveMaterialsState>> }
): Promise<PortalJob[]> {
  const db = orgDb(admin, orgId)
  const jobs = await rows<JobRow>('jobs', () => db.from('production_jobs').select(JOB_COLS).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(MAX_JOBS))
  if (!jobs.length) return []
  const ids = jobs.map((j) => j.id)

  const [trades, payments, facts, openInvoices] = await Promise.all([
    rows<{ job_id: string; trade: string | null; status: string; scheduled_date: string | null; work_order_type: string | null }>('trades', () =>
      db.from('work_orders').select('job_id, trade, status, scheduled_date, work_order_type').in('job_id', ids).eq('work_order_type', 'install').not('trade', 'is', null)
    ),
    // org-scope-ok: job ids were just loaded for this customer within this company (job_payments has no org_id)
    rows<{ job_id: string; amount_cents: number | null; funding_status: string | null }>('payments', () => admin.from('job_payments').select('job_id, amount_cents, funding_status').in('job_id', ids)),
    loadJobInvoiceFacts(admin, ids).catch(() => new Map()),
    rows<{ job_id: string }>('open invoices', () => db.from('job_invoices').select('job_id').in('job_id', ids).in('status', ['sent', 'partially_paid'])),
  ])
  const jobsWithOpenInvoice = new Set(openInvoices.map((r) => r.job_id))

  const out: PortalJob[] = []
  for (const j of jobs) {
    const quiet = isQuietJobStatus(j.status)
    const base = { id: j.id, address: j.address_text || '', quiet }
    if (quiet) {
      out.push({ ...base, stages: [], installs: [], money: null })
      continue
    }
    const myTrades = trades.filter((t) => t.job_id === j.id && isTradeActive(t))
    const hasScheduledTrade = myTrades.some((t) => !!t.scheduled_date)
    const early = j.status === 'sold' || j.status === 'materials'
    const materials = early ? await ctx.materialsOf(j.id, j.materials_status).catch(() => deriveMaterialsState({ stored: j.materials_status })) : deriveMaterialsState({ stored: j.materials_status })
    const jobFacts = facts.get(j.id)
    const collection = evaluateJobCollection({
      saleAmount: j.sale_amount,
      payments: payments.filter((p) => p.job_id === j.id).map((p) => ({ amount_cents: p.amount_cents, funding_status: p.funding_status })),
      allowCloseWithBalance: j.allow_close_with_balance,
      closeBalanceBy: j.close_balance_by,
      ...(jobFacts ? collectionInvoiceFields(jobFacts) : {}),
    })
    out.push({
      ...base,
      stages: buildJobStages({ status: j.status, materialsKey: materials.key, hasScheduledTrade, paidInFull: collection.paidInFull }, ctx.terms),
      installs: myTrades
        .filter((t) => t.status === 'completed' || !!t.scheduled_date)
        .sort((a, b) => String(a.scheduled_date ?? '9').localeCompare(String(b.scheduled_date ?? '9')))
        .map((t) => {
          const done = t.status === 'completed'
          const when = done ? null : installWhen(t.scheduled_date, ctx.today, ctx.exactDays)
          return { label: tradeLabel(t.trade, ctx.trades), when, done, inProgress: !done && !when && !!t.scheduled_date && t.scheduled_date < ctx.today }
        })
        .filter((t) => t.done || t.when || t.inProgress),
      money: collection.missingSaleAmount
        ? null
        : {
            totalCents: Math.max(0, collection.requiredCents),
            paidCents: Math.max(0, collection.collectedCents),
            balanceCents: Math.max(0, collection.remainingCents),
            paidInFull: collection.paidInFull,
            financedThrough: null,
            // Not paid by payments, not forced by a super admin, but an old close-with-balance flag exists: no number, just "contact us".
            contactAboutBalance: !collection.paidInFull && collection.legacyCloseWithBalance && collection.remainingCents > 0,
          },
        // Shown below only once installed or invoiced (the set is read again after the lender lookup).
    })
  }

  // "Financed through <lender>" only: the lender's name from the signed contract on THIS customer's own deal. No loan terms.
  const lenderOf = new Map<string, string>()
  if (ctx.oppIds.length) {
    const contracts = await rows<{ opportunity_id: string; payment_method: string | null; finance_company: string | null }>('finance', () =>
      db.from('order_form_contracts').select('opportunity_id, payment_method, finance_company').in('opportunity_id', ctx.oppIds.slice(0, 150)).eq('status', 'completed').eq('payment_method', 'finance')
    )
    if (contracts.length) {
      for (const j of jobs) {
        if (!out.find((o) => o.id === j.id)?.money) continue
        const proposalId = await resolveJobProposalId(admin, orgId, j).catch(() => null)
        const oppId = await resolveJobOpportunityId(admin, orgId, proposalId, j.project_id, j.address_text).catch(() => null)
        const c = oppId ? contracts.find((x) => x.opportunity_id === oppId && (x.finance_company || '').trim()) : null
        if (c) lenderOf.set(j.id, String(c.finance_company).trim().slice(0, 80))
      }
    }
  }
  const INSTALLED = new Set(['complete', 'collected'])
  for (const o of out) {
    const lender = lenderOf.get(o.id)
    if (o.money && lender) o.money = { ...o.money, financedThrough: lender }
    const status = jobs.find((j) => j.id === o.id)?.status ?? ''
    // Before the install (and with no open invoice) a balance is only "not paid yet": show nothing, or just the lender.
    if (o.money && !lender && !INSTALLED.has(status) && !jobsWithOpenInvoice.has(o.id)) o.money = null
  }
  return out
}

/** Open checkups (due soon / booked) on this customer's jobs, in plain words. Never the result, notes or who is assigned. */
export async function loadPortalCheckups(admin: SupabaseClient, orgId: string, jobIds: readonly string[]): Promise<PortalCheckup[]> {
  if (!jobIds.length) return []
  const list = await rows<{ id: string; kind: string; due_on: string; status: string; booked_for: string | null }>('checkups', () =>
    orgDb(admin, orgId).from('job_checkups').select('id, kind, due_on, status, booked_for').in('production_job_id', jobIds.slice(0, 150)).in('status', ['due', 'booked']).order('due_on', { ascending: true }).limit(6)
  )
  return list.map((c) => ({
    id: c.id,
    title: c.kind === 'inspection' ? 'Checkup' : 'Check-in call',
    when: c.status === 'booked' && c.booked_for ? c.booked_for : c.due_on,
    booked: c.status === 'booked' && !!c.booked_for,
  }))
}

