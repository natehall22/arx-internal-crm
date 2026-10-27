import { ensureJobForSignedContract, jobTypeFromContractScope } from '@/lib/contract-job'

const base = { org_id: 'o1', created_by: 'u1', project_cost: 2035.2, payment_method: 'cash' }
const scope = (o: Record<string, boolean>) => ({ scope_roof_replacement: false, scope_roof_repair: false, scope_siding: false, scope_gutters: false, ...o })

describe('jobTypeFromContractScope', () => {
  it('maps every scope to a type', () => {
    expect(jobTypeFromContractScope(scope({ scope_roof_replacement: true, scope_gutters: true }))).toBe('roofing')
    expect(jobTypeFromContractScope(scope({ scope_roof_repair: true }))).toBe('roofing')
    expect(jobTypeFromContractScope(scope({ scope_siding: true, scope_gutters: true }))).toBe('siding')
    expect(jobTypeFromContractScope(scope({ scope_gutters: true }))).toBe('gutters')
    expect(jobTypeFromContractScope(scope({}))).toBe('mixed')
  })
})

/** Minimal client: production_jobs lookup finds nothing; inserts are recorded and may be rejected by a job_type CHECK. */
function stubClient(rejectTypes: string[]) {
  const inserted: Record<string, unknown>[] = []
  const chain = (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, update: () => q, maybeSingle: async () => ({ data: null }),
      insert: (row: Record<string, unknown>) => {
        if (table === 'production_jobs') {
          inserted.push(row)
          const rejected = rejectTypes.includes(String(row.job_type))
          q.single = async () => (rejected ? { data: null, error: { code: '23514', message: 'job_type check' } } : { data: { id: 'job1', job_number: '26-0050' }, error: null })
        } else q.single = async () => ({ data: null, error: null })
        return q
      },
    }
    return q
  }
  return { client: { from: chain } as any, inserted }
}

describe('ensureJobForSignedContract', () => {
  it('creates a gutters-only job', async () => {
    const { client, inserted } = stubClient([])
    const r = await ensureJobForSignedContract(client, { contract: { ...base, ...scope({ scope_gutters: true }) }, projectId: 'p1', customerId: 'c1', salespersonId: 'u1', actorUserId: null, agreementLabel: 'Installation Agreement' })
    expect(r.jobId).toBe('job1')
    expect(inserted[0].job_type).toBe('gutters')
  })

  it('a job_type the database rejects is retried as mixed, never dropped', async () => {
    const { client, inserted } = stubClient(['gutters'])
    const r = await ensureJobForSignedContract(client, { contract: { ...base, ...scope({ scope_gutters: true }) }, projectId: 'p1', customerId: 'c1', salespersonId: 'u1', actorUserId: null, agreementLabel: 'Installation Agreement' })
    expect(r.jobId).toBe('job1')
    expect(inserted.map((i) => i.job_type)).toEqual(['gutters', 'mixed'])
  })

  it('reports an error when even the retry fails', async () => {
    const { client } = stubClient(['gutters', 'mixed'])
    const r = await ensureJobForSignedContract(client, { contract: { ...base, ...scope({ scope_gutters: true }) }, projectId: 'p1', customerId: null, salespersonId: null, actorUserId: null, agreementLabel: 'x' })
    expect(r.jobId).toBeNull()
    expect(r.error).toMatch(/check/)
  })
})
