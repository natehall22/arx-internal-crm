#!/usr/bin/env node
// Hardcode ratchet: blocks NEW company-specific literals (company name, time zone, address/phone) so the backlog can only shrink.
// It changes no runtime code. Existing literals are grandfathered per file in scripts/hardcode-baseline.json; a file may never
// gain more than its baseline. Removing literals is always allowed, and `--update` then lowers the baseline (it refuses to raise it).
//
//   node scripts/hardcode-ratchet.mjs            check (gate)
//   node scripts/hardcode-ratchet.mjs --update   shrink the baseline after you removed literals
//
// Where the value should come from instead: see CLAUDE.md -> "No new hardcoded company identity, time zone or address".
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const BASELINE = 'scripts/hardcode-baseline.json'

// Each group counts matches per file. Patterns are deliberately literal and narrow: false positives only cost a baseline entry,
// false negatives let the backlog grow.
const GROUPS = {
  brand: [/\bARX\b/g, /arxroofing\.com/gi],
  timezone: [
    /America\/[A-Z][A-Za-z_]+/g, // any IANA zone literal, not only New_York
    /\bE[SD]T\b/g, // 'EST' / 'EDT' abbreviations
    /[-+]0[45]:00\b/g, // hand-written Eastern UTC offsets (the classic double-shift bug)
  ],
  address: [/Kannapolis/gi, /Dale Earnhardt/gi, /\(?704\)?[-. ]?313[-. ]8834/g, /\(?360\)?[-. ]?485[-. ]9413/g],
}

// Product source only. Tests may pin a zone on purpose; docs, data, one-off scripts and this ratchet are not shipped code.
const INCLUDE = /^(app|lib|components|hooks|types|middleware\.ts|supabase\/(migrations|functions))(\/|$)/
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|sql)$/
const EXCLUDE = /(^|\/)(__tests__|__mocks__|e2e)\/|\.(test|spec)\.[a-z]+$/

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return out.split('\0').filter((f) => f && INCLUDE.test(f) && EXT.test(f) && !EXCLUDE.test(f))
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
const growth = []
for (const [file, groups] of Object.entries(counts)) {
  for (const [group, n] of Object.entries(groups)) {
    const allowed = baseline[file]?.[group] ?? 0
    if (n > allowed) growth.push({ file, group, n, allowed })
  }
}

const total = (c) => Object.values(c).reduce((s, g) => s + Object.values(g).reduce((a, b) => a + b, 0), 0)

if (process.argv.includes('--init')) {
  // One-time creation of the baseline. Refuses if one already exists, so it cannot be used to raise it.
  if (existsSync(BASELINE)) {
    console.error(`hardcode-ratchet: ${BASELINE} already exists; use --update (shrink only).`)
    process.exit(1)
  }
  writeFileSync(BASELINE, JSON.stringify(sortKeys(counts), null, 2) + '\n')
  console.log(`hardcode-ratchet: baseline created with ${total(counts)} literals in ${Object.keys(counts).length} files.`)
  process.exit(0)
}

if (growth.length) {
  console.error('hardcode-ratchet: NEW hardcoded company-specific literals. Read the value from settings instead (CLAUDE.md rule).')
  for (const g of growth) {
    console.error(`\n  ${g.file}  [${g.group}]  ${g.n} found, ${g.allowed} allowed`)
    for (const h of hits[g.file][g.group]) console.error(`    ${h}`)
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
