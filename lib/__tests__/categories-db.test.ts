/** @jest-environment node */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { enrichJobsWithCategory, loadOrgCategories, saveCategoryChange, setCustomerCategory, setJobCategory } from '@/lib/categories-db'
import { mergeOrgSettings } from '@/lib/org-settings'

const ORG = 'org-1'
const OTHER = 'org-2'

function setup(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  const merges: Array<Record<string, unknown>> = []
  const db = createFakeDb(
    {
      orgs: [{ id: ORG, settings: { other: 1 } }, { id: OTHER, settings: {} }],
      customers: [
        { id: 'c1', org_id: ORG, category: null },
        { id: 'c2', org_id: ORG, category: 'commercial' },
        { id: 'cx', org_id: OTHER, category: null },
      ],
      production_jobs: [
        { id: 'j1', org_id: ORG, customer_id: 'c2', category: null },
        { id: 'j2', org_id: ORG, customer_id: 'c2', category: 'new_build' },
        { id: 'j3', org_id: ORG, customer_id: null, category: null },
      ],
      ...extra,
    },
    {
      rpc: {
        merge_org_settings: (args, tables) => {
          merges.push(args)
          const org = tables.orgs.find((o) => o.id === args.p_org_id)!
          const path = args.p_path as string[]
          const s = { ...(org.settings as Record<string, unknown>) }
          s[path[0]] = { ...((s[path[0]] as object) ?? {}), ...(args.p_set as object) }
          org.settings = s
          return { data: null, error: null }
        },
      },
    }
  )
  return { db, merges, client: db.client as never }
}

describe('saveCategoryChange', () => {
  it('first save writes the whole list (defaults + the change) with a per-key merge at path [categories]', async () => {
    const { client, merges } = setup()
    const r = await saveCategoryChange(client, ORG, { action: 'add', label: 'Multi family' })
    expect(r.ok).toBe(true)
    expect(merges).toHaveLength(1)
    expect(merges[0]).toMatchObject({ p_org_id: ORG, p_path: ['categories'] })
    expect((merges[0].p_set as { items: Array<{ slug: string }> }).items.map((c) => c.slug)).toEqual(['residential', 'commercial', 'new_build', 'multi_family'])
    expect((await loadOrgCategories(client, ORG)).map((c) => c.slug)).toContain('multi_family')
  })
  it('rename then turn off, and the company-2 list is untouched', async () => {
    const { client } = setup()
    await saveCategoryChange(client, ORG, { action: 'rename', slug: 'commercial', label: 'Business' })
    await saveCategoryChange(client, ORG, { action: 'setActive', slug: 'new_build', active: false })
    const mine = await loadOrgCategories(client, ORG)
    expect(mine.find((c) => c.slug === 'commercial')?.label).toBe('Business')
    expect(mine.find((c) => c.slug === 'new_build')?.active).toBe(false)
    expect((await loadOrgCategories(client, OTHER)).map((c) => c.label)).toEqual(['Residential', 'Commercial', 'New build'])
  })
  it('a refused change writes nothing', async () => {
    const { client, merges } = setup()
    const r = await saveCategoryChange(client, ORG, { action: 'add', label: 'commercial' })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(merges).toEqual([])
  })
  it('the generic settings writer refuses the categories key at the top level', async () => {
    const { client } = setup()
    expect((await mergeOrgSettings(client, ORG, { categories: { items: [] } })).error).toMatch(/categories/)
  })
})

