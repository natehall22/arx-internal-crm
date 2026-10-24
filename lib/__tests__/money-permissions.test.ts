import { readFileSync } from 'fs'
import { join } from 'path'

import { hasFinancials, hasMoneyRecord } from '@/lib/financials-access'
import { setMoneyAccess } from '@/lib/money-access'
import { getPermissions } from '@/lib/permissions'
import { DATASETS } from '@/lib/reporting/catalog'
import { checkAccess, needsFinancials, visibleColumns, type ReportContext } from '@/lib/reporting/run'
import { parseSpec } from '@/lib/reporting/report-spec'
import { specTouchesFinancials } from '@/lib/reporting/templates'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const ctx = (over: Partial<ReportContext> = {}): ReportContext => ({ orgId: 'o', userId: 'u1', scope: 'own', finance: false, canExport: true, scopedUserIds: ['u1'], ...over })

describe('two money permissions', () => {
  it('admins have both through full access; operations has money:record but NOT company financials', () => {
    expect(hasFinancials({ fullAccess: true, permissionNames: new Set() })).toBe(true)
    expect(hasMoneyRecord({ fullAccess: true, permissionNames: new Set() })).toBe(true)
    const ops = new Set(getPermissions('operations'))
    expect(hasMoneyRecord({ fullAccess: false, permissionNames: ops })).toBe(true)
    expect(hasFinancials({ fullAccess: false, permissionNames: ops })).toBe(false)
  })
  it('closers, setters and managers have neither by default', () => {
    for (const role of ['sales_rep', 'setter', 'canvasser', 'sales_manager', 'regional_manager'] as const) {
      const perms = new Set(getPermissions(role))
      expect({ role, rec: hasMoneyRecord({ fullAccess: false, permissionNames: perms }) }).toEqual({ role, rec: false })
      expect({ role, fin: hasFinancials({ fullAccess: false, permissionNames: perms }) }).toEqual({ role, fin: false })
    }
  })
  it('an owner-set OFF switch beats full access and a grant', () => {
    expect(hasFinancials({ fullAccess: true, permissionNames: new Set(), denied: new Set(['reports:financials']) })).toBe(false)
    expect(hasFinancials({ fullAccess: false, permissionNames: new Set(['reports:financials']), denied: new Set(['reports:financials']) })).toBe(false)
    expect(hasMoneyRecord({ fullAccess: true, permissionNames: new Set(), denied: new Set(['reports:financials']) })).toBe(true) // only the named one
  })
})

describe('own money stays visible', () => {
  it('a rep (scope own) sees sale prices on their own deals but not cost, margin, pay or payments', () => {
    const own = ctx()
    const sales = DATASETS.sales
    expect(visibleColumns(own, sales).map((c) => c.key)).toContain('amount')
    const jobs = DATASETS.jobs
    const keys = visibleColumns(own, jobs).map((c) => c.key)
    expect(keys).toContain('sale_amount')
    for (const k of ['cost_total', 'profit_before_commission', 'dealer_fee', 'collected', 'balance_due']) expect(keys).not.toContain(k)
    const total = parseSpec({ dataset: 'sales', metric: { kind: 'sum', column: 'amount' } })
    if (!total.ok) throw new Error('bad spec')
    expect(() => checkAccess(own, sales, total.spec)).not.toThrow()
    const pay = parseSpec({ dataset: 'payments', metric: { kind: 'count' } })
    if (!pay.ok) throw new Error('bad spec')
    expect(() => checkAccess(own, DATASETS.payments, pay.spec)).toThrow()
  })
  it('company totals (scope all / team / region) need reports:financials', () => {
    for (const scope of ['all', 'team', 'region'] as const) {
      expect(needsFinancials(ctx({ scope }), DATASETS.sales.columns.find((c) => c.key === 'amount'))).toBe(true)
    }
    expect(needsFinancials(ctx({ scope: 'all', finance: true }), DATASETS.sales.columns.find((c) => c.key === 'amount'))).toBe(false)
  })
  it('templates: sales by closer is open to an own-scope viewer, closed to company scope', () => {
    const spec = parseSpec({ dataset: 'sales', groupBy: 'closer', metric: { kind: 'sum', column: 'amount' } })
    if (!spec.ok) throw new Error('bad spec')
    expect(specTouchesFinancials(spec.spec, 'own')).toBe(false)
    expect(specTouchesFinancials(spec.spec, 'all')).toBe(true)
  })
  it('the AI assistant and Today keep a rep\'s own figures', () => {
    const ai = read('app/api/ai/chat/route.ts')
    expect(ai).toContain('redactFinancials: salesDocAccessBarred,')
    expect(read('app/today/page.tsx')).toContain('{ money: true }')
  })
})

