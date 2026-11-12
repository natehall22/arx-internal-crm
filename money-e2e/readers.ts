/**
 * "The SAME number from every reader." Each reader here is the app's own code path for showing that number to a person (or to
 * QuickBooks). `agree()` fails naming the two readers that disagree, so a failure reads like a bug report.
 */
import { admin, cents, sql } from './world'
import { getJobPaymentSummary } from '@/lib/job-payments'
import { loadJobCostLedger, ledgerSummaryFor, jobDirectCost } from '@/lib/job-cost-ledger'
import { loadPortalHome } from '@/lib/portal/data'
import type { FakeQbCompany } from '@/lib/test-helpers/fake-qb'
import { GET as opsBoardGET } from '@/app/api/ops/jobs/route'

export type Named = Record<string, number | boolean | string | null | undefined>

/** Fails with a message naming the first two readers whose values differ. */
export function agree(what: string, readers: Named): void {
  const entries = Object.entries(readers).filter(([, v]) => v !== undefined)
  if (entries.length < 2) throw new Error(`agree(${what}): needs at least two readers, got ${entries.map(([k]) => k).join(',')}`)
  const [firstName, first] = entries[0]
  for (const [name, v] of entries.slice(1)) {
    if (v !== first) throw new Error(`MONEY DISAGREEMENT on ${what}: ${firstName} says ${String(first)} but ${name} says ${String(v)}   [all: ${entries.map(([k, x]) => `${k}=${String(x)}`).join(' | ')}]`)
  }
}

export async function opsBoardJob(jobId: string): Promise<Record<string, any> | undefined> {
  const res = await opsBoardGET(new Request('http://x/api/ops/jobs'))
  const body = await res.json()
  if (!res.ok) throw new Error(`ops board ${res.status}: ${JSON.stringify(body)}`)
  return (body.jobs as any[]).find((j) => j.id === jobId)
}

export const rptJob = (jobId: string) => sql<any>(`select * from rpt_jobs where job_id='${jobId}'`)[0]
export const rptPayments = (jobId: string) => sql<any>(`select * from rpt_payments where job_id='${jobId}'`)
export const rptCosts = (jobId: string) => sql<any>(`select * from rpt_job_costs where job_id='${jobId}'`)

export async function jobPageMoney(jobId: string) {
  const s = await getJobPaymentSummary(admin(), jobId)
  const ledger = await loadJobCostLedger(admin(), (await admin().from('production_jobs').select('org_id').eq('id', jobId).single()).data!.org_id, [jobId])
  return { summary: s!, cost: ledgerSummaryFor(ledger, jobId) }
}

export async function portalJobMoney(orgId: string, customerId: string, jobId: string) {
  const home = await loadPortalHome(admin(), { sessionId: 'money-e2e', orgId, customerId })
  const j = (home?.jobs ?? []).find((x: any) => x.id === jobId) as any
  return j?.money as { totalCents: number; paidCents: number; balanceCents: number; paidInFull: boolean } | undefined
}

/** What QuickBooks holds for one job's sale invoice (cents): the invoice total, and the gross of the payments applied to it. */
export function qbSale(company: FakeQbCompany, docNumberLike: string) {
  const invoices = company.all('Invoice').filter((i) => String(i.DocNumber ?? '').startsWith(docNumberLike))
  const ids = new Set(invoices.map((i) => i.Id))
  const paid = company.all('Payment').reduce((t, p) => t + ((p.Line ?? []) as any[]).filter((l) => l.LinkedTxn?.some((x: any) => ids.has(x.TxnId))).reduce((a, l) => a + cents(l.Amount), 0), 0)
  return { invoices, invoiceCents: invoices.reduce((t, i) => t + cents(i.TotalAmt), 0), paymentCents: paid, customers: company.all('Customer').length }
}
