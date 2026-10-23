/** @jest-environment node */
import { unsettleJob } from '@/lib/job-settlement'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const ORG = 'org1'
const seed = () => ({
  production_jobs: [
    { id: 'j1', org_id: ORG, job_number: '26-0001', status: 'collected', payroll_settled_externally_at: '2026-10-25T00:00:00Z', settled_externally_reason: 'paid outside CRM before cutover' },
    { id: 'j2', org_id: ORG, job_number: '26-0002', status: 'collected', payroll_settled_externally_at: null, settled_externally_reason: null },
    { id: 'jx', org_id: 'other', job_number: '99-1', status: 'collected', payroll_settled_externally_at: '2026-10-25T00:00:00Z' },
  ],
})

describe('unsettleJob', () => {
  it('needs a reason', async () => {
    const db = createFakeDb(seed())
    expect(await unsettleJob(db.client, { orgId: ORG, actorUserId: 'o', jobId: 'j1', reason: '  ' })).toMatchObject({ ok: false, status: 400 })
    expect(db.tables.production_jobs[0].payroll_settled_externally_at).toBeTruthy()
  })
  it('clears the flag and writes one audit row with before and after', async () => {
    const db = createFakeDb(seed())
    expect(await unsettleJob(db.client, { orgId: ORG, actorUserId: 'owner', jobId: 'j1', reason: 'Was never actually paid' })).toEqual({ ok: true })
    expect(db.tables.production_jobs[0].payroll_settled_externally_at).toBeNull()
    expect(db.tables.production_jobs[0].settled_externally_reason).toBeNull()
    expect(db.tables.payroll_override_audit).toHaveLength(1)
    expect(db.tables.payroll_override_audit[0]).toMatchObject({ override_type: 'unsettle_externally', job_id: 'j1', actor_user_id: 'owner', reason: 'Was never actually paid', before_value: { settled_externally_reason: 'paid outside CRM before cutover' } })
  })
  it('refuses a job that is not settled, another org\'s job, and a second click', async () => {
    const db = createFakeDb(seed())
    expect(await unsettleJob(db.client, { orgId: ORG, actorUserId: 'o', jobId: 'j2', reason: 'x' })).toMatchObject({ ok: false, status: 409 })
    expect(await unsettleJob(db.client, { orgId: ORG, actorUserId: 'o', jobId: 'jx', reason: 'x' })).toMatchObject({ ok: false, status: 404 })
    await unsettleJob(db.client, { orgId: ORG, actorUserId: 'o', jobId: 'j1', reason: 'x' })
    expect(await unsettleJob(db.client, { orgId: ORG, actorUserId: 'o', jobId: 'j1', reason: 'x' })).toMatchObject({ ok: false, status: 409 })
    expect(db.tables.payroll_override_audit).toHaveLength(1)
  })
})

describe('DELETE /api/ops/jobs/[id]/settled-externally', () => {
  const mockAuth = jest.fn()
  jest.mock('@/lib/auth', () => ({ requireAuthApi: () => mockAuth() }))
  jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
  const call = async (profile: Record<string, unknown> | null) => {
    jest.resetModules()
    if (profile) mockAuth.mockResolvedValue({ profile: { org_id: 'o', id: 'u', active: true, ...profile } })
    else mockAuth.mockRejectedValue(new Error('x'))
    const { DELETE } = await import('@/app/api/ops/jobs/[id]/settled-externally/route')
    return DELETE(new Request('http://x', { method: 'DELETE', body: JSON.stringify({ reason: 'r' }) }), { params: { id: '00000000-0000-4000-8000-000000000001' } })
  }
  it('signed out → 401; admin who is not an owner → 403; ops → 403', async () => {
    expect((await call(null)).status).toBe(401)
    expect((await call({ role: 'admin', is_super_admin: false })).status).toBe(403)
    expect((await call({ role: 'operations' })).status).toBe(403)
  })
})