describe('setCustomerCategory', () => {
  it('sets, changes and clears', async () => {
    const { client, db } = setup()
    expect(await setCustomerCategory(client, ORG, 'c1', 'residential')).toEqual({ ok: true, category: 'residential' })
    expect(db.tables.customers.find((c) => c.id === 'c1')?.category).toBe('residential')
    expect(await setCustomerCategory(client, ORG, 'c1', null)).toEqual({ ok: true, category: null })
    expect(db.tables.customers.find((c) => c.id === 'c1')?.category).toBeNull()
  })
  it('refuses a slug that is not on the list, and another company’s customer', async () => {
    const { client } = setup()
    expect(await setCustomerCategory(client, ORG, 'c1', 'spa_day')).toMatchObject({ ok: false, status: 400 })
    expect(await setCustomerCategory(client, ORG, 'cx', 'residential')).toMatchObject({ ok: false, status: 404 })
  })
  it('onlyIfBlank never overwrites a person’s choice (a matched customer on the new-customer form)', async () => {
    const { client, db } = setup()
    expect(await setCustomerCategory(client, ORG, 'c2', 'residential', { onlyIfBlank: true })).toEqual({ ok: true, category: 'commercial' })
    expect(db.tables.customers.find((c) => c.id === 'c2')?.category).toBe('commercial')
    expect(await setCustomerCategory(client, ORG, 'c1', 'residential', { onlyIfBlank: true })).toEqual({ ok: true, category: 'residential' })
  })
  it('a turned-off category cannot be newly given out but stays where it is', async () => {
    const { client } = setup()
    await saveCategoryChange(client, ORG, { action: 'setActive', slug: 'commercial', active: false })
    expect(await setCustomerCategory(client, ORG, 'c1', 'commercial')).toMatchObject({ ok: false, status: 400 })
    expect(await setCustomerCategory(client, ORG, 'c2', 'commercial')).toEqual({ ok: true, category: 'commercial' })
  })
})

describe('setJobCategory + enrichJobsWithCategory', () => {
  it('override, then clear back to "same as customer"', async () => {
    const { client, db } = setup()
    expect(await setJobCategory(client, ORG, 'j1', 'new_build')).toEqual({ ok: true, category: 'new_build' })
    expect(db.tables.production_jobs.find((j) => j.id === 'j1')?.category).toBe('new_build')
    expect(await setJobCategory(client, ORG, 'j1', null)).toEqual({ ok: true, category: null })
    expect(await setJobCategory(client, ORG, 'nope', 'new_build')).toMatchObject({ ok: false, status: 404 })
    expect(await setJobCategory(client, OTHER, 'j1', 'new_build')).toMatchObject({ ok: false, status: 404 })
  })
  it('effective category on board rows = job override ?? customer category ?? null', async () => {
    const { client } = setup()
    const rows: Array<{ id: string; customer_id: string | null } & Record<string, unknown>> = [
      { id: 'j1', customer_id: 'c2' },
      { id: 'j2', customer_id: 'c2' },
      { id: 'j3', customer_id: null },
    ]
    await enrichJobsWithCategory(client, ORG, rows)
    expect(rows.map((r) => r.effective_category)).toEqual(['commercial', 'new_build', null])
  })
})

describe('before the database update is applied', () => {
  it('reads show "not set" and the board is untouched; writes say so plainly', async () => {
    const { client } = setup()
    const failing = new Proxy(client as object, {
      get: (t, k) =>
        k === 'from'
          ? (table: string) => {
              if (table === 'orgs') return (t as { from: (x: string) => unknown }).from(table)
              const q: Record<string, unknown> = {}
              const missing = { data: null, error: { code: '42703', message: 'column customers.category does not exist' } }
              for (const m of ['select', 'eq', 'in', 'update']) q[m] = () => q
              q.maybeSingle = async () => missing
              q.then = (res: (v: unknown) => unknown) => Promise.resolve(missing).then(res)
              return q
            }
          : (t as Record<string | symbol, unknown>)[k],
    }) as never
    const rows: Array<{ id: string; customer_id: string | null } & Record<string, unknown>> = [{ id: 'j1', customer_id: 'c2' }]
    await enrichJobsWithCategory(failing, ORG, rows)
    expect(rows[0].effective_category).toBeUndefined()
    expect(await setCustomerCategory(failing, ORG, 'c1', 'residential')).toMatchObject({ ok: false, status: 503 })
    expect(await setJobCategory(failing, ORG, 'j1', 'residential')).toMatchObject({ ok: false, status: 503 })
  })
})
