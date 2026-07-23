import type { SupabaseClient } from '@supabase/supabase-js'
import { loadBuilderMeasurement } from '@/lib/proposal-builder-measurement'

function queryReturning(data: unknown) {
  const calls: Array<[string, ...unknown[]]> = []
  const query = {
    select: (...args: unknown[]) => {
      calls.push(['select', ...args])
      return query
    },
    eq: (...args: unknown[]) => {
      calls.push(['eq', ...args])
      return query
    },
    order: (...args: unknown[]) => {
      calls.push(['order', ...args])
      return query
    },
    limit: (...args: unknown[]) => {
      calls.push(['limit', ...args])
      return query
    },
    maybeSingle: async () => ({ data }),
  }
  return { query, calls }
}

describe('proposal builder measurement organization scope', () => {
  it('scopes an explicit measurement id to the authenticated organization', async () => {
    const { query, calls } = queryReturning({ id: 'measurement-1' })
    const client = { from: jest.fn(() => query) } as unknown as SupabaseClient

    await loadBuilderMeasurement(client, 'org-1', 'measurement-1', null)

    expect(client.from).toHaveBeenCalledWith('roof_measurements')
    expect(calls).toContainEqual(['eq', 'id', 'measurement-1'])
    expect(calls).toContainEqual(['eq', 'org_id', 'org-1'])
  })

  it('scopes an opportunity-linked measurement to the authenticated organization', async () => {
    const { query, calls } = queryReturning({ id: 'measurement-2' })
    const client = { from: jest.fn(() => query) } as unknown as SupabaseClient

    await loadBuilderMeasurement(client, 'org-1', null, 'opportunity-1')

    expect(client.from).toHaveBeenCalledWith('roof_measurements')
    expect(calls).toContainEqual(['eq', 'opportunity_id', 'opportunity-1'])
    expect(calls).toContainEqual(['eq', 'org_id', 'org-1'])
    expect(calls).toContainEqual(['eq', 'status', 'completed'])
  })
})
