import { readFileSync } from 'fs'
import { join } from 'path'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/202610290060_pay_writes_payroll_admin.sql'), 'utf8').split('-- ROLLBACK')[0]

describe('pay-table writes are payroll-admin only (RLS)', () => {
  it.each(['payroll_bonus_lines', 'program_444_enrollments', 'setter_ramp_enrollments', 'setter_ramp_weekly_status', 'spiff_achievements', 'spiff_programs'])('%s', (t) => {
    expect(sql).toContain(`'${t}'`)
  })
  it('every write policy needs is_payroll_admin and never a manager helper', () => {
    for (const cmd of ['insert', 'update', 'delete']) expect(sql).toMatch(new RegExp(`create policy payroll_admin_${cmd}[^;]*is_payroll_admin\\(\\)`))
    expect(sql).not.toMatch(/create policy[^;]*is_admin_or_manager/)
  })
})
