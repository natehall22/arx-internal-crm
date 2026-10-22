/** @jest-environment node */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

import { interpretSubmitResponse, submitAbcOrder, clearAbcTokenCache } from '@/lib/suppliers/abc/client'
import { abcChannelProblem, abcKindProblem, abcSupplyConnector } from '@/lib/suppliers/abc/connector'
import { decideSecondApproval, needsSecondApprover } from '@/lib/suppliers/abc/gate'
import { buildAbcOrder, estimateTotalCents, lineProblems } from '@/lib/suppliers/abc/payload'
import { parseOrderQuantity } from '@/lib/suppliers/abc/quantity'
import type { SupplierApiSettings } from '@/lib/suppliers/abc/types'
import type { SupplierRecord } from '@/lib/material-sourcing'
import { secretMatches } from '@/lib/suppliers/abc/webhook'

const settings = (over: Partial<SupplierApiSettings> = {}): SupplierApiSettings => ({
  provider: 'abc_supply', environment: 'sandbox', orderingEnabled: true, shipToNumber: '1234567', branchNumber: '128', deliveryService: 'OTR',
  orgOrderingEnabled: true, secondApprovalCents: 1_000_000,
  itemMap: [
    { lineKey: 'shingles', itemNumber: 'OCDUR-DR', uom: 'BD', qtyUnitWord: 'bundles', estUnitPriceCents: 3800 },
    { lineKey: 'ridge', itemNumber: 'OCRIDGE', uom: 'BD', qtyUnitWord: 'bundles', estUnitPriceCents: null },
  ],
  ...over,
})
const supplier = (api: SupplierApiSettings | null = settings()): SupplierRecord => ({
  id: 'v1', name: 'ABC Supply', orderEmail: null, ccEmails: [], accountNumber: null, defaultBranch: null, defaultDeliveryNotes: null,
  defaultForTrades: [], active: true, connectionType: 'api', api,
})
const lines = [
  { key: 'shingles', label: 'Field shingles', qty: '20 sq · 58 bundles', note: null },
  { key: 'ridge', label: 'Ridge cap', qty: '4 bundles', note: 'Match color' },
]

describe('quantity reading', () => {
  it('reads the number in front of the mapped word, exactly one', () => {
    expect(parseOrderQuantity('20 sq · 58 bundles', 'bundles')).toBe(58)
    expect(parseOrderQuantity('4 bundles', 'Bundles')).toBe(4)
    expect(parseOrderQuantity('2.5 rolls', 'rolls')).toBe(2.5)
  })
  it('refuses to guess', () => {
    expect(parseOrderQuantity('20 sq', 'bundles')).toBeNull()
    expect(parseOrderQuantity('3 bundles · 5 bundles', 'bundles')).toBeNull()
    expect(parseOrderQuantity('0 bundles', 'bundles')).toBeNull()
    expect(parseOrderQuantity(null, 'bundles')).toBeNull()
    expect(parseOrderQuantity('58 bundles', '')).toBeNull()
  })
})

describe('order payload', () => {
  const args = { settings: settings(), requestId: 'req-1', poLabel: '26-0141-A', jobNumber: '26-0141', deliveryDate: '2026-11-03', deliveryAddress: '12 Elm St, Concord NC', deliveryNotes: 'Roof drop', note: null, lines }
  it('builds the ABC body with PO number, branch, ship-to, item numbers and units', () => {
    const r = buildAbcOrder(args)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const o = r.body[0]
    expect(o.purchaseOrder).toBe('26-0141-A')
    expect(o.requestId).toBe('req-1')
    expect(o.branchNumber).toBe('128')
    expect(o.shipTo.number).toBe('1234567')
    expect(o.typeCode).toBe('SO')
    expect(o.lines[0]).toMatchObject({ itemNumber: 'OCDUR-DR', orderedQty: { value: 58, uom: 'BD' } })
    expect(o.lines[1].comments?.description).toBe('Match color')
  })
  it('blocks instead of guessing: unmapped line, unreadable quantity, long PO, missing ship-to', () => {
    expect(lineProblems([{ key: 'x', label: 'Mystery', qty: '1 ea', note: null }], settings().itemMap)[0]).toMatch(/no ABC item number/)
    expect(lineProblems([{ key: 'shingles', label: 'Field shingles', qty: '20 sq', note: null }], settings().itemMap)[0]).toMatch(/cannot read/)
    expect(buildAbcOrder({ ...args, poLabel: '26-0141-A-R1-EXTRA-LONG' })).toMatchObject({ ok: false })
    const r = buildAbcOrder({ ...args, settings: settings({ shipToNumber: null }) })
    expect(r.ok).toBe(false)
  })
  it('an unknown line price makes the order total unknown', () => {
    expect(estimateTotalCents(lines, settings().itemMap)).toBeNull()
    expect(estimateTotalCents([lines[0]], settings().itemMap)).toBe(58 * 3800)
  })
})

