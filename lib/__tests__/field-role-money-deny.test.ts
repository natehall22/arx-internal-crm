import { readFileSync } from 'fs'
import { join } from 'path'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/202610290020_field_role_money_deny.sql'), 'utf8').split('-- ROLLBACK')[0]

describe('field-role money deny (RLS)', () => {
  it('uses restrictive policies only, so no existing rule is loosened', () => {
    expect(sql).not.toMatch(/create policy [^;]*for (insert|update|delete|all)/i)
    for (const m of sql.matchAll(/create policy[^;]*/gi)) expect(m[0]).toMatch(/restrictive/i)
  })

  it.each(['proposals', 'proposal_line_items', 'order_form_contracts', 'job_payments', 'production_jobs', 'pricebook_items'])('%s is closed to field roles', (t) => {
    expect(sql).toMatch(new RegExp(`'${t}'`))
    expect(sql).toContain('not public.is_field_role_self()')
  })

  it.each(['job_cost_lines', 'job_product_orders', 'cost_attachments', 'material_orders'])('%s is job-board only', (t) => {
    expect(sql).toMatch(new RegExp(`'${t}'`))
    expect(sql).toContain('public.can_view_job_board_self()')
  })

  it('setter ramp pay is own row, manager or payroll admin', () => {
    expect(sql).toMatch(/setter_ramp_weekly_status[\s\S]*user_id = auth\.uid\(\)[\s\S]*is_admin_or_manager[\s\S]*is_payroll_admin/)
  })
})
