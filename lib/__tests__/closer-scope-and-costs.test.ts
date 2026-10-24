import { readFileSync } from 'fs'
import { join } from 'path'

import { isCloserScoped, mayAccessDealDoc } from '@/lib/deal-scope'
import { canSeePricebookCosts, stripPricebookCosts } from '@/lib/pricebook-costs'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const sql80 = read('supabase/migrations/202610290080_closer_deal_scope_and_pricebook_costs.sql').split('-- ROLLBACK')[0]
const sql90 = read('supabase/migrations/202610290090_comp_plans_own_only.sql').split('-- ROLLBACK')[0]

describe('closer deal scope', () => {
  it.each(['rep', 'sales_rep', 'closer'])('%s is scoped', (r) => expect(isCloserScoped({ role: r })).toBe(true))
  it.each(['admin', 'owner', 'operations', 'sales_manager', 'regional_manager', 'setter', 'sub'])('%s is not', (r) => expect(isCloserScoped({ role: r })).toBe(false))
  it('a super admin is never scoped', () => expect(isCloserScoped({ role: 'sales_rep', is_super_admin: true })).toBe(false))

  it('own proposal or own deal passes, a stranger deal fails', async () => {
    const admin = { rpc: async (_n: string, a: { p_ids: string[] }) => ({ data: a.p_ids.filter((i) => i === 'mine') }) } as never
    const me = { id: 'u1', role: 'sales_rep' }
    expect(await mayAccessDealDoc(admin, me, { created_by: 'u1', opportunity_id: null })).toBe(true)
    expect(await mayAccessDealDoc(admin, me, { created_by: 'u2', opportunity_id: 'mine' })).toBe(true)
    expect(await mayAccessDealDoc(admin, me, { created_by: 'u2', opportunity_id: 'other' })).toBe(false)
    expect(await mayAccessDealDoc(admin, { id: 'm1', role: 'sales_manager' }, { created_by: 'u2', opportunity_id: 'other' })).toBe(true)
  })

  it('the migration is restrictive select only and avoids inline cross-table sub-selects (policy recursion)', () => {
    for (const m of Array.from(sql80.matchAll(/create policy[^;]*;/gi))) expect(m[0]).toMatch(/restrictive|format\(/i)
    expect(sql80).not.toMatch(/using \([^;]*exists \(select 1 from public\.(proposals|production_jobs|job_invoices)/)
  })
})

describe('pricebook cost columns', () => {
  const rows = [{ id: 'a', name: 'Shingles', unit_price: 10, cost_price: 4, material_cost: 3, labor_cost: 1, profit_margin_percent: 60 }]
  it('only owners, admins and ops see cost / margin', () => {
    for (const r of ['admin', 'owner', 'operations']) expect(canSeePricebookCosts(r)).toBe(true)
    for (const r of ['sales_rep', 'sales_manager', 'regional_manager', 'setter', 'canvasser']) expect(canSeePricebookCosts(r)).toBe(false)
    expect(canSeePricebookCosts('sales_rep', true)).toBe(true)
  })
  it('sales roles keep sell prices and lose cost', () => {
    expect(stripPricebookCosts(rows, 'sales_rep')).toEqual([{ id: 'a', name: 'Shingles', unit_price: 10 }])
    expect(stripPricebookCosts(rows, 'admin')).toEqual(rows)
  })
  it('the database refuses the cost columns to every user token', () => {
    expect(sql80).toMatch(/revoke select on public\.pricebook_items from authenticated, anon/)
    expect(sql80).not.toMatch(/grant select \([^)]*(cost_price|material_cost|labor_cost|profit_margin_percent)/)
  })
  it.each(['app/api/proposals/builder/route.ts', 'app/pricebook/page.tsx'])('%s strips costs', (f) => expect(read(f)).toContain('stripPricebookCosts'))
})

describe('comp plans own only', () => {
  it('restrictive, payroll admin or own', () => {
    for (const m of Array.from(sql90.matchAll(/create policy[^;]*;/gi))) {
      expect(m[0]).toMatch(/restrictive/i)
      expect(m[0]).toContain('is_payroll_admin()')
    }
    expect(sql90).toContain('user_id = auth.uid()')
  })
})
