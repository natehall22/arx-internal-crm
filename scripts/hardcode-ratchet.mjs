#!/usr/bin/env node
// Hardcode ratchet: blocks NEW company-specific literals (company name, time zone, address/phone, app host) so the backlog can only shrink.
// It changes no runtime code. Existing literals are grandfathered in scripts/hardcode-baseline.json (per file, for the report).
// The rule is per GROUP across the repo: a group's total may never exceed its baseline total, so moving code between files or
// renaming a file is fine, adding a literal is not. The baseline itself may never be higher than the one on origin/main.
// Removing literals is always allowed, and `--update` then lowers the baseline (it refuses while anything grew).
//
//   node scripts/hardcode-ratchet.mjs            check (gate)
//   node scripts/hardcode-ratchet.mjs --update   shrink the baseline after you removed literals
//
// Where the value should come from instead: see CLAUDE.md -> "No new hardcoded company identity, time zone or address".
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

// Always work from the repo root: git ls-files prints paths relative to the cwd, which would make INCLUDE match nothing.
process.chdir(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim())

const BASELINE = 'scripts/hardcode-baseline.json'

// Each group counts matches per file. Patterns are deliberately literal and narrow: false positives only cost a baseline entry,
// false negatives let the backlog grow.
const GROUPS = {
  brand: [/(?<![A-Za-z0-9])ARX(?![a-z0-9])/g, /arxroofing\.com/gi], // also catches ARX_DEFAULT_… identifiers
  timezone: [
    /America\/[A-Z][A-Za-z_]+/g, // any IANA zone literal, not only New_York
    /US\/Eastern/g,
    /Eastern Time/gi,
    /\bE[SD]T\b/g, // 'EST' / 'EDT' abbreviations
    /[-+]0[45]:00\b/g, // hand-written Eastern UTC offsets (the classic double-shift bug)
  ],
  // App host literals (2026-11-10, domain cutover): every link comes from getAppUrl (lib/app-url.ts), never a typed host.
  host: [/vercel\.app/gi, /arxcapitol\.com/gi],
  address: [/Kannapolis/gi, /Dale Earnhardt/gi, /Woodbury Ter/gi, /\b(28027|28083)\b/g, /\(?704\)?[-. ]?313[-. ]8834/g, /\(?360\)?[-. ]?485[-. ]9413/g],
}

// Product source only. Tests may pin a zone on purpose; docs, data, one-off scripts and this ratchet are not shipped code.
// supabase/migrations is NOT scanned yet: migrations are immutable history and SQL has no shared time-zone source, so a
// migration that replaces an existing RPC must copy its literal. It joins the scan once the SQL org-timezone helper exists
// (docs/multi-company-plan.md, time-zone step B).
const INCLUDE = /^(app|lib|components|hooks|types|middleware\.ts|supabase\/functions)(\/|$)/
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|sql)$/
const EXCLUDE = /(^|\/)(__tests__|__mocks__|e2e|test-helpers)\/|\.(test|spec)\.[a-z]+$|(^|\/)test-accounts\.[a-z]+$/

function trackedFiles() {
  // Tracked files plus new untracked ones (so a standalone check sees work not yet committed).
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return [...new Set(out.split('\0'))].filter((f) => f && INCLUDE.test(f) && EXT.test(f) && !EXCLUDE.test(f))
}

function scan() {
  const counts = {}
  const hits = {}
  for (const file of trackedFiles()) {
    if (!existsSync(file)) continue // deleted in the working tree
    const lines = readFileSync(file, 'utf8').split('\n')
    for (const [group, patterns] of Object.entries(GROUPS)) {
      let n = 0
      const where = []
      lines.forEach((line, i) => {
        let m = 0
        for (const re of patterns) m += (line.match(re) || []).length
        if (m) {
          n += m
          where.push(`${file}:${i + 1}: ${line.trim().slice(0, 140)}`)
        }
      })
      if (n) {
        ;(counts[file] ||= {})[group] = n
        ;(hits[file] ||= {})[group] = where
      }
    }
  }
  return { counts, hits }
}

