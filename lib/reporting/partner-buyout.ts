/**
 * Partner buyout calculator — a fixed amount plus a percentage of the net cash on named jobs, paid in
 * equal installments. Built for the Evan Pay and Exit Agreement (signed 2026-09-01), but nothing about
 * Evan is hardcoded: the fixed amount, share %, job list and installment count are all inputs, so the
 * agreement text — not this file — stays the source of truth. Feed each job's `netProfit` from the
 * job ledger (lib/reporting/job-ledger.ts). "Net cash" = what's left after everyone has been paid
 * (Nathan, Oct 9 2026): costs, sales comp, OPP 9%, the 4-way owners draw (20% of gross profit) and
 * allocated overhead — exactly the ledger's netProfit.
 *
 * Read-only math. It does not create payroll lines or change anyone's pay.
 */
import { roundMoney } from '@/lib/money'

export type BuyoutJobInput = {
  id: string
  label?: string
  /** Net cash: what's left after everyone has been paid (costs, sales comp, OPP, 4-way owners draw, overhead). null = not final yet. */
  netCash: number | null
}

export type BuyoutInput = {
  fixedAmount: number
  /** e.g. 0.25 for 25% */
  sharePct: number
  jobs: BuyoutJobInput[]
  installments: number
  /** Agreement-specific: whether a job that lost money reduces the total. Default true (net). */
  lossesReduceTotal?: boolean
}

export type BuyoutResult = {
  jobShares: Array<{ id: string; label?: string; netCash: number | null; share: number | null }>
  variableTotal: number
  total: number
  /** true while any listed job has no final net cash — the total is provisional. */
  provisional: boolean
  pendingJobs: string[]
  installments: number[]
}

/** Split an amount into n payments that add back exactly; leftover cents go one each to the first payments. */
export function splitInstallments(total: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1) throw new Error('installments must be a positive integer')
  const cents = Math.round(total * 100)
  const base = Math.trunc(cents / n)
  let remainder = cents - base * n
  const step = remainder >= 0 ? 1 : -1
  return Array.from({ length: n }, () => {
    let c = base
    if (remainder !== 0) {
      c += step
      remainder -= step
    }
    return c / 100
  })
}

export function computeBuyout(input: BuyoutInput): BuyoutResult {
  if (!(input.sharePct >= 0 && input.sharePct <= 1)) throw new Error('sharePct must be a fraction between 0 and 1 (0.25 = 25%)')
  const lossesReduce = input.lossesReduceTotal !== false
  const jobShares = input.jobs.map((j) => {
    if (j.netCash == null || !Number.isFinite(j.netCash)) return { id: j.id, label: j.label, netCash: null, share: null }
    const base = lossesReduce ? j.netCash : Math.max(0, j.netCash)
    return { id: j.id, label: j.label, netCash: j.netCash, share: roundMoney(base * input.sharePct) }
  })
  const variableTotal = roundMoney(jobShares.reduce((s, j) => s + (j.share ?? 0), 0))
  const total = roundMoney(input.fixedAmount + variableTotal)
  const pendingJobs = jobShares.filter((j) => j.share == null).map((j) => j.id)
  return {
    jobShares,
    variableTotal,
    total,
    provisional: pendingJobs.length > 0,
    pendingJobs,
    installments: splitInstallments(total, input.installments),
  }
}
