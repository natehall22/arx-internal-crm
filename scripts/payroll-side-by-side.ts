/**
 * Read-only: the CRM's per-person pay next to what was actually paid outside the CRM, every difference listed to the cent.
 *
 *   set -a; . ./.env.local; set +a
 *   # Chosen past weeks, BEFORE cutover (dry run on the company's pay week; nothing is created or written):
 *   npx tsx scripts/payroll-side-by-side.ts --org <org id> --week-ending 2026-11-02,2026-11-09 --template out.csv
 *   npx tsx scripts/payroll-side-by-side.ts --org <org id> --week-ending 2026-11-02,2026-11-09 --paid paid.csv --out report.md
 *   # The last N weeks that already exist (after cutover, from Pay this week itself):
 *   npx tsx scripts/payroll-side-by-side.ts --org <org id> --weeks 2 --paid paid.csv
 *
 * paid.csv: person, week_ending (YYYY-MM-DD), paid (dollars). --org defaults to DEPLOYMENT_ORG_ID; with neither it refuses
 * (never guesses a company). The dry run covers commission + weekly minimum only (see lib/payroll-simulate-week.ts).
 */
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

import { findCurrentPayWeekPeriod, loadPayWeek } from '@/lib/payroll-pay-week'
import { simulatePayWeek } from '@/lib/payroll-simulate-week'
import { parsePaidCsv, reconcile, toMarkdown, type CrmWeek } from '@/lib/payroll-reconcile'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
  const orgId = arg('org') || process.env.DEPLOYMENT_ORG_ID
  if (!orgId) throw new Error('Pass --org <company id> (or set DEPLOYMENT_ORG_ID). The tool never guesses the company.')
  const { data: org } = await admin.from('orgs').select('id, name').eq('id', orgId).maybeSingle()
  if (!org) throw new Error(`No company ${orgId}`)

  let crm: CrmWeek[]
  const chosen = arg('week-ending')
  if (chosen) {
    const sims = []
    for (const w of chosen.split(',').map((x) => x.trim()).filter(Boolean)) sims.push(await simulatePayWeek(admin, orgId, w))
    crm = sims
    for (const w of sims) {
      const extra = w.people.filter((p) => p.minimumIfMet > 0)
      if (extra.length) console.log(`${w.weekEnding}: weekly minimum only if the week's requirements were met — ${extra.map((p) => `${p.name} +${p.minimumIfMet.toFixed(2)}`).join(', ')}`)
    }
    console.log('Dry run: commission + weekly minimum only (no hourly, per-unit, bonuses or fixes).')
  } else {
    const weeks = Math.max(1, Number(arg('weeks') ?? 2))
    const current = await findCurrentPayWeekPeriod(admin, orgId, new Date())
    if (!current) throw new Error('There is no current pay week yet. Use --week-ending for a dry run of chosen weeks.')
    const first = await loadPayWeek(admin, orgId, new Date(), current.id)
    const picks = [first, ...(await Promise.all(first.earlier.slice(0, weeks - 1).map((e) => loadPayWeek(admin, orgId, new Date(), e.id))))]
    crm = picks.map((w) => ({ weekEnding: w.period.weekEnding, people: w.people.map((p) => ({ userId: p.userId, name: p.name, total: p.total })) }))
  }

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
