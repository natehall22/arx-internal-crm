/** @jest-environment node */
import { orgDb } from '@/lib/supabase/org-db'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const seed = () =>
  createFakeDb({
    customers: [
      { id: 'c-a', org_id: 'org-a', name: 'A' },
      { id: 'c-b', org_id: 'org-b', name: 'B' },
    ],
  })

test('select / update / delete only ever see the given company', async () => {
  const db = seed()
  const a = orgDb(db.client as never, 'org-a')

  const { data: foreign } = await a.from('customers').select('id, name').eq('id', 'c-b').maybeSingle()
  expect(foreign).toBeNull()
  const { data: all } = await a.from('customers').select('id')
  expect((all ?? []).map((r) => (r as { id: string }).id)).toEqual(['c-a'])

  await a.from('customers').update({ name: 'hacked' }).eq('id', 'c-b')
  await a.from('customers').delete().eq('id', 'c-b')
  expect(db.tables.customers).toEqual([
    { id: 'c-a', org_id: 'org-a', name: 'A' },
    { id: 'c-b', org_id: 'org-b', name: 'B' },
  ])

  await a.from('customers').update({ name: 'A2' }).eq('id', 'c-a')
  expect(db.tables.customers[0].name).toBe('A2')
})

test('insert stamps the company and refuses a row naming another one', async () => {
  const db = seed()
  const a = orgDb(db.client as never, 'org-a')
  await a.from('customers').insert({ id: 'c-new', name: 'N' })
  await a.from('customers').insert([{ id: 'c-n2', name: 'N2', org_id: 'org-a' }])
  expect(db.tables.customers.filter((r) => r.id === 'c-new' || r.id === 'c-n2').map((r) => r.org_id)).toEqual(['org-a', 'org-a'])
  expect(() => a.from('customers').insert({ id: 'c-x', org_id: 'org-b' })).toThrow(/different company/)
})

test('update may not move a row to another company and does not add org_id itself', async () => {
  const db = seed()
  const patches: Record<string, unknown>[] = []
  const client = {
    from: (t: string) => {
      const b = (db.client as unknown as { from: (t: string) => { update: (v: Record<string, unknown>, o?: unknown) => unknown } }).from(t)
      const real = b.update.bind(b)
      b.update = (v, o) => {
        patches.push(v)
        return real(v, o)
      }
      return b
    },
  }
  const a = orgDb(client as never, 'org-a')
  expect(() => a.from('customers').update({ org_id: 'org-b' })).toThrow(/different company/)
  await a.from('customers').update({ name: 'A3' }).eq('id', 'c-a')
  expect(patches).toEqual([{ name: 'A3' }])
  expect(db.tables.customers[0]).toMatchObject({ id: 'c-a', org_id: 'org-a', name: 'A3' })
})

test('upsert needs org_id in onConflict (a key-only upsert can overwrite another company)', () => {
  const db = seed()
  const a = orgDb(db.client as never, 'org-a')
  expect(() => a.from('customers').upsert({ id: 'c-b', name: 'x' }, { onConflict: 'id' })).toThrow(/onConflict must include org_id/)
  expect(() => a.from('customers').upsert({ id: 'c-b', name: 'x' }, { onConflict: 'org_id,id' })).not.toThrow()
})

test('a blank company is refused, never treated as "every company"', () => {
  const db = seed()
  expect(() => orgDb(db.client as never, '')).toThrow(/orgId is required/)
  expect(() => orgDb(db.client as never, '  ')).toThrow(/orgId is required/)
  expect(() => orgDb(db.client as never, undefined as never)).toThrow(/orgId is required/)
})
