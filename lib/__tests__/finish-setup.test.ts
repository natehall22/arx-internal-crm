/** @jest-environment node */
const mergeMock = jest.fn(async (..._a: unknown[]) => ({ error: null }))
jest.mock('@/lib/org-settings', () => ({ mergeOrgSettings: (...a: unknown[]) => mergeMock(...a) }))
import { buildFinishSetupItems, loadFinishSetup } from '@/lib/finish-setup'

const none = { hasLogo: false, pricebookItems: 0, crews: 0, planTemplates: 0, hasPhone: false, hasEmail: false, servicePlansOn: true }

test('plan row only when service plans are on; each row links somewhere', () => {
  expect(buildFinishSetupItems(none).map((i) => i.id)).toEqual(['logo', 'pricebook', 'crew', 'plan', 'contact'])
  expect(buildFinishSetupItems({ ...none, servicePlansOn: false }).map((i) => i.id)).toEqual(['logo', 'pricebook', 'crew', 'contact'])
  expect(buildFinishSetupItems(none).every((i) => i.href.startsWith('/admin'))).toBe(true)
})

test('contact needs phone AND email', () => {
  const contact = (o: object) => buildFinishSetupItems({ ...none, ...o }).find((i) => i.id === 'contact')!.done
  expect(contact({ hasPhone: true })).toBe(false)
  expect(contact({ hasPhone: true, hasEmail: true })).toBe(true)
})

function fakeAdmin(org: unknown, counts: Record<string, number>, orgError: unknown = null) {
  const seen: Array<[string, string]> = []
  return {
    seen,
    from: (table: string) => {
      const q: any = {
        select: () => q,
        eq: (c: string, v: string) => { seen.push([table, `${c}=${v}`]); return q },
        maybeSingle: async () => ({ data: org, error: orgError }),
        then: (res: (v: unknown) => void) => res({ count: counts[table] ?? 0, error: null }),
      }
      return q
    },
  }
}
const newCo = { name: 'Apex', phone: '', email: '', original_brand: false, logo_url: null, settings: {} }

test('original company never sees it; unreadable row hides it', async () => {
  expect(await loadFinishSetup(fakeAdmin({ ...newCo, original_brand: true }, {}) as never, 'o1', { servicePlansOn: false })).toBeNull()
  expect(await loadFinishSetup(fakeAdmin(null, {}, { message: 'x' }) as never, 'o1', { servicePlansOn: false })).toBeNull()
})

test('new company: live status, org-scoped counts; hides when all done', async () => {
  const admin = fakeAdmin(newCo, { pricebook_items: 2, crews: 0 })
  const items = (await loadFinishSetup(admin as never, 'o1', { servicePlansOn: false }))!
  expect(items.map((i) => [i.id, i.done])).toEqual([['logo', false], ['pricebook', true], ['crew', false], ['contact', false]])
  expect(admin.seen).toEqual(expect.arrayContaining([['pricebook_items', 'org_id=o1'], ['crews', 'org_id=o1']]))
  const done = fakeAdmin(
    { ...newCo, phone: '7045550100', email: 'a@b.co', logo_url: 'org/o1/logo.png?v=1' },
    { pricebook_items: 1, crews: 1 }
  )
  expect(await loadFinishSetup(done as never, 'o1', { servicePlansOn: false })).toBeNull()
})

test('completion is remembered once (only when every count was read); a remembered company reads no counts', async () => {
  mergeMock.mockClear()
  const done = fakeAdmin({ ...newCo, phone: '7045550100', email: 'a@b.co', logo_url: 'org/o1/logo.png?v=1' }, { pricebook_items: 1, crews: 1 })
  expect(await loadFinishSetup(done as never, 'o1', { servicePlansOn: false })).toBeNull()
  expect(mergeMock).toHaveBeenCalledWith(expect.anything(), 'o1', { finishSetupDone: true })

  mergeMock.mockClear()
  const remembered = fakeAdmin({ ...newCo, settings: { finishSetupDone: true } }, {})
  expect(await loadFinishSetup(remembered as never, 'o1', { servicePlansOn: false })).toBeNull()
  expect(remembered.seen.some(([t]) => t === 'pricebook_items' || t === 'crews')).toBe(false)
  expect(mergeMock).not.toHaveBeenCalled()
})
