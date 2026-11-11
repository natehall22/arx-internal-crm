/**
 * Byte-for-byte: with PAYROLL_PAY_WEEK_ENABLED off, a LEGACY week's statement (no units_frozen_at) — the payload, the email subject
 * and HTML — is exactly what the code produced before payroll phase 1 (golden generated on integration/multi-company @e9bbe45 by
 * running this same file with GOLDEN_WRITE=1). Covers commission, hours, per-unit, bonus, fixes and the legacy per-unit window.
 */
jest.mock('jspdf', () => ({ jsPDF: jest.fn() }))
import fs from 'fs'
import path from 'path'

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { buildPayrollStatement } from '@/lib/payroll-statement'
import { buildPayrollStatementEmailHtml, buildPayrollStatementEmailSubject } from '@/lib/payroll-statement-email'

const GOLDEN = path.join(process.cwd(), 'lib/__tests__/fixtures/payroll-legacy-statement.golden.json')
const ORG = 'org1'

function build() {
  return createFakeDb(
    {
      orgs: [{ id: ORG, timezone: 'America/New_York', settings: {} }],
      payroll_periods: [
        { id: 'p0', org_id: ORG, period_label: '2026-W33', cutoff_at: '2026-08-09T14:24:00Z', scheduled_pay_date: '2026-08-14', status: 'locked', units_frozen_at: null },
        { id: 'p1', org_id: ORG, period_label: '2026-W34', cutoff_at: '2026-08-16T22:10:00Z', scheduled_pay_date: '2026-08-21', status: 'locked', units_frozen_at: null },
      ],
      users: [{ id: 'u1', org_id: ORG, full_name: 'Jordan Vale', role: 'sales_rep', active: true }],
      production_jobs: [{ id: 'j1', org_id: ORG, job_number: '26-0141', customer_id: 'c1', commission_comp_base: 20000, ntp_date: '2026-08-01', commission_hold_status: null, completed_at: '2026-08-12T15:00:00Z', sale_date: '2026-08-01' }],
      customers: [{ id: 'c1', org_id: ORG, name: 'Ashley Example' }],
      payroll_payout_lines: [{ id: 'l1', org_id: ORG, payroll_period_id: 'p1', job_id: 'j1', user_id: 'u1', participant_role: 'sales_rep', gross_amount: 1400, net_amount: 1400, chargeback_applied_amount: 0, hourly_earnings: 0, total_earnings: 1400, payroll_job_snapshot_id: 's1' }],
      payroll_rep_hours: [{ org_id: ORG, payroll_period_id: 'p1', user_id: 'u1', regular_hours: 10, overtime_hours: 1, hourly_rate_snapshot: 18, hourly_earnings: 207, notes: 'n' }],
      payroll_bonus_lines: [{ id: 'b1', org_id: ORG, payroll_period_id: 'p1', user_id: 'u1', bonus_type: 'manual', amount: 250, description: 'Spiff', status: 'approved' }],
      payroll_adjustments: [{ id: 'a1', org_id: ORG, payroll_period_id: 'p1', user_id: 'u1', amount: -50, reason: 'Fix 26-0120', kind: 'fix', status: 'applied', job_id: null }],
      payroll_chargebacks: [],
      deal_commission_roles: [],
      user_comp_plans: [],
      comp_plans: [],
    },
    { relations: { user_comp_plans: { comp_plans: { table: 'comp_plans', fk: 'comp_plan_id' } } } }
  )
}

describe('legacy statement is byte-identical while the flag is off', () => {
  it('payload + email subject + email HTML equal the pre-phase-1 golden', async () => {
    delete process.env.PAYROLL_PAY_WEEK_ENABLED
    const statement = await buildPayrollStatement(build().client, ORG, 'p1', 'u1')
    expect(statement).not.toBeNull()
    const out = {
      statement,
      subject: buildPayrollStatementEmailSubject(statement!),
      html: buildPayrollStatementEmailHtml({ recipientName: 'Jordan', statement: statement!, statementUrl: 'https://crm.example.test/s', pdfAttached: true }),
    }
    const text = JSON.stringify(out, null, 2) + '\n'
    if (process.env.GOLDEN_WRITE) {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true })
      fs.writeFileSync(GOLDEN, text)
    }
    expect(text).toBe(fs.readFileSync(GOLDEN, 'utf8'))
  })
})
