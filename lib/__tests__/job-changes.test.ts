/** @jest-environment node */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const J1 = '11111111-1111-4111-8111-111111111111'
const JX = '22222222-2222-4222-8222-222222222222'

let signedIn = true
let profile: Record<string, unknown> = { id: 'u1', org_id: 'org-1', role: 'admin', active: true }
let ops = { canJobBoard: true, canViewJobFinancials: true }
const state = { db: createFakeDb({}) }

function reset(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  state.db = createFakeDb({
    production_jobs: [
      { id: J1, org_id: 'org-1' },
      { id: JX, org_id: 'org-2' },
    ],
    users: [{ id: 'u1', org_id: 'org-1', full_name: 'Dana' }],
    production_job_changes: [],
    ...extra,
  })
}

jest.mock('@/lib/auth', () => ({
  requireAuthApi: async () => {
    if (!signedIn) throw new Error('nope')
    return { authUser: { id: 'u1' }, profile }
  },
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => state.db.client }))
jest.mock('@/lib/ops-access', () => ({ resolveOpsAccess: async () => ops }))

import { GET } from '@/app/api/ops/jobs/[id]/history/route'
import { jobPatchChanges, recordJobChanges, splitStatusChange, toHistoryEntries, tradeScheduleChanges } from '@/lib/job-changes'

const get = (id: string, page = 0) => GET(new Request(`https://crm.example/api/ops/jobs/${id}/history?page=${page}`), { params: { id } })

beforeEach(() => {
  signedIn = true
  profile = { id: 'u1', org_id: 'org-1', role: 'admin', active: true }
  ops = { canJobBoard: true, canViewJobFinancials: true }
  reset()
})

describe('diff -> changes', () => {
  it('names the fields that changed, status in words, and skips an unchanged one', () => {
    const c = jobPatchChanges({ status: 'sold', customer_po: 'A1', claim_number: null }, { status: 'scheduled', customer_po: 'A1', claim_number: null })
    expect(c).toEqual([{ field: 'status', label: 'Status', old: 'Sold', new: 'Scheduled' }])
    expect(splitStatusChange(jobPatchChanges({ status: 'sold', customer_po: null }, { status: 'materials', customer_po: 'PO-9' }))).toMatchObject({
      status: [{ field: 'status' }],
      rest: [{ field: 'customer_po', old: null, new: 'PO-9' }],
    })
  })
  it('shortens long notes', () => {
    const [c] = jobPatchChanges({ internal_notes: '' }, { internal_notes: 'x'.repeat(300) })
    expect(String(c.new).length).toBeLessThan(130)
  })
  it('names the trade for a crew / day / length change', () => {
    const c = tradeScheduleChanges('Gutters', { scheduled_date: '2026-11-04', install_days: '1', crew: 'A Crew' }, { scheduled_date: '2026-11-06', install_days: 1, crew: 'A Crew' })
    expect(c).toEqual([{ field: 'trade_date', label: 'Gutters date', old: '2026-11-04', new: '2026-11-06' }])
  })
})

describe('recordJobChanges', () => {
  it('skips an empty list', async () => {
    await recordJobChanges(state.db.client as never, 'org-1', J1, 'u1', 'job_edit', [])
    expect(state.db.tables.production_job_changes).toHaveLength(0)
  })
  it('stamps the company and writes one row', async () => {
    await recordJobChanges(state.db.client as never, 'org-1', J1, 'u1', 'status', [{ field: 'status', label: 'Status', old: 'Sold', new: 'Scheduled' }])
    expect(state.db.tables.production_job_changes).toMatchObject([{ org_id: 'org-1', job_id: J1, changed_by: 'u1', source: 'status' }])
  })
  it('never throws into the caller (write error or thrown error)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const boom = { from: () => { throw new Error('db down') } }
    await expect(recordJobChanges(boom as never, 'org-1', J1, 'u1', 'status', [{ field: 'status', label: 'Status', old: 'a', new: 'b' }])).resolves.toBeUndefined()
    const failing = { from: () => ({ insert: () => ({ error: { message: 'relation does not exist' } }) }) }
    await expect(recordJobChanges(failing as never, 'org-1', J1, 'u1', 'status', [{ field: 'status', label: 'Status', old: 'a', new: 'b' }])).resolves.toBeUndefined()
    spy.mockRestore()
  })
})

