import { readFileSync } from 'fs'
import { join } from 'path'

import { DATASETS } from '@/lib/reporting/catalog'
import { parseSpec } from '@/lib/reporting/report-spec'
import { REPORT_TEMPLATES, specTouchesFinancials, templateByKey } from '@/lib/reporting/templates'

const mig = readFileSync(join(process.cwd(), 'supabase/migrations/202611240020_work_categories.sql'), 'utf8')
const sql = mig.replace(/--.*$/gm, '')
const viewSql = (name: string) => {
  const a = sql.search(new RegExp(`create or replace view (public\\.)?${name}\\b`, 'i'))
  const rest = sql.slice(a + 10)
  const next = rest.search(/create or replace view/i)
  return sql.slice(a, next === -1 ? undefined : a + 10 + next)
}

describe('work categories in the reporting views (migration 202611240020)', () => {
  it('is additive: nullable columns, replaced views only, nothing dropped or backfilled', () => {
    expect(sql).toMatch(/alter table public\.customers add column if not exists category text;/)
    expect(sql).toMatch(/alter table public\.production_jobs add column if not exists category text;/)
    expect(sql).not.toMatch(/\bdrop\b/i)
    expect(sql).not.toMatch(/\bupdate\b[\s\S]{0,40}\bset\b/i) // no backfill
    expect(sql.match(/create or replace view/gi)).toHaveLength(3) // rpt_jobs, rpt_invoices, rpt_revenue
  })

  it.each([['rpt_jobs'], ['rpt_invoices'], ['rpt_revenue']])('%s: security_invoker, closed to the browser roles, `category` is the LAST column', (name) => {
    const v = viewSql(name)
    expect(v).toMatch(/security_invoker = true/i)
    expect(sql).toMatch(new RegExp(`revoke all on (public\\.)?${name} from anon, authenticated`, 'i'))
    const select = name === 'rpt_revenue' ? v.slice(v.lastIndexOf('select org_id,')) : v
    const lastAlias = Array.from(select.matchAll(/\bas (\w+)\s*(?:\n|,|$)/gi)).map((m) => m[1])
    expect(lastAlias[lastAlias.length - 1] === 'category' || /as category\s*\n\s*from/i.test(select)).toBe(true)
  })

  it('the job-level views use the effective category: job override, else the customer', () => {
    expect(viewSql('rpt_jobs')).toMatch(/COALESCE\(NULLIF\(j\.category, ''\), NULLIF\(cu\.category, ''\)\)/)
    // every revenue branch that has a job uses job ?? customer; the no-job service branches use the customer only
    const rev = viewSql('rpt_revenue')
    expect(rev.match(/coalesce\(nullif\(j\.category, ''\), nullif\(cu\.category, ''\)\)/g)).toHaveLength(5) // contract, jobtax, tm, tmtax, payments
    expect(rev.match(/nullif\(cu\.category, ''\)\s*\n\s*from/g)).toHaveLength(3) // service lines, remainder, tax
  })

  it('the customer join cannot multiply rows: it is by id and company', () => {
    expect(viewSql('rpt_jobs')).toMatch(/LEFT JOIN customers cu ON cu\.id = j\.customer_id AND cu\.org_id = j\.org_id/)
  })

  it('the catalog offers Category on Jobs, Service invoices and Revenue — not sensitive', () => {
    for (const key of ['jobs', 'invoices', 'revenue'] as const) {
      const col = DATASETS[key].columns.find((c) => c.key === 'category')
      expect(col).toMatchObject({ key: 'category', label: 'Category', type: 'text' })
      expect(col?.sensitive).toBeUndefined()
    }
  })

  it('"Jobs by category" is not a finance report (field roles can group by it); "Revenue by category" is', () => {
    const jobs = templateByKey('jobs-by-category')!
    const rev = templateByKey('revenue-by-category')!
    for (const t of [jobs, rev]) expect(parseSpec(t.spec).ok).toBe(true)
    expect(specTouchesFinancials(jobs.spec)).toBe(false)
    expect(specTouchesFinancials(rev.spec)).toBe(true)
    expect(REPORT_TEMPLATES.find((t) => t.key === 'revenue-by-category')?.finance).toBe(true)
    expect(REPORT_TEMPLATES.find((t) => t.key === 'jobs-by-category')?.finance).toBeFalsy()
  })
})
