import fs from 'fs'
import path from 'path'

/**
 * Every place that decides "is this job payroll's to pay or list" must skip jobs settled outside the CRM. These are static
 * guards (the routes are heavy to run): if someone adds a payroll job query and forgets the filter, add it here.
 */
const root = path.join(__dirname, '..', '..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

describe('settled-externally jobs are excluded from payroll surfaces', () => {
  it.each([
    ['lock / materialization', 'lib/payroll-period-materialization.ts', ".is('payroll_settled_externally_at', null)"],
    ['weekly worksheet', 'app/api/admin/payroll/weekly/worksheet/route.ts', ".is('payroll_settled_externally_at', null)"],
    ['payroll export preview', 'app/api/admin/payroll/export/route.ts', ".is('payroll_settled_externally_at', null)"],
    ['per-job overrides (409)', 'app/api/admin/payroll/deal-commission-roles/route.ts', 'payroll_settled_externally_at'],
    ['Needs you', 'lib/data-health.ts', 'isSettledExternally'],
  ])('%s', (_name, file, needle) => {
    expect(read(file)).toContain(needle)
  })
})