describe('money fields are hidden without financial access', () => {
  const rows = [
    { id: 'r1', source: 'job_edit' as const, changed_at: '2026-11-23T10:00:00Z', changed_by: 'u1', changes: [{ field: 'acv_amount', label: 'ACV amount', old: 1000, new: 2500 }], note: null },
    { id: 'r2', source: 'job_edit' as const, changed_at: '2026-11-23T11:00:00Z', changed_by: 'u1', changes: [{ field: 'acv_amount', label: 'ACV amount', old: 1, new: 2 }, { field: 'customer_po', label: 'Customer PO', old: null, new: 'P1' }], note: null },
  ]
  it('a viewer with money sees dollars', () => {
    expect(toHistoryEntries(rows, new Map([['u1', 'Dana']]), true)[0].lines[0]).toContain('$2,500')
  })
  it('a viewer without money loses the money line and an entry left empty', () => {
    const out = toHistoryEntries(rows, new Map([['u1', 'Dana']]), false)
    expect(out).toHaveLength(1)
    expect(out[0].lines).toEqual(['Customer PO: (empty) → P1'])
  })
})

describe('GET /api/ops/jobs/[id]/history', () => {
  it('401 when signed out, 403 without job board access', async () => {
    signedIn = false
    expect((await get(J1)).status).toBe(401)
    signedIn = true
    ops = { canJobBoard: false, canViewJobFinancials: false }
    expect((await get(J1)).status).toBe(403)
  })
  it("404 for another company's job and for a bad id", async () => {
    expect((await get(JX)).status).toBe(404)
    expect((await get('nope')).status).toBe(404)
  })
  it("returns this job's entries newest first, never another company's", async () => {
    reset({
      production_job_changes: [
        { id: 'a', org_id: 'org-1', job_id: J1, changed_by: 'u1', changed_at: '2026-11-22T10:00:00Z', source: 'status', changes: [{ field: 'status', label: 'Status', old: 'Sold', new: 'Scheduled' }], note: null },
        { id: 'b', org_id: 'org-1', job_id: J1, changed_by: 'u1', changed_at: '2026-11-23T10:00:00Z', source: 'cancel', changes: [{ field: 'status', label: 'Status', old: 'Scheduled', new: 'Cancelled' }], note: 'Other' },
        { id: 'c', org_id: 'org-2', job_id: J1, changed_by: null, changed_at: '2026-11-24T10:00:00Z', source: 'status', changes: [{ field: 'status', label: 'Status', old: 'x', new: 'y' }], note: null },
      ],
    })
    const res = await get(J1)
    const body = await res.json()
    expect(body.entries.map((e: { id: string }) => e.id)).toEqual(['b', 'a'])
    expect(body.entries[0]).toMatchObject({ by: 'Dana', lines: ['Status: Scheduled → Cancelled'], note: 'Other' })
    expect(body.hasMore).toBe(false)
  })
  it('hides money lines for a viewer without job financials', async () => {
    ops = { canJobBoard: true, canViewJobFinancials: false }
    reset({ production_job_changes: [{ id: 'a', org_id: 'org-1', job_id: J1, changed_by: 'u1', changed_at: '2026-11-22T10:00:00Z', source: 'job_edit', changes: [{ field: 'acv_amount', label: 'ACV amount', old: 1, new: 2 }], note: null }] })
    const body = await (await get(J1)).json()
    expect(body.entries).toEqual([])
  })
})
