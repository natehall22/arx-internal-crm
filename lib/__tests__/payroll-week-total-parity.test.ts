/**
 * Known Redundancy #15 folded: "what is a person's total for a pay week" has ONE definition, PAY_LINE_SOURCES
 * (lib/payroll-week-total.ts). This test reads the SQL validator from the newest migration that defines it and fails if any
 * source table, amount column or filter differs — so a new pay-line kind cannot be added to one side only.
 */
import fs from 'fs'
import path from 'path'

import { composeWeek } from '@/lib/payroll-pay-week'
import { PAY_LINE_SOURCES, personRawTotal, personTotalsFromTables } from '@/lib/payroll-week-total'

const MIGRATIONS = path.join(process.cwd(), 'supabase/migrations')
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

function latestSqlTotals(): { file: string; body: string } {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()
  let found: { file: string; body: string } | null = null
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')
    const m = sql.match(/CREATE OR REPLACE FUNCTION public\.payroll_week_person_totals\([^)]*\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/)
    if (m) found = { file: f, body: m[1] }
  }
  if (!found) throw new Error('payroll_week_person_totals not found in any migration')
  return found
}

function parseSources(body: string) {
  const inner = body.slice(body.indexOf('FROM (') + 'FROM ('.length, body.lastIndexOf(') x GROUP BY'))
  return inner.split(/UNION ALL/).map((part) => {
    const p = norm(part)
    const m = p.match(/^SELECT (\w)\.user_id, round\(\1\.(\w+), 2\)(?: AS amt)? FROM (\w+) \1 WHERE \1\.org_id = p_org_id AND \1\.payroll_period_id = p_period_id(?: AND (.*))?$/)
    if (!m) throw new Error(`Unrecognised UNION part: ${p}`)
    return { table: m[3], amount: m[2], filter: m[4] ? norm(m[4]) : null }
  })
}

describe('one weekly-total definition', () => {
  const { file, body } = latestSqlTotals()

  it(`SQL (${file}) and PAY_LINE_SOURCES list the same sources, amounts and filters, in the same order`, () => {
    expect(parseSources(body)).toEqual(PAY_LINE_SOURCES.map((s) => ({ table: s.table, amount: s.amount, filter: s.sqlFilter ? norm(s.sqlFilter) : null })))
  })

  it('the SQL rounds each line to the cent, then the sum (as personRawTotal does)', () => {
    expect(norm(body)).toMatch(/SELECT x\.user_id, round\(sum\(x\.amt\), 2\) AS raw FROM/)
    expect(personRawTotal([{ amount: 0.005 }, { amount: 0.005 }])).toBe(0.02) // 0.01 + 0.01, not round(0.01)
  })

  it('every kind composeWeek can emit is a source (the screen cannot show a line the database does not count)', () => {
    const { people } = composeWeek({
      rows: [{ job_id: 'j', user_id: 'u', participant_role: 'setter', gross_amount: 100, net_amount: 100, comp_plan_snapshot: {} }],
      jobs: new Map(),
      names: new Map(),
      hours: [{ user_id: 'u', full_name: '', role: '', plan_name: null, plan_type: null, hourly_rate: 10, regular_hours: 1, overtime_hours: 0, hourly_earnings: 10, notes: null, has_entry: true }],
      units: new Map([['u', 5]]),
      bonuses: [{ id: 'b', userId: 'u', amount: 7, description: null, bonusType: 'manual' }],
      adjustments: [{ id: 'a', userId: 'u', amount: -2, reason: 'x', kind: 'fix', status: 'pending', jobId: null } as never],
      minimums: [{ userId: 'u', amount: 380, detail: { minimum: 500, commission: 100, planName: null } }],
    })
    const kinds = new Set(people[0].lines.map((l) => l.kind))
    expect(Array.from(kinds).sort()).toEqual(PAY_LINE_SOURCES.map((s) => s.kind).sort())
    expect(people[0].raw).toBe(500)
  })

  it('the stored-rows total (fake database) equals the screen total for the same week', () => {
    const t = (rows: Array<Record<string, unknown>>) => rows.map((r) => ({ org_id: 'o', payroll_period_id: 'p', user_id: 'u', ...r }))
    const totals = personTotalsFromTables(
      {
        payroll_payout_lines: t([{ net_amount: 100.004 }]),
        payroll_rep_hours: t([{ hourly_earnings: 10 }, { hourly_earnings: 0 }]),
        payroll_unit_earnings: t([{ amount: 5 }]),
        payroll_week_minimums: t([{ amount: 380 }, { amount: null }]),
        payroll_bonus_lines: t([{ amount: 7, status: 'approved' }, { amount: 99, status: 'pending_approval' }, { amount: 99, status: 'rejected' }]),
        payroll_adjustments: t([{ amount: -2, status: 'applied' }, { amount: 50, status: 'void' }]),
      },
      'o',
      'p'
    )
    expect(totals.get('u')).toBe(500)
  })
})
