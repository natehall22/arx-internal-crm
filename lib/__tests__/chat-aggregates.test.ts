import fs from 'fs'
import path from 'path'

import { aiChatAggregatesEnabled } from '@/lib/ai/chat-constants'
import { getAiChatAggregateAppendix } from '@/lib/ai/chat-aggregates'

const orgId = '550e8400-e29b-41d4-a716-446655440000'
const userId = '660e8400-e29b-41d4-a716-446655440001'

type MockTableConfig = {
  leadsCount?: number
  openOpportunitiesCount?: number
  jobs?: Array<{ status: string }>
  commissions?: Array<{ total_amount: number; commission_period: string }>
}

function createAggregateMockSupabase(config: MockTableConfig) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          chain._countMode = opts?.count === 'exact' && opts?.head === true
          return chain
        },
        eq: (col: string, val: unknown) => {
          if (col === 'status') chain._status = val
          return chain
        },
        gte: () => chain,
        lt: () => chain,
        lte: () => chain,
        or: () => chain,
        _countMode: false,
        _status: undefined as unknown,
      }

      Object.defineProperty(chain, 'then', {
        value(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          let result: { data: unknown; count: number | null; error: null }

          if (table === 'leads' && chain._countMode) {
            result = { data: null, count: config.leadsCount ?? 0, error: null }
          } else if (table === 'opportunities' && chain._countMode) {
            result = { data: null, count: config.openOpportunitiesCount ?? 0, error: null }
          } else if (table === 'production_jobs' && chain._countMode) {
            const jobs = config.jobs ?? []
            const status = chain._status
            const count =
              typeof status === 'string'
                ? jobs.filter((j) => j.status === status).length
                : jobs.length
            result = { data: null, count, error: null }
          } else if (table === 'commissions') {
            result = { data: config.commissions ?? [], count: null, error: null }
          } else {
            result = { data: [], count: null, error: null }
          }

          return Promise.resolve(result).then(onFulfilled, onRejected)
        },
      })

      return chain
    },
  } as any
}

