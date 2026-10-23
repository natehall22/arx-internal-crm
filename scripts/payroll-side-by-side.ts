/**
 * Read-only: the CRM's per-person pay for the last N pay weeks next to what was actually paid outside the CRM,
 * every difference listed to the cent.
 *
 *   set -a; . ./.env.local; set +a
 *   npx tsx scripts/payroll-side-by-side.ts --weeks 2 --template out.csv     # CRM side, with a blank "paid" column to fill in
 *   npx tsx scripts/payroll-side-by-side.ts --weeks 2 --paid paid.csv --out report.md
 *
 * paid.csv: person, week_ending (YYYY-MM-DD), paid (dollars). Needs the payroll migrations applied (it uses the same
 * loader as Pay this week) and never writes: it only looks at pay weeks that already exist.
 */
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

import { findCurrentPayWeekPeriod, loadPayWeek } from '@/lib/payroll-pay-week'
import { parsePaidCsv, reconcile, toMarkdown, type CrmWeek } from '@/lib/payroll-reconcile'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const weeks = Math.max(1, Number(arg('weeks') ?? 2))
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: org } = await admin.from('orgs').select('id').limit(1).single()
  const orgId = org!.id as string

  const current = await findCurrentPayWeekPeriod(admin, orgId, new Date())
  if (!current) throw new Error('There is no current pay week yet — open Pay this week once, then run this.')
  const first = await loadPayWeek(admin, orgId, new Date(), current.id)
  const picks = [first, ...(await Promise.all(first.earlier.slice(0, weeks - 1).map((e) => loadPayWeek(admin, orgId, new Date(), e.id))))]
  const crm: CrmWeek[] = picks.map((w) => ({ weekEnding: w.period.weekEnding, people: w.people.map((p) => ({ userId: p.userId, name: p.name, total: p.total })) }))

  const template = arg('template')
  if (template) {
    const lines = ['person,week_ending,paid', ...crm.flatMap((w) => w.people.map((p) => `"${p.name}",${w.weekEnding},`))]
    fs.writeFileSync(template, lines.join('\n') + '\n')
    console.log(`Wrote ${template} (${crm.reduce((n, w) => n + w.people.length, 0)} person-weeks). Fill in "paid" and rerun with --paid.`)
  }
  const paidPath = arg('paid')
  if (paidPath) {
    const report = toMarkdown(reconcile(crm, parsePaidCsv(fs.readFileSync(paidPath, 'utf8'))))
    const out = arg('out')
    if (out) fs.writeFileSync(out, report + '\n')
    console.log(report)
  }
  if (!template && !paidPath) for (const w of crm) console.log(`${w.weekEnding}\n${w.people.map((p) => `  ${p.name.padEnd(28)} ${p.total.toFixed(2)}`).join('\n')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
