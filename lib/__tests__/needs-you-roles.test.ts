/** @jest-environment node */
import { NextResponse } from 'next/server'

import type { DataHealthReport, HealthProblem } from '@/lib/data-health'
import { dataHealthDeps, needsYouAudience, needsYouForEmailRecipient, shapeNeedsYou, type HealthProblemCode } from '@/lib/data-health'
import { buildNeedsYouHtml } from '@/lib/morning-update-email'

const mockAuth = jest.fn()
const mockOps = jest.fn()
const mockLoad = jest.fn()

jest.mock('@/lib/auth', () => ({ requireAuthApi: () => mockAuth() }))
jest.mock('@/lib/ops-access', () => ({ resolveOpsAccess: (...a: unknown[]) => mockOps(...a) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
const p = (code: HealthProblem['code'], area: HealthProblem['area'], message: string, blocksPay = false): HealthProblem => ({ code, area, message, fixLabel: 'Fix', fixHref: '/x', blocksPay })

/** One of every row type, money rows carrying dollar amounts. */
const FULL: DataHealthReport = {
  generatedAt: '2026-10-22T12:00:00Z',
  jobs: [
    {
      kind: 'job', jobId: 'j1', jobNumber: '26-0001', status: 'complete', addressText: '1 Elm',
      problems: [
        p('collected_but_short', 'money', 'Collected $12,400.00 but the sale amount is $16,325.00 — $3,925.00 still owed.', true),
        p('missing_commission_base', 'money', 'No commission base on file.', true),
        p('no_setter', 'credit', 'No setter on the deal, so nobody gets setter credit.', true),
        p('materials_not_ordered', 'ops', "Crew starts 2026-10-25 and materials aren't marked ordered."),
        p('completed_no_costs', 'money', 'Job is done but has no costs entered (labor, materials).', true),
      ],
    },
    { kind: 'job', jobId: 'j2', jobNumber: '26-0002', status: 'complete', addressText: '2 Oak', problems: [p('sale_amount_mismatch', 'money', 'Sale amount $18,000 differs from the contract $17,500.', true)] },
    { kind: 'job', jobId: 'j3', jobNumber: '26-0003', status: 'scheduled', addressText: '3 Pine', problems: [p('permit_pending', 'ops', "Crew starts 2026-10-24 and the permit isn't approved yet.")] },
  ],
  appointments: [{ kind: 'appointment', appointmentId: 'a1', scheduledFor: '2026-10-20T14:00:00Z', appointmentType: 'inspection', addressText: '4 Ash', problems: [p('appointment_no_outcome', 'sales', 'Inspection on 2026-10-20 has no outcome.')] }],
  payPlans: [{ role: 'sales_rep', roleLabel: 'Closer', people: [{ id: 'u', name: 'Cam Hill' }], suggestion: null }],
  endedPlans: [{ id: 'e', name: 'Nathan Hall', role: 'admin', roleLabel: 'Admin', endedOn: '2026-08-19' }],
  count: 5,
}

const codes = (r: DataHealthReport) => r.jobs.flatMap((j) => j.problems.map((x) => x.code)).concat(r.appointments.flatMap((a) => a.problems.map((x) => x.code)))

describe('who gets what from Needs you (pure rule)', () => {
  it('super admin / owner → everything', () => {
    for (const v of [{ role: 'admin', is_super_admin: true }, { role: 'owner' }]) {
      expect(needsYouAudience(v, false)).toBe('owner')
    }
    expect(shapeNeedsYou(FULL, 'owner')).toBe(FULL)
  })
  it('a plain admin who is NOT a super admin is not an owner (money stays owner-only)', () => {
    expect(needsYouAudience({ role: 'admin', is_super_admin: false }, true)).toBe('ops')
    expect(needsYouAudience({ role: 'admin', is_super_admin: false }, false)).toBe('none')
  })
  it('ops (job board) → operational rows only; no dollars, no pay holds, no pay plans, no credit', () => {
    const r = shapeNeedsYou(FULL, 'ops')!
    expect(codes(r).sort()).toEqual(['appointment_no_outcome', 'completed_no_costs', 'materials_not_ordered', 'permit_pending'])
    expect(JSON.stringify(r)).not.toContain('$')
    expect(r.jobs.flatMap((j) => j.problems).every((x) => x.blocksPay === false)).toBe(true)
    expect(r.payPlans).toBeUndefined()
    expect(r.endedPlans).toBeUndefined()
    expect(r.jobs.map((j) => j.jobNumber)).toEqual(['26-0001', '26-0003']) // j2 had only a money row
    expect(r.count).toBe(3)
  })
  it('setters, closers, canvassers and the rest of the field get nothing, even with job-board access', () => {
    for (const role of ['setter', 'closer', 'sales_rep', 'canvasser', 'setter_manager', 'inside_sales', 'call_center']) {
      expect(needsYouAudience({ role }, true)).toBe('none')
    }
    expect(shapeNeedsYou(FULL, 'none')).toBeNull()
  })
  it('an inactive user and a missing profile get nothing', () => {
    expect(needsYouAudience({ role: 'admin', is_super_admin: true, active: false }, true)).toBe('none')
    expect(needsYouAudience(null, true)).toBe('none')
  })
})

describe('every problem code is deliberately classified', () => {
  it('a new HealthProblemCode must be placed on purpose: ops-visible, or money/credit (owner only)', () => {
    const ALL: HealthProblemCode[] = ['no_signed_contract', 'missing_commission_base', 'commission_base_mismatch', 'sale_amount_mismatch', 'collected_but_short', 'paid_not_marked_collected', 'no_deal_linked', 'no_closer', 'no_setter', 'self_gen_setter_conflict', 'completed_no_costs', 'not_installed', 'materials_not_ordered', 'permit_pending', 'crews_done_job_open', 'crew_past_due', 'trade_done_no_photos', 'appointment_no_outcome']
    const OPS = ['completed_no_costs', 'materials_not_ordered', 'permit_pending', 'crews_done_job_open', 'crew_past_due', 'trade_done_no_photos', 'appointment_no_outcome']
    // Build a report with one row per code and check exactly the ops codes survive for ops.
    const report: DataHealthReport = { generatedAt: 'x', jobs: ALL.map((code, i) => ({ kind: 'job', jobId: `j${i}`, jobNumber: `26-${i}`, status: 'complete', addressText: null, problems: [p(code, 'money', 'row')] })), appointments: [], count: ALL.length }
    expect(codes(shapeNeedsYou(report, 'ops')!).sort()).toEqual([...OPS].sort())
  })
  it('roles outside the allow-list get nothing even with job-board access', () => {
    for (const role of ['regional_setter_manager', 'sub', 'accountant', 'customer', '']) expect(needsYouAudience({ role }, true)).toBe('none')
    for (const role of ['operations', 'admin', 'custom', 'regional_manager']) expect(needsYouAudience({ role }, true)).toBe('ops')
  })
  it('ops output has no dollar amounts in any form', () => {
    expect(JSON.stringify(shapeNeedsYou(FULL, 'ops'))).not.toMatch(/\$|\d{1,3}(,\d{3})+|\d+\.\d{2}/)
  })
})

describe('morning email text for ops', () => {
  it('does not claim jobs "can\'t be paid" (a money fact)', () => {
    const html = buildNeedsYouHtml(shapeNeedsYou(FULL, 'ops')!, 'https://crm.example')
    expect(html).not.toMatch(/can.t be paid|holds pay/i)
    expect(html).toContain('Needs you (3)')
  })
})

describe('morning email recipients', () => {
  it('owner: everything · operations: operational rows, no dollars · setter/closer/unknown/inactive: no section', () => {
    expect(needsYouForEmailRecipient(FULL, { role: 'admin', is_super_admin: true })).toBe(FULL)
    const ops = needsYouForEmailRecipient(FULL, { role: 'operations' })!
    expect(codes(ops).sort()).toEqual(['appointment_no_outcome', 'completed_no_costs', 'materials_not_ordered', 'permit_pending'])
    expect(JSON.stringify(ops)).not.toContain('$')
    for (const v of [{ role: 'setter' }, { role: 'sales_rep' }, { role: 'canvasser' }, undefined, { role: 'operations', active: false }]) {
      expect(needsYouForEmailRecipient(FULL, v as never)).toBeNull()
    }
  })
})

describe('GET /api/needs-you — exactly what each role gets back', () => {
  let GET: () => Promise<Response>
  beforeAll(async () => {
    GET = (await import('@/app/api/needs-you/route')).GET
  })
  beforeEach(() => {
    mockLoad.mockReset().mockResolvedValue(FULL)
    dataHealthDeps.load = (...a: Parameters<typeof dataHealthDeps.load>) => mockLoad(...a)
    mockOps.mockReset()
    mockAuth.mockReset()
  })
  const as = (profile: Record<string, unknown>, canJobBoard: boolean) => {
    mockAuth.mockResolvedValue({ authUser: { id: 'u1' }, profile: { org_id: 'org', active: true, ...profile } })
    mockOps.mockResolvedValue({ canJobBoard })
  }

  it('401 when signed out', async () => {
    mockAuth.mockRejectedValue(new Error('Unauthorized'))
    expect((await GET()).status).toBe(401)
    expect(mockLoad).not.toHaveBeenCalled()
  })
  it.each([['setter', true], ['closer', true], ['sales_rep', false], ['canvasser', false]])('%s → 403, and the check is never even run', async (role, board) => {
    as({ role }, board as boolean)
    const res = await GET()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(mockLoad).not.toHaveBeenCalled()
  })
  it('a user with no job-board access (and not an owner) → 403', async () => {
    as({ role: 'accountant' }, false)
    expect((await GET()).status).toBe(403)
  })
  it('ops → operational rows only, no dollars, no money keys', async () => {
    as({ role: 'operations' }, true)
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.audience).toBe('ops')
    expect(codes(body.report).sort()).toEqual(['appointment_no_outcome', 'completed_no_costs', 'materials_not_ordered', 'permit_pending'])
    expect(JSON.stringify(body)).not.toContain('$')
    expect(JSON.stringify(body)).not.toMatch(/collected_but_short|missing_commission_base|no_setter|sale_amount_mismatch|payPlans|Cam Hill/)
  })
  it('super admin → everything', async () => {
    as({ role: 'admin', is_super_admin: true }, true)
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.audience).toBe('owner')
    expect(body.report).toEqual(FULL)
  })
  it('the response helper type is a real NextResponse (sanity)', async () => {
    as({ role: 'owner' }, false)
    expect(await GET()).toBeInstanceOf(NextResponse)
  })
})
