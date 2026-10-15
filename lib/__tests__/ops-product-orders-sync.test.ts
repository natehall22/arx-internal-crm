import { syncJobMaterialCost } from '@/lib/ops-product-orders'

/** Minimal in-memory stand-in for the two tables syncJobMaterialCost touches. */
function fakeSupabase(job: { material_cost: number | null }, orders: Array<{ amount: number; status: string }>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      let patch: Record<string, unknown> | null = null
      const q: any = {
        select: () => q,
        update: (p: Record<string, unknown>) => ((patch = p), q),
        eq: (col: string, val: unknown) => (filters.push([col, val]), q),
        is: (col: string, val: unknown) => (filters.push([col, val]), q),
        single: async () => ({ data: { material_cost: job.material_cost }, error: null }),
        then: (resolve: (v: unknown) => void) => {
          if (table === 'job_product_orders') return resolve({ data: orders, error: null })
          const guard = filters.find(([c]) => c === 'material_cost')
          const matches = !guard || job.material_cost === guard[1]
          if (patch && matches) job.material_cost = patch.material_cost as number | null
          resolve({ data: patch && matches ? [{ id: 'job' }] : [], error: null })
        },
      }
      return q
    },
  }
}

describe('syncJobMaterialCost', () => {
  it('seeds an empty column from the order total', async () => {
    const job = { material_cost: null }
    await syncJobMaterialCost(fakeSupabase(job, [{ amount: 500, status: 'ordered' }]), 'org', 'job', 0)
    expect(job.material_cost).toBe(500)
  })

  it('adds a new order on top of a reconciled column instead of replacing it (Cox: $11,318.09 + $8,050 D&R)', async () => {
    const job = { material_cost: 11318.09 }
    await syncJobMaterialCost(fakeSupabase(job, [{ amount: 8050, status: 'ordered' }]), 'org', 'job', 0)
    expect(job.material_cost).toBe(19368.09)
  })

  it('moves by the edit delta and by a deletion, never below zero', async () => {
    const edited = { material_cost: 1000 }
    await syncJobMaterialCost(fakeSupabase(edited, [{ amount: 700, status: 'ordered' }]), 'org', 'job', 600)
    expect(edited.material_cost).toBe(1100)
    const deleted = { material_cost: 100 }
    await syncJobMaterialCost(fakeSupabase(deleted, []), 'org', 'job', 600)
    expect(deleted.material_cost).toBe(0)
  })

  it('leaves a stored column alone when no before-total is given', async () => {
    const job = { material_cost: 4000 }
    await syncJobMaterialCost(fakeSupabase(job, [{ amount: 9, status: 'ordered' }]), 'org', 'job')
    expect(job.material_cost).toBe(4000)
  })
})
