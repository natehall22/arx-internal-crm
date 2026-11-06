/** @jest-environment node */
/**
 * THE per-key settings writer (merge_org_settings): both callers (job catch-up at the top level, brand at ['brand']),
 * null settings, a missing org, and the "function missing → per-key fallback" rule (only PGRST202 / 42883).
 */
import { saveBrandSettings } from '@/lib/org-brand'
import { mergeOrgSettings, mergeSettingsAt } from '@/lib/org-settings'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const ORG = 'org-1'

/** A fake whose rpc behaves like the SQL function (or is missing / errors). */
function db(settings: unknown, rpc: 'sql' | 'missing' | { code: string; message: string } = 'sql', orgs = [{ id: ORG, settings }]) {
  const calls: Array<Record<string, unknown>> = []
  const fake = createFakeDb({ orgs: orgs as never })
  const client = {
    ...(fake.client as object),
    from: (t: string) => (fake.client as unknown as { from: (t: string) => unknown }).from(t),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, ...args })
      if (rpc === 'missing') return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}` } }
      if (rpc !== 'sql') return { data: null, error: rpc }
      const org = fake.tables.orgs.find((o) => o.id === args.p_org_id)
      if (!org) return { data: null, error: { code: 'P0002', message: `merge_org_settings: no organization ${args.p_org_id}` } }
      org.settings = mergeSettingsAt(org.settings, args.p_path as string[], args.p_set as Record<string, unknown>, args.p_remove as string[])
      return { data: null, error: null }
    },
  }
  return { client: client as never, calls, settings: () => fake.tables.orgs.find((o) => o.id === ORG)?.settings }
}

describe('mergeSettingsAt (the JS twin of the SQL merge)', () => {
  it('top level and one nested key; other keys kept; null / junk settings start from {}', () => {
    expect(mergeSettingsAt({ a: 1, b: 2 }, [], { c: 3 }, ['b'])).toEqual({ a: 1, c: 3 })
    expect(mergeSettingsAt({ a: 1, brand: { x: 1, y: 2 } }, ['brand'], { z: 3 }, ['y'])).toEqual({ a: 1, brand: { x: 1, z: 3 } })
    expect(mergeSettingsAt(null, ['brand'], { z: 3 })).toEqual({ brand: { z: 3 } })
    expect(mergeSettingsAt('junk', [], { z: 3 })).toEqual({ z: 3 })
    expect(() => mergeSettingsAt({}, ['a', 'b'], {})).toThrow()
  })
})

describe('mergeOrgSettings', () => {
  it('catch-up caller: one rpc at the top level', async () => {
    const d = db({ logo_url: 'l', brand: { shortName: 'A' } })
    expect(await mergeOrgSettings(d.client, ORG, { job_catch_up_enabled: true })).toEqual({ error: null })
    expect(d.calls).toEqual([{ fn: 'merge_org_settings', p_org_id: ORG, p_path: [], p_set: { job_catch_up_enabled: true }, p_remove: [] }])
    expect(d.settings()).toEqual({ logo_url: 'l', brand: { shortName: 'A' }, job_catch_up_enabled: true })
  })

  it('brand caller: saveBrandSettings uses the same function at ["brand"]', async () => {
    const d = db({ logo_url: 'l', brand: { futureKey: 'k', website: 'old', serviceArea: 'S' } })
    expect(await saveBrandSettings(d.client, ORG, { website: 'new', serviceArea: '' })).toEqual({ error: null })
    expect(d.calls).toEqual([{ fn: 'merge_org_settings', p_org_id: ORG, p_path: ['brand'], p_set: { website: 'new' }, p_remove: ['serviceArea'] }])
    expect(d.settings()).toEqual({ logo_url: 'l', brand: { futureKey: 'k', website: 'new' } })
  })

  it('null settings work for both callers', async () => {
    const a = db(null)
    await mergeOrgSettings(a.client, ORG, { job_catch_up_stuck_days: 5 })
    expect(a.settings()).toEqual({ job_catch_up_stuck_days: 5 })
    const b = db(null)
    await saveBrandSettings(b.client, ORG, { shortName: 'Z' })
    expect(b.settings()).toEqual({ brand: { shortName: 'Z' } })
  })

  it('a missing org is an error (the SQL raises), never a fallback write', async () => {
    const d = db({}, 'sql', [])
    expect((await mergeOrgSettings(d.client, ORG, { x: 1 })).error).toMatch(/no organization/)
    expect((await saveBrandSettings(d.client, ORG, { shortName: 'Z' })).error).toMatch(/no organization/)
  })

  it('function missing (PGRST202) → per-key read-merge-write, for both callers, null settings included', async () => {
    const a = db(null, 'missing')
    expect(await mergeOrgSettings(a.client, ORG, { job_catch_up_enabled: true })).toEqual({ error: null })
    expect(a.settings()).toEqual({ job_catch_up_enabled: true })
    const b = db({ logo_url: 'l', brand: { website: 'old', keep: 1 } }, 'missing')
    expect(await saveBrandSettings(b.client, ORG, { website: '' })).toEqual({ error: null })
    expect(b.settings()).toEqual({ logo_url: 'l', brand: { keep: 1 } })
  })

  it('function missing and no org → error, nothing written', async () => {
    const d = db({}, 'missing', [])
    expect((await mergeOrgSettings(d.client, ORG, { x: 1 })).error).toBeTruthy()
  })

  it('any other rpc error (e.g. 42501 permission denied) is returned, not worked around', async () => {
    const d = db({ a: 1 }, { code: '42501', message: 'permission denied for function merge_org_settings' })
    expect((await mergeOrgSettings(d.client, ORG, { x: 1 })).error).toMatch(/permission denied/)
    expect(d.settings()).toEqual({ a: 1 })
  })

  it('brand can never be written at the top level; deeper paths refused; empty patch is a no-op', async () => {
    const d = db({})
    expect((await mergeOrgSettings(d.client, ORG, { brand: { website: 'x' } })).error).toMatch(/saveBrandSettings/)
    expect((await mergeOrgSettings(d.client, ORG, { x: 1 }, { path: ['a', 'b'] })).error).toBeTruthy()
    expect(await mergeOrgSettings(d.client, ORG, {})).toEqual({ error: null })
    expect(d.calls).toHaveLength(0)
  })
})