describe('changing money access', () => {
  type Row = Record<string, unknown>
  function fake(state: { denials: Row[]; grants: Row[]; audit: Row[]; users: Row[] }) {
    const table = (name: string) => {
      const rows = name === 'permission_denials' ? state.denials : name === 'user_permissions' ? state.grants : name === 'permission_audit' ? state.audit : name === 'users' ? state.users : [{ id: 'perm1', name: 'reports:financials' }, { id: 'perm2', name: 'money:record' }]
      let filters: Array<[string, unknown]> = []
      const api: any = {
        select: () => api, eq: (c: string, v: unknown) => { filters.push([c, v]); return api },
        maybeSingle: async () => ({ data: rows.find((r) => filters.every(([c, v]) => r[c] === v)) ?? null }),
        insert: async (v: Row) => { rows.push(v); return { error: null } },
        delete: () => ({ eq: (c: string, v: unknown) => ({ eq: async (c2: string, v2: unknown) => { const keep = rows.filter((r) => !(r[c] === v && r[c2] === v2)); rows.length = 0; rows.push(...keep); return {} } }) }),
      }
      return api
    }
    return { from: table } as never
  }
  const owner = { id: 'own', org_id: 'o', role: 'admin', is_super_admin: true }
  it('only an owner can change it, an owner cannot be switched off, and every change is audited', async () => {
    const state = { denials: [] as Row[], grants: [] as Row[], audit: [] as Row[], users: [{ id: 't1', org_id: 'o', role: 'admin', is_super_admin: false, active: true }, { id: 'own2', org_id: 'o', role: 'admin', is_super_admin: true, active: true }] }
    const admin = fake(state)
    const notOwner = await setMoneyAccess(admin, { id: 'a', org_id: 'o', role: 'admin', is_super_admin: false }, { userId: 't1', permission: 'reports:financials', mode: 'deny' })
    expect(notOwner).toMatchObject({ ok: false, status: 403 })
    const ownerTarget = await setMoneyAccess(admin, owner, { userId: 'own2', permission: 'reports:financials', mode: 'deny' })
    expect(ownerTarget).toMatchObject({ ok: false, status: 400 })
    const done = await setMoneyAccess(admin, owner, { userId: 't1', permission: 'reports:financials', mode: 'deny' })
    expect(done).toMatchObject({ ok: true, before: 'default', after: 'deny' })
    expect(state.denials).toHaveLength(1)
    expect(state.audit).toEqual([expect.objectContaining({ actor_user_id: 'own', target_user_id: 't1', permission_name: 'reports:financials', action: 'deny', before_state: 'default', after_state: 'deny' })])
    const again = await setMoneyAccess(admin, owner, { userId: 't1', permission: 'reports:financials', mode: 'deny' })
    expect(again).toMatchObject({ ok: true })
    expect(state.audit).toHaveLength(1) // unchanged state writes no new audit row
  })
  it('the migration makes both tables service-role only', () => {
    const sql = read('supabase/migrations/202610290110_money_permissions_overrides.sql')
    expect(sql).toMatch(/permission_denials[\s\S]*enable row level security/)
    expect(sql).toMatch(/permission_audit[\s\S]*enable row level security/)
    expect(sql).not.toMatch(/create policy/i)
    expect(sql).toContain("'money:record'")
  })
  it('the job billing routes ask for money:record', () => {
    const src = read('lib/finance-access.ts')
    expect(src).toContain('canRecordMoney')
    expect(src).not.toMatch(/role === 'regional_manager'/)
  })
})
