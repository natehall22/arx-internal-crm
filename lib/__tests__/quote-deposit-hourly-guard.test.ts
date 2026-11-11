/** @jest-environment node */
/** A job with a (non-void) deposit invoice cannot be switched to hourly billing: the deposit would be owed twice. */
import { saveJobHourlySetup } from '@/lib/hourly-billing-db'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const ORG = 'org1'
const JOB = '22222222-2222-4222-8222-000000000001'
const LABOR = '33333333-3333-4333-8333-000000000001'
const patch = { mode: 'time_materials' as const, estimatedHours: 8, rateItemId: LABOR }

describe('hourly switch vs quote deposit', () => {
  it('refuses while a deposit invoice is live, and changes nothing', async () => {
    const db = createFakeDb({
      production_jobs: [{ id: JOB, org_id: ORG, billing_mode: null }],
      job_invoices: [{ id: 'dep', org_id: ORG, job_id: JOB, invoice_kind: 'deposit', status: 'sent' }],
    })
    const r = await saveJobHourlySetup(db.client, ORG, JOB, patch)
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect((r as { error: string }).error).toMatch(/Void or credit the deposit first/)
    expect(db.tables.production_jobs[0].billing_mode).toBeNull()
  })

  it('a voided deposit does not block (rate check comes next)', async () => {
    const db = createFakeDb({
      production_jobs: [{ id: JOB, org_id: ORG, billing_mode: null }],
      job_invoices: [{ id: 'dep', org_id: ORG, job_id: JOB, invoice_kind: 'deposit', status: 'void' }],
    })
    const r = await saveJobHourlySetup(db.client, ORG, JOB, patch)
    expect((r as { error?: string }).error ?? '').not.toMatch(/deposit/)
  })
})