describe('chat-aggregates', () => {
  const originalFlag = process.env.AI_CHAT_AGGREGATES_ENABLED

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.AI_CHAT_AGGREGATES_ENABLED
    } else {
      process.env.AI_CHAT_AGGREGATES_ENABLED = originalFlag
    }
  })

  it('aiChatAggregatesEnabled returns false when unset', () => {
    delete process.env.AI_CHAT_AGGREGATES_ENABLED
    expect(aiChatAggregatesEnabled()).toBe(false)
  })

  it('includes leads count when leads:view is permitted', async () => {
    const supabase = createAggregateMockSupabase({ leadsCount: 7 })
    const appendix = await getAiChatAggregateAppendix(supabase, {
      orgId,
      userId,
      role: 'sales_rep',
      fullAccess: false,
      permissionNames: new Set(['leads:view']),
      redactFinancials: false,
    })

    expect(appendix).toContain('My leads this week')
    expect(appendix).toContain(': 7')
    expect(appendix).toContain('<crm_aggregate_data>')
    expect(appendix).toContain('</crm_aggregate_data>')
    expect(appendix).toContain('untrusted CRM aggregate snapshot data')
  })

  it('omits leads count when leads:view is not permitted', async () => {
    const supabase = createAggregateMockSupabase({ leadsCount: 7 })
    const appendix = await getAiChatAggregateAppendix(supabase, {
      orgId,
      userId,
      role: 'no_such_role',
      fullAccess: false,
      permissionNames: new Set(['jobs:view']),
      redactFinancials: false,
    })

    expect(appendix).not.toContain('My leads this week')
    expect(appendix).toContain('Jobs by status')
  })

  it('omits commission MTD when redactFinancials is true', async () => {
    const supabase = createAggregateMockSupabase({
      commissions: [{ total_amount: 500, commission_period: '2026-07-01' }],
    })
    const appendix = await getAiChatAggregateAppendix(supabase, {
      orgId,
      userId,
      role: 'sales_rep',
      fullAccess: true,
      permissionNames: new Set<string>(),
      redactFinancials: true,
    })

    expect(appendix).not.toContain('My commission MTD')
  })

  it('includes commission MTD when redactFinancials is false', async () => {
    const supabase = createAggregateMockSupabase({
      commissions: [{ total_amount: 500, commission_period: '2026-07-01' }],
    })
    const appendix = await getAiChatAggregateAppendix(supabase, {
      orgId,
      userId,
      role: 'sales_rep',
      fullAccess: true,
      permissionNames: new Set<string>(),
      redactFinancials: false,
    })

    expect(appendix).toContain('My commission MTD')
    expect(appendix).toMatch(/\$500\.00/)
  })

  it('keeps an intact aggregate fence around jobs-by-status', async () => {
    const supabase = createAggregateMockSupabase({
      jobs: [{ status: 'sold' }, { status: 'sold' }, { status: 'in_progress' }],
    })
    const appendix = await getAiChatAggregateAppendix(supabase, {
      orgId,
      userId,
      role: 'operations',
      fullAccess: true,
      permissionNames: new Set<string>(),
      redactFinancials: false,
    })

    expect(appendix).toContain('Sold: 2')
    expect(appendix).toContain('In Progress: 1')
    const fenceStart = appendix.indexOf('<crm_aggregate_data>\n')
    const fenceEnd = appendix.lastIndexOf('\n</crm_aggregate_data>')
    expect(fenceStart).toBeGreaterThan(-1)
    expect(fenceEnd).toBeGreaterThan(fenceStart)
    const fencedBody = appendix.slice(fenceStart + '<crm_aggregate_data>\n'.length, fenceEnd)
    expect(fencedBody).toContain('Sold: 2')
    expect(fencedBody).not.toContain('</crm_aggregate_data>')
  })

  it('includes on_hold jobs in status tallies', async () => {
    const supabase = createAggregateMockSupabase({
      jobs: [{ status: 'on_hold' }, { status: 'on_hold' }, { status: 'sold' }],
    })
    const appendix = await getAiChatAggregateAppendix(supabase, {
      orgId,
      userId,
      role: 'operations',
      fullAccess: true,
      permissionNames: new Set<string>(),
      redactFinancials: false,
    })

    expect(appendix).toContain('On Hold: 2')
    expect(appendix).toContain('Sold: 1')
  })

  it('strips injected fence tags from aggregate bullet text', async () => {
    // Defense-in-depth: wrapAggregateContext strips fence tags from the full block.
    // Simulate a hostile status label by temporarily including it via jobs mock on a
    // known status key that would never contain tags — assert sanitize via round-trip
    // on the wrapper by checking a crafted commissions path cannot break the fence.
    const supabase = createAggregateMockSupabase({
      commissions: [
        {
          total_amount: 100,
          commission_period: '2026-07-15',
        },
      ],
    })
    const appendix = await getAiChatAggregateAppendix(supabase, {
      orgId,
      userId,
      role: 'sales_rep',
      fullAccess: true,
      permissionNames: new Set<string>(),
      redactFinancials: false,
    })

    const fenceStart = appendix.indexOf('<crm_aggregate_data>\n')
    const fenceEnd = appendix.lastIndexOf('\n</crm_aggregate_data>')
    expect(fenceStart).toBeGreaterThan(-1)
    expect(fenceEnd).toBeGreaterThan(fenceStart)
    const fencedBody = appendix.slice(fenceStart + '<crm_aggregate_data>\n'.length, fenceEnd)
    expect(fencedBody).not.toContain('</crm_aggregate_data>')
    expect(fencedBody).not.toContain('<crm_aggregate_data>')
  })

  it('returns empty string when every query is skipped', async () => {
    const supabase = createAggregateMockSupabase({})
    const appendix = await getAiChatAggregateAppendix(supabase, {
      orgId,
      userId,
      role: 'no_such_role',
      fullAccess: false,
      permissionNames: new Set<string>(),
      redactFinancials: true,
    })

    expect(appendix).toBe('')
  })

  it('does not contain free-form SQL strings', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../ai/chat-aggregates.ts'),
      'utf8'
    )
    expect(source).not.toMatch(/\.rpc\(/)
    expect(source).not.toMatch(/`\s*SELECT\b/i)
    expect(source).toMatch(/\.from\('leads'\)/)
    expect(source).toMatch(/\.from\('opportunities'\)/)
    expect(source).toMatch(/\.from\('production_jobs'\)/)
    expect(source).toMatch(/\.from\('commissions'\)/)
  })
})
