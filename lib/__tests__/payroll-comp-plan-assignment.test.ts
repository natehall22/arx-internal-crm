import { loadActiveCompPlanForUser } from '@/lib/payroll-export'

function clientReturning(result: { data: unknown; error: unknown }) {
  const tables: string[] = []
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'lte', 'or', 'order', 'limit']) {
    chain[method] = jest.fn(() => chain)
  }
  chain.maybeSingle = jest.fn(async () => result)
  return {
    client: {
      from: jest.fn((table: string) => {
        tables.push(table)
        return chain
      }),
    },
    tables,
  }
}

describe('loadActiveCompPlanForUser', () => {
  it('keeps an unassigned historical timeframe blank instead of using the org default', async () => {
    const { client, tables } = clientReturning({ data: null, error: null })
    const result = await loadActiveCompPlanForUser(
      client as never,
      'user-1',
      'org-1',
      '2026-01-15'
    )

    expect(result).toBeNull()
    expect(tables).toEqual(['user_comp_plans'])
  })

  it('fails closed when assignment history cannot be read', async () => {
    const readError = new Error('assignment read failed')
    const { client } = clientReturning({ data: null, error: readError })
    await expect(
      loadActiveCompPlanForUser(client as never, 'user-1', 'org-1', '2026-01-15')
    ).rejects.toBe(readError)
  })
})
