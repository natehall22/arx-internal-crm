import { readFileSync } from 'fs'
import { join } from 'path'

import { DATASETS } from '@/lib/reporting/catalog'
import { REPORT_TEMPLATES, specTouchesFinancials } from '@/lib/reporting/templates'
import { proposalQueue } from '@/lib/today'
import { FINANCIALS_PERMISSION, hasFinancials } from '@/lib/financials-access'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('reports:financials', () => {
  it('is one named permission, seeded by migration', () => {
    expect(FINANCIALS_PERMISSION).toBe('reports:financials')
    expect(read('supabase/migrations/202610290100_reports_financials_permission.sql')).toContain("'reports:financials'")
    expect(read('lib/permissions.ts')).toContain("'reports:financials'")
  })

  it('admins / owners (full access) and explicit grants pass; report-viewing and job-money permissions do not', () => {
    expect(hasFinancials({ fullAccess: true, permissionNames: new Set() })).toBe(true)
    expect(hasFinancials({ fullAccess: false, permissionNames: new Set(['reports:financials']) })).toBe(true)
    for (const p of ['reports:view_all', 'reports:export', 'reports:create', 'jobs:financials:view', 'admin:settings']) {
      expect(hasFinancials({ fullAccess: false, permissionNames: new Set([p]) })).toBe(false)
    }
  })

  it('no dataset exposes a money column to a viewer without it', () => {
    for (const ds of Object.values(DATASETS)) for (const col of ds.columns) if (col.type === 'money') expect(col.sensitive).toBe(true)
    for (const key of ['payments', 'job_costs', 'payroll_lines'] as const) expect(DATASETS[key].financeOnly).toBe(true)
  })

  it('every template that reads money is flagged, so it is hidden from people without the permission', () => {
    for (const t of REPORT_TEMPLATES) expect({ key: t.key, flagged: !!t.finance }).toEqual({ key: t.key, flagged: specTouchesFinancials(t.spec) })
    const open = REPORT_TEMPLATES.filter((t) => !t.finance).map((t) => t.key)
    expect(open).toEqual(expect.arrayContaining(['doors-by-rep', 'jobs-by-status', 'materials-status']))
    expect(open).not.toContain('sales-by-closer')
  })

  it('Today shows a proposal total only with the permission', () => {
    const row = { id: 'p1', customer_name: 'Pat', proposal_number: 12, total: 18400 }
    expect(proposalQueue([row], 1, false).items[0].detail).not.toMatch(/\$|18/)
    expect(proposalQueue([row], 1, true).items[0].detail).toContain('$18,400')
  })

  it('scheduled reports run once per recipient as that recipient', () => {
    const src = read('lib/reporting/scheduled.ts')
    expect(src).toMatch(/for \(const person of/)
    expect(src).toMatch(/buildReportContext\(admin, person\)/)
    expect(src).toContain('ReportAccessError')
  })

  it('the forecast, AI assistant and job Financials card ask for it', () => {
    expect(read('app/api/reports/forecast/route.ts')).toContain('hasFinancials')
    expect(read('app/api/ai/chat/route.ts')).toContain('hasFinancials')
    expect(read('app/ops/jobs/[id]/JobView.tsx')).toContain('hasFinancials')
    expect(read('app/ops/jobs/[id]/JobDetailClient.tsx')).toMatch(/canViewProfitability && canViewReportFinancials/)
  })
})