describe('kill switches (all three must be on)', () => {
  const OLD = { ...process.env }
  afterEach(() => { process.env = { ...OLD } })
  const creds = () => { process.env.ABC_CLIENT_ID_SANDBOX = 'id'; process.env.ABC_CLIENT_SECRET_SANDBOX = 'secret' }

  it('is OFF by default: the environment switch is unset', () => {
    delete process.env.SUPPLIER_API_ORDERING
    creds()
    expect(abcChannelProblem(supplier())).toMatch(/switched off for the whole system/)
  })
  it('the company switch and the supplier switch each block on their own', () => {
    process.env.SUPPLIER_API_ORDERING = 'on'; creds()
    expect(abcChannelProblem(supplier(settings({ orgOrderingEnabled: false })))).toMatch(/for the company/)
    expect(abcChannelProblem(supplier(settings({ orderingEnabled: false })))).toMatch(/switched off for ABC Supply/)
    expect(abcChannelProblem(supplier(null))).toMatch(/no ABC connection settings/)
  })
  it('missing credentials block; with everything on and lines mapped it is clear', () => {
    process.env.SUPPLIER_API_ORDERING = 'on'
    delete process.env.ABC_CLIENT_ID_SANDBOX; delete process.env.ABC_CLIENT_SECRET_SANDBOX
    expect(abcChannelProblem(supplier())).toMatch(/sign-in is not set up/)
    creds()
    expect(abcChannelProblem(supplier(), lines.map((l) => ({ ...l, status: 'ready' as const, trade: 'roofing' })))).toBeNull()
  })
  it('transmit re-checks the switches at the last moment and never reaches the network', async () => {
    delete process.env.SUPPLIER_API_ORDERING
    const fetchSpy = jest.spyOn(global, 'fetch')
    await expect(
      abcSupplyConnector.transmit({ kind: 'order', supplier: supplier(), jobNumber: '26-0141', poLabel: '26-0141-A', deliveryDate: '2026-11-03', deliveryAddress: 'x', deliveryNotes: null, note: null, lines: [] as never, email: {} as never, pdf: null })
    ).rejects.toThrow(/refused/)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
  it('only a first order may use the API (a revision/resend would create a second order)', () => {
    expect(abcKindProblem('order')).toBeNull()
    for (const k of ['revision', 'resend', 'cancellation']) expect(abcKindProblem(k)).toMatch(/Call the branch/)
  })
})

describe('ABC answers', () => {
  it('success needs a confirmation number', () => {
    expect(interpretSubmitResponse(202, { request: { ordersFailed: 0 }, orders: [{ requestId: 'r', confirmationNumber: 'C10-1', message: 'Ordered successfully' }] }).confirmationNumber).toBe('C10-1')
  })
  it('a definite refusal is marked refused (nothing left); a 5xx or empty answer is NOT (unknown)', () => {
    expect(() => interpretSubmitResponse(400, { message: 'bad branch' })).toThrow(/refused/)
    expect(() => interpretSubmitResponse(401, {})).toThrow(/refused/)
    expect(() => interpretSubmitResponse(202, { request: { ordersFailed: 1 }, orders: [{ message: 'Item not found' }] })).toThrow(/refused/)
    expect(() => interpretSubmitResponse(500, {})).toThrow(/not known/)
    expect(() => interpretSubmitResponse(202, { request: { ordersFailed: 0 }, orders: [{ message: 'ok' }] })).toThrow(/not known/)
    // unreadable / empty 2xx body: ABC may have the order
    expect(() => interpretSubmitResponse(200, null)).toThrow(/not known/)
    expect(() => interpretSubmitResponse(202, {})).toThrow(/not known/)
    try { interpretSubmitResponse(202, null) } catch (e) { expect((e as { refused?: boolean }).refused).toBeUndefined() }
    try { interpretSubmitResponse(400, {}) } catch (e) { expect((e as { refused?: boolean }).refused).toBe(true) }
    try { interpretSubmitResponse(500, {}) } catch (e) { expect((e as Error).message).not.toMatch(/refused|invalid|rejected/i) }
  })
  it('never retries: a timeout is one request, then an error', async () => {
    process.env.ABC_CLIENT_ID_SANDBOX = 'id'; process.env.ABC_CLIENT_SECRET_SANDBOX = 'secret'
    clearAbcTokenCache()
    let posts = 0
    const fakeFetch = (async (url: string) => {
      if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 })
      posts += 1
      throw new Error('timeout')
    }) as unknown as typeof fetch
    await expect(submitAbcOrder('sandbox', [], { fetch: fakeFetch })).rejects.toThrow('timeout')
    expect(posts).toBe(1)
  })
})

