/** @jest-environment node */
/** Settings → Job setup → Trades: the one writer (lib/org-trades-admin.ts) and its owner-only route. */
import { saveOrgTradeChange } from '@/lib/org-trades-admin'
import { DEFAULT_ORG_TRADES } from '@/lib/org-trades'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let profile: Record<string, unknown> | null = null
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => {
    if (!profile) throw new Error('Unauthorized')
    return { authUser: { id: profile.id }, profile }
  }),
}))
let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

const seeded = () =>
  createFakeDb({
    org_trades: [
      ...DEFAULT_ORG_TRADES.map((t) => ({ org_id: 'org-1', slug: t.slug, label: t.label, sort: t.sort, active: t.active, match_keywords: t.matchKeywords })),
      { org_id: 'org-2', slug: 'roofing', label: 'Roofing', sort: 10, active: true, match_keywords: null },
    ],
  })

describe('saveOrgTradeChange', () => {
  beforeEach(() => {
    db = seeded()
  })

  it('adds a trade with a slug from its name, at the end of the list', async () => {
    const r = await saveOrgTradeChange(db.client, 'org-1', 'u1', { action: 'add', label: '  Solar   panels ' })
    expect(r.ok && r.trades.map((t) => [t.slug, t.label, t.sort])).toEqual(
      expect.arrayContaining([['solar_panels', 'Solar panels', 60]])
    )
    expect(r.ok && r.trades[r.trades.length - 1].slug).toBe('solar_panels')
  })

  it('refuses a duplicate name, an empty or too-long name', async () => {
    expect(await saveOrgTradeChange(db.client, 'org-1', 'u1', { action: 'add', label: 'gutters' })).toMatchObject({ ok: false, status: 409 })
    expect(await saveOrgTradeChange(db.client, 'org-1', 'u1', { action: 'add', label: ' ' })).toMatchObject({ ok: false, status: 400 })
    expect(await saveOrgTradeChange(db.client, 'org-1', 'u1', { action: 'add', label: 'x'.repeat(41) })).toMatchObject({ ok: false, status: 400 })
  })

  it('renames by slug — the slug never changes', async () => {
    const r = await saveOrgTradeChange(db.client, 'org-1', 'u1', { action: 'rename', slug: 'siding', label: 'Exterior cladding' })
    expect(r.ok && r.trades.find((t) => t.slug === 'siding')?.label).toBe('Exterior cladding')
    expect(db.tables.org_trades.filter((t) => t.org_id === 'org-1').map((t) => t.slug)).toEqual(DEFAULT_ORG_TRADES.map((t) => t.slug))
  })

  it('reorders in one write and refuses a stale order', async () => {
    const order = ['gutters', 'roofing', 'siding', 'windows', 'other']
    const r = await saveOrgTradeChange(db.client, 'org-1', 'u1', { action: 'reorder', order })
    expect(r.ok && r.trades.map((t) => t.slug)).toEqual(order)
    expect(db.writes.filter((w) => w.table === 'org_trades' && w.op !== 'insert')).toHaveLength(1)
    expect(await saveOrgTradeChange(db.client, 'org-1', 'u1', { action: 'reorder', order: ['roofing'] })).toMatchObject({ ok: false, status: 400 })
  })

  it('turns trades off and on, but never the last one that is on', async () => {
    const r = await saveOrgTradeChange(db.client, 'org-1', 'u1', { action: 'setActive', slug: 'windows', active: false })
    expect(r.ok && r.trades.find((t) => t.slug === 'windows')?.active).toBe(false)
    expect(await saveOrgTradeChange(db.client, 'org-2', 'u1', { action: 'setActive', slug: 'roofing', active: false })).toMatchObject({ ok: false, status: 400 })
  })

  it('only touches its own org', async () => {
    expect(await saveOrgTradeChange(db.client, 'org-2', 'u1', { action: 'rename', slug: 'siding', label: 'X' })).toMatchObject({ ok: false, status: 404 })
    await saveOrgTradeChange(db.client, 'org-1', 'u1', { action: 'rename', slug: 'roofing', label: 'Roofs' })
    expect(db.tables.org_trades.find((t) => t.org_id === 'org-2')?.label).toBe('Roofing')
  })

  it('says the page is not ready (503) until the migration is applied', async () => {
    const missing = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.org_trades'" } }) }) }) }
    expect(await saveOrgTradeChange(missing as never, 'org-1', 'u1', { action: 'add', label: 'Solar' })).toMatchObject({ ok: false, status: 503 })
  })
})

describe('/api/admin/job-setup/trades', () => {
  beforeEach(() => {
    db = seeded()
  })
  const post = async (body: unknown) => {
    const { POST } = await import('@/app/api/admin/job-setup/trades/route')
    return POST(new Request('http://localhost/api/admin/job-setup/trades', { method: 'POST', body: JSON.stringify(body) }))
  }

  it('is owners (super admins) only — an admin or the owner role without the flag gets 403', async () => {
    const { GET } = await import('@/app/api/admin/job-setup/trades/route')
    profile = { id: 'u2', org_id: 'org-1', role: 'owner', is_super_admin: false, active: true }
    expect((await GET()).status).toBe(403)
    expect((await post({ action: 'add', label: 'Solar' })).status).toBe(403)
    profile = null
    expect((await GET()).status).toBe(403)
    expect(db.tables.org_trades).toHaveLength(6)
  })

  it('a super admin reads and writes their own org', async () => {
    const { GET } = await import('@/app/api/admin/job-setup/trades/route')
    profile = { id: 'u1', org_id: 'org-1', role: 'admin', is_super_admin: true, active: true }
    const got = await (await GET()).json()
    expect(got.editable).toBe(true)
    expect(got.trades.map((t: { slug: string }) => t.slug)).toEqual(DEFAULT_ORG_TRADES.map((t) => t.slug))
    const res = await post({ action: 'add', label: 'Solar' })
    expect(res.status).toBe(200)
    expect(db.tables.org_trades.find((t) => t.slug === 'solar')).toMatchObject({ org_id: 'org-1', updated_by: 'u1', match_keywords: null })
  })
})
