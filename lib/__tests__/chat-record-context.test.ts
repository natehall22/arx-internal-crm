import {
  canAccessAiChatRecordContext,
  getAiChatRecordContextAppendix,
} from '@/lib/ai/chat-record-context'

function createMockSupabase(rows: Record<string, unknown>) {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          if (col === 'id') chain._id = val
          if (col === 'org_id') chain._org = val
          return chain
        },
        maybeSingle: async () => {
          const key = `${table}:${chain._id}`
          const row = rows[key]
          return { data: row ?? null, error: null }
        },
        _id: '' as unknown,
        _org: '' as unknown,
      }
      return chain
    },
  } as any
}

describe('chat-record-context', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000'
  const leadId = '660e8400-e29b-41d4-a716-446655440001'

  it('excludes phone email and notes from lead context', async () => {
    const supabase = createMockSupabase({
      [`leads:${leadId}`]: {
        homeowner_name: 'Jane Doe',
        address_text: '123 Main St',
        status: 'new',
        source: 'canvass',
        phone: '555-1234',
        email: 'jane@example.com',
        notes: 'Secret note',
      },
    })

    const appendix = await getAiChatRecordContextAppendix(supabase, orgId, {
      type: 'lead',
      id: leadId,
    })

    expect(appendix).toContain('Jane Doe')
    expect(appendix).toContain('123 Main St')
    expect(appendix).not.toContain('555-1234')
    expect(appendix).not.toContain('jane@example.com')
    expect(appendix).not.toContain('Secret note')
    expect(appendix).toContain('no contact PII')
  })

  it('returns ops job context with materials tab hint', async () => {
    const jobId = '770e8400-e29b-41d4-a716-446655440002'
    const supabase = createMockSupabase({
      [`production_jobs:${jobId}`]: {
        job_number: 'J-100',
        address_text: '9 Oak Ave',
        status: 'in_progress',
        materials_status: 'ordered',
      },
    })

    const appendix = await getAiChatRecordContextAppendix(supabase, orgId, {
      type: 'job',
      id: jobId,
    })

    expect(appendix).toContain('J-100')
    expect(appendix).toContain('Materials tab')
    expect(appendix).toContain(`/ops/jobs/${jobId}`)
  })

  it('rejects invalid context ids', async () => {
    const supabase = createMockSupabase({})
    const appendix = await getAiChatRecordContextAppendix(supabase, orgId, {
      type: 'lead',
      id: 'bad-id',
    })
    expect(appendix).toBe('')
  })

  it('blocks job context when user lacks jobs:view', async () => {
    const jobId = '770e8400-e29b-41d4-a716-446655440002'
    const supabase = createMockSupabase({
      [`production_jobs:${jobId}`]: {
        job_number: 'J-100',
        address_text: '9 Oak Ave',
        status: 'in_progress',
        materials_status: 'ordered',
      },
    })

    const appendix = await getAiChatRecordContextAppendix(
      supabase,
      orgId,
      { type: 'job', id: jobId },
      { role: 'setter', fullAccess: false, permissionNames: new Set(['leads:view']) }
    )

    expect(appendix).toBe('')
  })

  it('blocks project context for appointment-setting roles', async () => {
    const projectId = '880e8400-e29b-41d4-a716-446655440003'
    const supabase = createMockSupabase({
      [`projects:${projectId}`]: {
        address_text: '1 Pine Rd',
        status: 'in_progress',
        contract_value: 25000,
      },
    })

    const appendix = await getAiChatRecordContextAppendix(
      supabase,
      orgId,
      { type: 'project', id: projectId },
      { role: 'setter', fullAccess: false, permissionNames: new Set(['projects:view']) }
    )

    expect(appendix).toBe('')
  })

  it('redacts opportunity estimated value for sales-doc barred roles', async () => {
    const oppId = '990e8400-e29b-41d4-a716-446655440004'
    const supabase = createMockSupabase({
      [`opportunities:${oppId}`]: {
        address_text: '2 Elm St',
        status: 'open',
        estimated_value: 18000,
      },
    })

    const appendix = await getAiChatRecordContextAppendix(
      supabase,
      orgId,
      { type: 'opportunity', id: oppId },
      { role: 'inside_sales', fullAccess: false, permissionNames: new Set(['opportunities:view']) }
    )

    expect(appendix).toContain('2 Elm St')
    expect(appendix).not.toContain('18000')
    expect(appendix).not.toContain('Estimated Value')
  })
})

describe('canAccessAiChatRecordContext', () => {
  it('allows operations users to load job context', () => {
    expect(
      canAccessAiChatRecordContext(
        { role: 'operations', fullAccess: false, permissionNames: new Set(['jobs:view']) },
        'job'
      )
    ).toBe(true)
  })

  it('denies setters job and project context', () => {
    const access = { role: 'setter', fullAccess: false, permissionNames: new Set(['leads:view']) }
    expect(canAccessAiChatRecordContext(access, 'job')).toBe(false)
    expect(canAccessAiChatRecordContext(access, 'project')).toBe(false)
  })
})
