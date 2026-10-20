import { reinstateCancelledJob } from '@/lib/job-cancellation'

function fakeSupabase(job: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = []
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: job }),
    update: (patch: Record<string, unknown>) => {
      updates.push(patch)
      return chain
    },
    insert: async () => ({}),
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  }
  return { client: { from: () => chain } as any, updates }
}

const base = { orgId: 'o', jobId: 'j', projectId: 'p', userId: null }
const cancelled = { id: 'j', status: 'cancelled', cancellation_reason: 'other', cancellation_notes: null }

describe('reinstateCancelledJob commission base', () => {
  it('moves the base with the re-signed price, using the job fee when none is passed', async () => {
    const { client, updates } = fakeSupabase({ ...cancelled, dealer_fee_amount: 500 })
    await reinstateCancelledJob(client, { ...base, saleAmount: 10000 })
    expect(updates[0]).toMatchObject({ sale_amount: 10000, commission_comp_base: 9500 })
  })

  it('uses the fee passed for the new deal (null = no fee)', async () => {
    const { client, updates } = fakeSupabase({ ...cancelled, dealer_fee_amount: 500 })
    await reinstateCancelledJob(client, { ...base, saleAmount: 10000, dealerFeeAmount: null })
    expect(updates[0]).toMatchObject({ commission_comp_base: 10000 })
  })

  it('leaves the base alone when no sale amount is given', async () => {
    const { client, updates } = fakeSupabase({ ...cancelled, dealer_fee_amount: null })
    await reinstateCancelledJob(client, { ...base, saleAmount: null })
    expect(updates[0]).not.toHaveProperty('commission_comp_base')
  })
})
