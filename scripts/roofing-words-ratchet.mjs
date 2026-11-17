#!/usr/bin/env node
// Roofing-words guard: roofing / ARX wording in USER-FACING text (string literals, template text, JSX text) must not spread.
// A non-roofing company (lawn_landscape, exterior_cleaning, home_builder) must never read it, so every occurrence is either
//   (a) in a file listed in scripts/roofing-words-allow.json with a one-line reason (a roofing-only module, a gated screen,
//       staff-only tooling, a roofing-profile definition), or
//   (b) counted in scripts/roofing-words-baseline.json (the backlog: it may only SHRINK, like the hardcode ratchet).
// An allow-list key ending in / (directory) or - (file-name prefix) covers every file under it.
// A new occurrence in a file that is in neither list, or a higher count than the baseline, fails. Moving text onto a profile term
// (t(profile, ...)), a feature switch or a profile definition removes it from the count.
//
//   node scripts/roofing-words-ratchet.mjs            check (gate)
//   node scripts/roofing-words-ratchet.mjs --update   shrink the baseline after you removed occurrences (refuses to grow)
//   node scripts/roofing-words-ratchet.mjs --list     print every occurrence (file:line: text)
//   node scripts/roofing-words-ratchet.mjs --json     machine-readable counts
//
// Escape hatch on one line: put `roofing-ok: <reason>` in a comment on the same or the previous line (gated / roofing-only).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'

process.chdir(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim())
const ts = createRequire(import.meta.url)('typescript')

const BASELINE = 'scripts/roofing-words-baseline.json'
const ALLOW = 'scripts/roofing-words-allow.json'

export const TERMS = new RegExp(
  [
    '(?<![A-Za-z0-9])ARX(?![a-z0-9])',
    'arxroofing',
    '\\broof(?:s|ing|er|ers)?\\b',
    'shingles?',
    'tear[- ]?off',
    'insurance',
    'insurer',
    'adjusters?',
    '\\bclaims?\\b',
    'setters?\\b',
    'closers?\\b',
    'canvass\\w*',
    'door[- ]?knock\\w*',
    '\\bdoors? (?:knocked|per|count)',
    'storm\\w*',
    '\\bhail\\b',
    'gutters?',
    '\\bsiding\\b',
    '\\bIKO\\b',
    'homeowners?',
    'Kannapolis',
    'Concord',
    'Charlotte',
    'dump run',
    'squares?\\b',
  ].join('|'),
  'gi'
)

// Product source only. Tests, mocks, fixtures and the dev harness are not shipped text.
const INCLUDE = /^(app|components|lib)\//
const EXT = /\.(ts|tsx)$/
const EXCLUDE = /(^|\/)(__tests__|__mocks__|e2e|test-helpers|dev-harness)\/|\.(test|spec)\.[a-z]+$|\.d\.ts$/

function files() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return [...new Set(out.split('\0'))].filter((f) => f && INCLUDE.test(f) && EXT.test(f) && !EXCLUDE.test(f) && existsSync(f))
}

