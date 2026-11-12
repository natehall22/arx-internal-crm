/** Client-safe half of lib/job-commission-actual.ts (the types, the labels and the profit arithmetic, integer cents). */

export type JobCommissionSource = 'paid' | 'planned' | 'estimate'
export type JobCommission = { cents: number; source: JobCommissionSource }

/** Pure: gross profit in cents — contract minus every direct cost (dealer fee included once) minus commission. null when commission is unknown. */
export function jobProfitCents(input: { saleCents: number; directCostCents: number; commissionCents: number | null }): { profitCents: number; percent: number | null } | null {
  if (input.commissionCents == null) return null
  const profitCents = input.saleCents - input.directCostCents - input.commissionCents
  return { profitCents, percent: input.saleCents > 0 ? (profitCents / input.saleCents) * 100 : null }
}

export const COMMISSION_SOURCE_LABEL: Record<JobCommissionSource, string> = {
  paid: 'paid',
  planned: 'pays next week',
  estimate: 'estimate',
}