describe('second approver', () => {
  const me = { id: 'u1', isOwner: true }
  const open = { id: 'a1', supplierOrderId: 'o1', contentHash: 'h', requestedBy: 'u2', requestedByName: 'Sam', status: 'pending' as const }
  it('small known orders go through; at/over the limit or unknown total need a second person', () => {
    expect(needsSecondApprover(500_000, 1_000_000)).toBe(false)
    expect(needsSecondApprover(1_000_000, 1_000_000)).toBe(true)
    expect(needsSecondApprover(null, 1_000_000)).toBe(true)
    expect(decideSecondApproval({ estimatedTotalCents: 5000, thresholdCents: 1_000_000, actor: me, open: null }).action).toBe('allow')
  })
  it('the first person only files a request; they cannot approve their own', () => {
    expect(decideSecondApproval({ estimatedTotalCents: null, thresholdCents: 1_000_000, actor: me, open: null }).action).toBe('request')
    expect(decideSecondApproval({ estimatedTotalCents: null, thresholdCents: 1_000_000, actor: me, open: { ...open, requestedBy: 'u1' } }).action).toBe('block')
  })
  it('a different OWNER approves; a different non-owner cannot', () => {
    expect(decideSecondApproval({ estimatedTotalCents: null, thresholdCents: 1_000_000, actor: me, open })).toEqual({ action: 'allow_and_consume', approvalId: 'a1' })
    expect(decideSecondApproval({ estimatedTotalCents: null, thresholdCents: 1_000_000, actor: { id: 'u3', isOwner: false }, open }).action).toBe('block')
  })
})

describe('webhook secret', () => {
  it('accepts only the exact secret, constant-time, with or without Bearer', () => {
    expect(secretMatches('s3cret', 's3cret')).toBe(true)
    expect(secretMatches('Bearer s3cret', 's3cret')).toBe(true)
    expect(secretMatches('s3cre', 's3cret')).toBe(false)
    expect(secretMatches(null, 's3cret')).toBe(false)
    expect(secretMatches('anything', undefined)).toBe(false)
  })
})

describe('no price comparison for ABC (their terms forbid it)', () => {
  it('the ABC modules never call ABC pricing and never read another supplier', () => {
    const dir = join(process.cwd(), 'lib/suppliers/abc')
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(src).not.toMatch(/pricing\.read|\/pricing|price-items|priceItems/i)
    }
  })
  it('estimated prices are used only by the approval gate and payload estimate', () => {
    const root = process.cwd()
    const hits: string[] = []
    const walk = (d: string) => readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = join(d, e.name)
      if (e.isDirectory() && !['node_modules', '.next', '__tests__'].includes(e.name)) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name) && /estUnitPriceCents|est_unit_price_cents/.test(readFileSync(p, 'utf8'))) hits.push(p.slice(root.length + 1))
    })
    walk(join(root, 'lib')); walk(join(root, 'app')); walk(join(root, 'components'))
    expect(hits.sort()).toEqual([
      'app/api/admin/suppliers/[id]/api/route.ts',
      'lib/suppliers/abc/payload.ts',
      'lib/suppliers/abc/settings-db.ts',
      'lib/suppliers/abc/types.ts',
    ])
  })
})
