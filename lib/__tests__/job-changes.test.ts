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
import { jobChangeLine, jobPatchChanges, recordJobChanges, splitStatusChange, toHistoryEntries, tradeScheduleChanges } from '@/lib/job-changes'

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
    expect(toHistoryEntries(rows, new Map([['u1', 'Dana']]), true, 'America/Chicago')[0].lines[0]).toContain('$2,500')
  })
  it('a viewer without money loses the money line and an entry left empty', () => {
    const out = toHistoryEntries(rows, new Map([['u1', 'Dana']]), false, 'America/Chicago')
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

describe('times in the company zone', () => {
  it('shows an instant as date and time and a trade day as a date, in the given zone', () => {
    // 2026-11-04 23:12 UTC is 5:12 PM in Chicago (CST), still Nov 4; 03:30 UTC Nov 5 is 9:30 PM Nov 4.
    expect(jobChangeLine({ field: 'started_at', label: 'Started', old: null, new: '2026-11-05T03:30:00Z' }, 'America/Chicago')).toBe('Started: (empty) → Nov 4, 9:30 PM')
    expect(jobChangeLine({ field: 'trade_date', label: 'Gutters date', old: '2026-11-04', new: '2026-11-06' }, 'America/Los_Angeles')).toBe('Gutters date: Nov 4 → Nov 6')
  })
})

describe('no same-looking changes', () => {
  it('drops empty -> empty centrally', async () => {
    await recordJobChanges(state.db.client as never, 'org-1', J1, 'u1', 'billing', [
      { field: 'estimated_hours', label: 'Estimated hours', old: null, new: null },
      { field: 'claim_number', label: 'Claim number', old: '', new: null },
    ])
    expect(state.db.tables.production_job_changes).toHaveLength(0)
  })
})

describe('money-only pages for a viewer without money access', () => {
  it('keeps reading older pages until something is visible', async () => {
    const money = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, org_id: 'org-1', job_id: J1, changed_by: 'u1', changed_at: `2026-11-23T10:${String(i).padStart(2, '0')}:00Z`, source: 'job_edit', changes: [{ field: 'acv_amount', label: 'ACV amount', old: 1, new: 2 }], note: null }))
    const visible = { id: 'v', org_id: 'org-1', job_id: J1, changed_by: 'u1', changed_at: '2026-11-01T10:00:00Z', source: 'status', changes: [{ field: 'status', label: 'Status', old: 'Sold', new: 'Scheduled' }], note: null }
    ops = { canJobBoard: true, canViewJobFinancials: false }
    reset({ production_job_changes: [...money, visible] })
    const body = await (await get(J1)).json()
    expect(body.entries.map((e: { id: string }) => e.id)).toEqual(['v'])
    expect(body.page).toBe(1)
    expect(body.hasMore).toBe(false)
  })
})

describe('status the crew schedule derives', () => {
  async function run(changedBy: string | null) {
    reset()
    state.db.tables.production_jobs.length = 0
    state.db.tables.production_jobs.push({ id: J1, org_id: 'org-1', status: 'sold', scheduled_date: null, install_days: null, assigned_sub_id: null, started_at: null })
    state.db.tables.work_orders = [{ id: 'w1', org_id: 'org-1', job_id: J1, trade: 'roofing', status: 'scheduled', assigned_sub_id: 's1', scheduled_date: '2026-12-01', install_days: 1 }]
    const { syncJobScheduleFromTrades } = await import('@/lib/job-trades-db')
    await syncJobScheduleFromTrades(state.db.client as never, 'org-1', J1, { changedBy })
    return state.db.tables.production_job_changes as Array<{ note: string | null; changed_by: string | null }>
  }
  it('adds the schedule note only when nobody caused it', async () => {
    expect((await run(null))[0]).toMatchObject({ note: 'Moved by the crew schedule', changed_by: null })
    expect((await run('u1'))[0]).toMatchObject({ note: null, changed_by: 'u1' })
  })
})

describe('long notes and years', () => {
  it('records an edit made past the preview length, marked (edited)', async () => {
    const base = 'x'.repeat(150)
    const changes = jobPatchChanges({ internal_notes: base }, { internal_notes: `${base} more` })
    expect(changes).toHaveLength(1)
    expect(String(changes[0].new)).toMatch(/\(edited\)$/)
    await recordJobChanges(state.db.client as never, 'org-1', J1, 'u1', 'job_edit', changes)
    expect(state.db.tables.production_job_changes).toHaveLength(1)
  })
  it('adds the year only outside the current year', () => {
    const y = new Date().getFullYear()
    expect(jobChangeLine({ field: 'trade_date', label: 'Gutters date', old: '2020-11-04', new: `${y}-11-06` }, 'America/Chicago')).toBe(`Gutters date: Nov 4, 2020 → Nov 6`)
    expect(jobChangeLine({ field: 'started_at', label: 'Started', old: null, new: '2020-11-05T03:30:00Z' }, 'America/Chicago')).toBe('Started: (empty) → Nov 4, 2020, 9:30 PM')
  })
})
