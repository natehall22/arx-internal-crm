/** @jest-environment node */
/** Code before migration 202611300160: nothing breaks, for any company. */
function admin(columnsPresent: boolean) {
  const selects: string[] = []
  const missing = { code: '42703', message: 'column properties.community does not exist' }
  const from = () => {
    let cols = ''
    const q: any = {
      select: (c: string) => { cols = c; selects.push(c); return q },
      eq: () => q, limit: () => q, maybeSingle: () => q, single: () => q,
      insert: () => q,
      then: (res: (v: unknown) => void) => {
        const asksLots = /community/.test(cols)
        res(asksLots && !columnsPresent ? { data: null, error: missing } : { data: [{ id: 'p1', customer_id: 'c1', address_text: '1 A St', active: true }], error: null })
      },
    }
    return q
  }
  return { client: { from } as never, selects }
}

describe('properties without the development / lot columns', () => {
  it('reads without them (the card still works) and refuses only a save that sets them', async () => {
    let mod: typeof import('@/lib/properties-db')
    jest.isolateModules(() => { mod = require('@/lib/properties-db') })
    const a = admin(false)
    const load = await mod!.loadCustomerProperties(a.client, 'o1', 'c1', { accessNotes: false })
    expect(load.ready).toBe(true)
    expect(load.properties).toHaveLength(1)
    expect(a.selects.filter((s) => s.includes('community'))).toEqual(['community'])
    const made = await mod!.createProperty(a.client, 'o1', 'u1', 'c1', { address_line1: '1 A St', community: 'Oak Ridge' }, { accessNotes: false })
    expect(made).toMatchObject({ ok: false, status: 503 })
    const plain = await mod!.createProperty(a.client, 'o1', 'u1', 'c1', { address_line1: '1 A St' }, { accessNotes: false })
    expect(plain.ok).toBe(true)
  })
  it('with the columns present they are read', async () => {
    let mod: typeof import('@/lib/properties-db')
    jest.isolateModules(() => { mod = require('@/lib/properties-db') })
    const a = admin(true)
    await mod!.loadCustomerProperties(a.client, 'o1', 'c1', { accessNotes: false })
    expect(a.selects.some((s) => s.includes('community, lot'))).toBe(true)
  })
})
