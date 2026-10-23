/**
 * Side-by-side of what the CRM says each person earns for a pay week and what was actually paid outside the CRM.
 * Pure and cent-exact: every figure is turned into integer cents first, so a $0.01 difference is never hidden by float noise.
 */
export type CrmWeek = { weekEnding: string; people: Array<{ userId: string; name: string; total: number }> }
export type PaidRow = { person: string; weekEnding: string; paid: number }

export type DiffLine = {
  weekEnding: string
  person: string
  crmCents: number | null
  paidCents: number | null
  diffCents: number // crm − paid (a person on only one side counts the missing side as 0)
  kind: 'match' | 'differs' | 'only_in_crm' | 'only_paid'
}

export const toCents = (dollars: number): number => Math.round((dollars + Number.EPSILON) * 100)
export const fmtCents = (c: number): string => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** CSV with a header row: person, week_ending (YYYY-MM-DD), paid (dollars). Quoted fields and $ , are tolerated. */
export function parsePaidCsv(text: string): PaidRow[] {
  const rows: string[][] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cells: string[] = []
    let cur = ''
    let q = false
    for (const ch of line) {
      if (ch === '"') q = !q
      else if (ch === ',' && !q) { cells.push(cur.trim()); cur = '' }
      else cur += ch
    }
    cells.push(cur.trim())
    rows.push(cells)
  }
  const header = rows.shift()?.map((h) => norm(h)) ?? []
  const iP = header.findIndex((h) => h === 'person' || h === 'name')
  const iW = header.findIndex((h) => h.startsWith('week'))
  const iA = header.findIndex((h) => h === 'paid' || h === 'amount')
  if (iP < 0 || iW < 0 || iA < 0) throw new Error('CSV needs columns: person, week_ending, paid')
  return rows.map((r, n) => {
    const paid = Number(String(r[iA] ?? '').replace(/[$,\s]/g, ''))
    if (!Number.isFinite(paid)) throw new Error(`Row ${n + 2}: "${r[iA]}" is not an amount`)
    return { person: r[iP], weekEnding: r[iW], paid }
  })
}

/** Every person-week on either side, with the difference to the cent. Sorted: biggest absolute difference first. */
export function reconcile(crm: CrmWeek[], paid: PaidRow[]): DiffLine[] {
  const out: DiffLine[] = []
  for (const w of crm) {
    const paidThisWeek = paid.filter((p) => p.weekEnding === w.weekEnding)
    const used = new Set<number>()
    for (const p of w.people) {
      const idx = paidThisWeek.findIndex((x, i) => !used.has(i) && norm(x.person) === norm(p.name))
      const crmCents = toCents(p.total)
      if (idx >= 0) {
        used.add(idx)
        // The same person listed twice for one week (two checks) is summed, not double-matched.
        const all = paidThisWeek.filter((x) => norm(x.person) === norm(p.name))
        all.forEach((x) => used.add(paidThisWeek.indexOf(x)))
        const paidCents = all.reduce((s, x) => s + toCents(x.paid), 0)
        out.push({ weekEnding: w.weekEnding, person: p.name, crmCents, paidCents, diffCents: crmCents - paidCents, kind: crmCents === paidCents ? 'match' : 'differs' })
      } else {
        out.push({ weekEnding: w.weekEnding, person: p.name, crmCents, paidCents: null, diffCents: crmCents, kind: 'only_in_crm' })
      }
    }
    paidThisWeek.forEach((x, i) => {
      if (!used.has(i)) out.push({ weekEnding: w.weekEnding, person: x.person, crmCents: null, paidCents: toCents(x.paid), diffCents: -toCents(x.paid), kind: 'only_paid' })
    })
  }
  return out.sort((a, b) => Math.abs(b.diffCents) - Math.abs(a.diffCents) || a.person.localeCompare(b.person))
}

export function toMarkdown(lines: DiffLine[]): string {
  const total = lines.reduce((s, l) => s + l.diffCents, 0)
  const diffs = lines.filter((l) => l.kind !== 'match')
  const row = (l: DiffLine) => `| ${l.weekEnding} | ${l.person} | ${l.crmCents == null ? '—' : fmtCents(l.crmCents)} | ${l.paidCents == null ? '—' : fmtCents(l.paidCents)} | ${l.kind === 'match' ? '0.00' : fmtCents(l.diffCents)} | ${l.kind.replace(/_/g, ' ')} |`
  return [
    `# CRM vs paid outside — ${lines.length} person-weeks, ${diffs.length} differ, net difference ${fmtCents(total)}`,
    '',
    '| Week ending | Person | CRM | Paid | CRM − paid | Result |',
    '|---|---|---|---|---|---|',
    ...lines.map(row),
  ].join('\n')
}