// Text a person can read: has whitespace, or is a Capitalised word. Snake/kebab/camel identifiers, URLs, SQL column lists are not.
function humanText(s) {
  const t = s.trim()
  if (!t || !/[A-Za-z]/.test(t)) return false
  if (/^(?:https?:|\/|\.|#|@)/.test(t)) return false
  if (/^[a-z0-9_.:\-\/\[\]]+$/.test(t)) return false // identifier-ish, e.g. roofing_types, /api/roof
  if (/^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(t)) return false // camelCase
  if (/\b[a-z]+_[a-z_]+\b/.test(t) && !/^[A-Z]/.test(t)) return false
  if (/^\[[\w/:.-]+\]/.test(t)) return false // [cron/xyz] log tags // SQL column list / filter, e.g. "id, homeowner_name, phone"
  return /\s/.test(t) || /^[A-Z][A-Za-z]+$/.test(t)
}

function scanFile(file) {
  const src = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lines = src.split('\n')
  const hits = []
  const okLine = (line) => /roofing-ok:/.test(lines[line] || '') || /roofing-ok:/.test(lines[line - 1] || '')
  const push = (node, text) => {
    if (!humanText(text)) return
    const m = text.match(TERMS)
    if (!m) return
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line
    if (okLine(line)) return
    hits.push({ line: line + 1, text: text.trim().replace(/\s+/g, ' ').slice(0, 110), n: m.length })
  }
  const visit = (node) => {
    const k = node.kind
    if (k === ts.SyntaxKind.ImportDeclaration || k === ts.SyntaxKind.ExportDeclaration || k === ts.SyntaxKind.LiteralType || k === ts.SyntaxKind.TypeReference) {
      if (k !== ts.SyntaxKind.TypeReference) return
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const p = node.parent
      const isKey = p && (ts.isPropertyAssignment(p) && p.name === node)
      const isCase = p && ts.isCaseClause(p)
      const isCmp = p && ts.isBinaryExpression(p) && /^[!=]==?$/.test(p.operatorToken.getText(sf))
      const isIdxAttr = p && ts.isJsxAttribute(p) && /^(className|href|src|key|id|type|name|htmlFor|data-.*|role|rel|target|style|value)$/.test(p.name.getText(sf))
      const isCall = p && ts.isCallExpression(p) && /^(\w+\.)*(from|rpc|select|eq|neq|in|is|order|get|has|includes|startsWith|endsWith|test|match|split|require|import|log|warn|error|info|debug|setHeader|cookies|headers)$/.test(p.expression.getText(sf).replace(/\)$/, '')) && !/(console)/.test(p.expression.getText(sf))
      // rw('roofing text', 'neutral') (useRoofingWord) and roofingOr(profile, 'roofing text', 'neutral'): the first text is the roofing profile's own.
      const isGated =
        p && ts.isCallExpression(p) &&
        ((p.expression.getText(sf) === 'rw' && p.arguments[0] === node) || (p.expression.getText(sf) === 'roofingOr' && p.arguments[1] === node))
      const isLog = p && ts.isCallExpression(p) && /^console\./.test(p.expression.getText(sf))
      if (!isGated && !isLog && !isKey && !isCase && !isCmp && !isIdxAttr && !isCall) push(node, node.text)
    } else if (ts.isTemplateExpression(node)) {
      if (node.parent && ts.isCallExpression(node.parent) && /^console\./.test(node.parent.expression.getText(sf))) return
      push(node, node.head.text + ' ' + node.templateSpans.map((s) => s.literal.text).join(' '))
    } else if (ts.isJsxText(node)) {
      push(node, node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

export function scanAll() {
  const out = {}
  for (const f of files()) {
    const h = scanFile(f)
    if (h.length) out[f] = h
  }
  return out
}

function readJson(p, dflt) {
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : dflt
}

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))

function main() {
  const args = process.argv.slice(2)
  const all = scanAll()
  if (args.includes('--list')) {
    for (const [f, h] of Object.entries(all)) for (const x of h) console.log(`${f}:${x.line}: ${x.text}`)
    return 0
  }
  const allow = readJson(ALLOW, {})
  const base = readJson(BASELINE, { files: {} }).files
  const isAllowed = (f) => Object.keys(allow).some((a) => (a.endsWith('/') || a.endsWith('-') ? f.startsWith(a) : f === a))
  const counts = Object.fromEntries(Object.entries(all).filter(([f]) => !isAllowed(f)).map(([f, h]) => [f, h.length]))
  if (args.includes('--json')) {
    console.log(JSON.stringify({ counts, allowed: Object.keys(allow).length, total: Object.values(counts).reduce((a, b) => a + b, 0) }))
    return 0
  }
  const problems = []
  for (const [f, reason] of Object.entries(allow)) {
    if (typeof reason !== 'string' || reason.trim().length < 8) problems.push(`${ALLOW}: ${f} needs a one-line reason`)
    if (!existsSync(f) && !((f.endsWith('/') || f.endsWith('-')) && files().some((x) => x.startsWith(f)))) problems.push(`${ALLOW}: ${f} no longer exists - remove the entry`)
  }
  const grew = []
  for (const [f, n] of Object.entries(counts)) {
    const b = base[f] ?? 0
    if (n > b) grew.push({ f, n, b })
  }
  if (args.includes('--update')) {
    const firstRun = !existsSync(BASELINE) // bootstrap: the first baseline records today's backlog; every later update may only shrink
    if (!firstRun && (grew.length || problems.length)) {
      console.error('roofing-words: refusing to update while anything grew or the allow-list is invalid.')
    } else if (!problems.length) {
      writeFileSync(BASELINE, JSON.stringify({ note: 'Roofing/ARX words in user-facing text, per file. May only shrink: see scripts/roofing-words-ratchet.mjs', files: sorted(counts) }, null, 2) + '\n')
      console.log(`roofing-words: baseline updated (${Object.values(counts).reduce((a, b) => a + b, 0)} occurrences in ${Object.keys(counts).length} files)`)
      return 0
    }
  }
  for (const g of grew) {
    problems.push(
      `${g.f}: ${g.n} roofing/ARX word occurrence(s) in user-facing text (baseline ${g.b}).\n` +
        all[g.f].map((x) => `    ${g.f}:${x.line}: ${x.text}`).join('\n') +
        `\n    Fix: use a profile term t(profile, ...) / the company brand, gate it by its feature switch (canvassing, insurance, roofMeasure, squaresPricing, stormAlerts, incentives) or the roofing profile, or add "roofing-ok: <reason>" on that line.`
    )
  }
  if (problems.length) {
    console.error('roofing-words guard FAILED:\n' + problems.join('\n'))
    return 1
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const baseTotal = Object.values(base).reduce((a, b) => a + b, 0)
  console.log(`roofing-words guard ok: ${total} backlog occurrence(s) (baseline ${baseTotal}), ${Object.keys(allow).length} allow-listed file(s)`)
  if (total < baseTotal) console.log('  the backlog shrank: run `node scripts/roofing-words-ratchet.mjs --update` to lock it in')
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main())
