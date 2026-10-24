import { readFileSync } from 'fs'
import { join } from 'path'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/202610290010_payroll_rls_own_rows.sql'), 'utf8').split('-- ROLLBACK')[0]

const PER_PERSON = [
  'payroll_rep_hours', 'payroll_rep_hours_audit', 'payroll_payout_lines', 'payroll_statement_deliveries',
  'payroll_chargebacks', 'deal_commission_roles', 'payroll_bonus_lines',
]
const ORG_LEVEL = ['payroll_job_snapshots', 'payroll_period_snapshots', 'payroll_override_audit', 'job_payroll_state']

function policyFor(table: string): string {
  const m = sql.match(new RegExp(`create policy \\w+ on public\\.${table} for select[\\s\\S]*?;`))
  if (!m) throw new Error(`no select policy for ${table}`)
  return m[0]
}

describe('payroll RLS: own rows or payroll admin', () => {
  it.each(PER_PERSON)('%s limits to own rows or payroll admin', (t) => {
    const p = policyFor(t)
    expect(p).toContain('user_id = auth.uid()')
    expect(p).toContain('public.is_payroll_admin()')
    expect(p).toContain('to authenticated')
  })

  it.each(ORG_LEVEL)('%s is payroll-admin only', (t) => {
    const p = policyFor(t)
    expect(p).toContain('public.is_payroll_admin()')
    expect(p).not.toContain('user_id = auth.uid()')
  })

  it('chargeback applications follow their chargeback', () => {
    const p = policyFor('payroll_chargeback_applications')
    expect(p).toContain('pc.user_id = auth.uid()')
    expect(p).toContain('public.is_payroll_admin()')
  })

  it('the admin helper mirrors PAYROLL_ADMIN_ROLES and never includes managers', () => {
    const { PAYROLL_ADMIN_ROLES } = require('@/lib/payroll-admin-access') as { PAYROLL_ADMIN_ROLES: readonly string[] }
    const listed = (sql.match(/in \(([^)]*)\) or coalesce\(u\.is_super_admin/)?.[1] ?? '')
      .split(',').map((s) => s.trim().replace(/'/g, '')).sort()
    expect(listed).toEqual([...PAYROLL_ADMIN_ROLES].sort())
  })

  it('no bare org-wide select policy is left in the migration', () => {
    expect(sql).not.toMatch(/using \(org_id = get_user_org_id\(auth\.uid\(\)\)\);/)
  })
})
