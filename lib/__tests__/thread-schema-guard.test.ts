/**
 * @jest-environment node
 */
import { guardThreadSchema } from '@/lib/threads/route-guard'
import { isThreadSchemaMissing, SCHEMA_PENDING_MESSAGE } from '@/lib/threads/schema-guard'

describe('code live before migration 202610270010', () => {
  it('recognises every shape of "that column/table is not there yet"', () => {
    for (const e of [
      { code: '42703', message: 'column activities.audience does not exist' },
      { code: '42P01', message: 'relation "threads" does not exist' },
      { code: 'PGRST204', message: "Could not find the 'audience' column of 'activities' in the schema cache" },
      { code: 'PGRST205', message: "Could not find the table 'public.threads' in the schema cache" },
      { message: 'column "restricted_pricing" of relation "activities" does not exist' },
    ]) expect(isThreadSchemaMissing(e)).toBe(true)
    for (const e of [null, undefined, { code: '23505', message: 'duplicate key value' }, { code: '42501', message: 'permission denied' }, new Error('boom')]) expect(isThreadSchemaMissing(e)).toBe(false)
  })

  it('a thread route answers 503 schema_pending (retryable, clear) instead of crashing', async () => {
    const handler = guardThreadSchema(async () => {
      throw { code: '42703', message: 'column activities.audience does not exist' }
    })
    const res = await handler()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: SCHEMA_PENDING_MESSAGE, code: 'schema_pending' })
    expect(res.headers.get('Retry-After')).toBe('60')
  })

  it('every other error still propagates (a real bug is never swallowed as "upgrading")', async () => {
    await expect(guardThreadSchema(async () => { throw new Error('boom') })()).rejects.toThrow('boom')
    const ok = await guardThreadSchema(async () => new Response('{}', { status: 200 }))()
    expect(ok.status).toBe(200)
  })
})