function sortKeys(obj) {
  return Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((k) => [k, typeof obj[k] === 'object' ? sortKeys(obj[k]) : obj[k]]),
  )
}

const { counts, hits } = scan()
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}

const groupTotals = (c) => {
  const t = Object.fromEntries(Object.keys(GROUPS).map((g) => [g, 0]))
  for (const groups of Object.values(c)) for (const [g, n] of Object.entries(groups)) t[g] = (t[g] || 0) + n
  return t
}
const now = groupTotals(counts)
const allowed = groupTotals(baseline)

// The committed baseline may not be higher than main's (stops a reset or a hand edit from raising the allowance).
let mainTotals = null
try {
  const mainBaseline = execFileSync('git', ['show', `origin/main:${BASELINE}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  mainTotals = groupTotals(JSON.parse(mainBaseline))
} catch {
  // origin/main has no baseline yet (first rollout) or is not fetched: nothing to compare against.
}
const raised = mainTotals ? Object.keys(GROUPS).filter((g) => allowed[g] > mainTotals[g]) : []

// Report which files grew, so the author can find the new literal (files that only received moved code show up here too).
const grewFiles = []
for (const [file, groups] of Object.entries(counts)) {
  for (const [group, n] of Object.entries(groups)) {
    const was = baseline[file]?.[group] ?? 0
    if (n > was) grewFiles.push({ file, group, n, was })
  }
}
const growth = Object.keys(GROUPS).filter((g) => now[g] > allowed[g])

const total = (c) => Object.values(c).reduce((s, g) => s + Object.values(g).reduce((a, b) => a + b, 0), 0)

if (process.argv.includes('--init')) {
  // One-time creation of the baseline. Refuses if one already exists, so it cannot be used to raise it.
  if (existsSync(BASELINE) || mainTotals) {
    console.error(`hardcode-ratchet: a baseline already exists (here or on origin/main); use --update (shrink only).`)
    process.exit(1)
  }
  writeFileSync(BASELINE, JSON.stringify(sortKeys(counts), null, 2) + '\n')
  console.log(`hardcode-ratchet: baseline created with ${total(counts)} literals in ${Object.keys(counts).length} files.`)
  process.exit(0)
}

if (raised.length) {
  console.error(`hardcode-ratchet: ${BASELINE} allows more than origin/main does for: ${raised.join(', ')}.`)
  for (const g of raised) console.error(`  ${g}: ${allowed[g]} here vs ${mainTotals[g]} on main`)
  console.error('The baseline can only go down. Restore it from main and run --update after removing literals.')
  process.exit(1)
}

if (growth.length) {
  console.error('hardcode-ratchet: NEW hardcoded company-specific literals. Read the value from settings instead (CLAUDE.md rule).')
  for (const g of growth) console.error(`\n  [${g}] ${now[g]} found, ${allowed[g]} allowed`)
  console.error('\nFiles that now hold more than before (one of them has the new literal):')
  for (const f of grewFiles.filter((x) => growth.includes(x.group))) {
    console.error(`\n  ${f.file}  [${f.group}]  ${f.n} now, ${f.was} before`)
    for (const h of hits[f.file][f.group]) console.error(`    ${h}`)
  }
  console.error('\nThe baseline cannot be raised. Remove the literal, or use the one shared source named in CLAUDE.md.')
  process.exit(1)
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(sortKeys(counts), null, 2) + '\n')
  console.log(`hardcode-ratchet: baseline lowered from ${total(baseline)} to ${total(counts)} literals.`)
  process.exit(0)
}

const shrunk = total(baseline) - total(counts)
console.log(
  `hardcode-ratchet: pass (${total(counts)} grandfathered literals${shrunk > 0 ? `; ${shrunk} removed - run with --update to lock that in` : ''}).`,
)
