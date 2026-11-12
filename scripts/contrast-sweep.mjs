#!/usr/bin/env node
// Contrast sweep: finds (and fixes) light-gray TEXT on light surfaces so secondary text stays readable in direct sun.
// Re-runnable and idempotent: run it again after merging other branches and it only touches what those branches added.
//
//   node scripts/contrast-sweep.mjs            apply the fixes in place
//   node scripts/contrast-sweep.mjs --check    change nothing; exit 1 if anything fixable is left (this is the guard)
//   node scripts/contrast-sweep.mjs --report   counts (raw + classified) and the skipped files; change nothing
//   add --verbose to list every occurrence with its decision
//
// What it rewrites (Tailwind classes inside string/template literals in app/, components/, hooks/):
//   text-{gray|slate|zinc|neutral|stone}-300 / -400  ->  -600        (white: 2.5:1 / 2.5:1  ->  7.6:1)
//   text-{...}-500                                    ->  -700        (4.8:1 -> 10.3:1)
//   placeholder-{...}-N and placeholder:text-{...}-N  ->  at least -500
//   text-[#9ca3af] style arbitrary light hex, and `color: '#9ca3af'` in style objects (same two steps)
// Variants (md:, hover:, ...) and /opacity suffixes are handled; an opacity suffix is dropped (it would lower contrast again).
//
// What it never touches (each is counted and, for files, listed):
//   dark surfaces  - the element or a lexical ancestor has a dark bg (gray-500+ / any color 500+ / black / dark hex / dark gradient
//                    stop / bg-ink), or light text (text-white, text-gray-50..200) with no light bg; whole files that are mostly dark
//   uncertain      - a match with no background anywhere above it in a file that does contain dark surfaces (render helpers, shared
//                    pieces used inside a dark parent from another file). Left alone; listed for a human.
//   disabled       - disabled: / aria-disabled / cursor-not-allowed / a `disabled ? ... : ...` branch
//   icons          - <svg>, lucide/heroicons components (color of an icon, not text)
//   excluded paths - PDF generators, the canvass app + canvass map overlays, the Nav shell
//   anything on a line (or the line below) marked `contrast-ok` - use it, with a reason, for text that sits on a photo/map.
// Known limit: a component whose dark parent lives in ANOTHER file cannot be seen; the dark-file list below is the safety net.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')

process.chdir(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim())

const args = new Set(process.argv.slice(2))
const CHECK = args.has('--check')
const REPORT = args.has('--report')
const VERBOSE = args.has('--verbose')
const FIX_UNCERTAIN = args.has('--fix-uncertain') // one-off: treat 'no surface found' matches as light (after a human reviewed them)

const ROOTS = /^(app|components|hooks)\//
const EXT = /\.(tsx|ts|jsx|js)$/
const EXCLUDED_PATH = [
  [/pdf/i, 'PDF generator (golden hashes, handled separately)'],
  [/^app\/\(canvass-app\)\/canvass\/components\/CanvassMap\.tsx$/, 'canvass map (text on satellite imagery, handled separately)'],
  [/^components\/Nav\.tsx$/, 'Nav shell (dark sidebar / header / bottom bar)'],
  [/(^|\/)__tests__\/|\.(test|spec)\.[a-z]+$/, 'test'],
]

const PALETTE = 'gray|slate|zinc|neutral|stone'
const COLORS = 'gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const TEXT_MAP = { 300: 600, 400: 600, 500: 700 }
const HEX_TO_600 = new Set(['#9ca3af', '#d1d5db', '#a1a1aa', '#94a3b8', '#d4d4d8', '#cbd5e1', '#a3a3a3', '#a8a29e', '#d4d4d4', '#d6d3d1'])
const HEX_TO_700 = new Set(['#6b7280', '#71717a', '#64748b', '#737373', '#78716c'])
const HEX_600 = '#4b5563'
const HEX_700 = '#374151'

// ---------- class-token helpers ----------
const RESPONSIVE = /^(sm|md|lg|xl|2xl|max-[a-z0-9\[\]]+|min-[a-z0-9\[\]]+)$/
// Splits `md:hover:!text-gray-400/70` on top-level colons (not inside [..]).
function splitToken(tok) {
  const parts = []
  let depth = 0, cur = ''
  for (const ch of tok) {
    if (ch === '[') depth++
    if (ch === ']') depth--
    if (ch === ':' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
  }
  parts.push(cur)
  const base = parts.pop()
  return { variants: parts, base }
}
const onlyResponsive = (variants) => variants.every((v) => RESPONSIVE.test(v))

function hexLum(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

// 'dark' | 'light' | null for a background-ish base class (bg-*, from-*, via-*, to-*).
function bgKind(base) {
  const m = /^(bg|from|via|to)-(.+)$/.exec(base.replace(/^!/, ''))
  if (!m) return null
  const [, kind, restRaw] = m
  const alphaM = /^(.*?)\/(\d+|\[[^\]]+\])$/.exec(restRaw)
  const rest = alphaM ? alphaM[1] : restRaw
  const hasAlpha = !!alphaM
  let r = null
  if (rest === 'black' || rest === 'ink' || rest === 'foreground' || rest === 'danger') r = 'dark'
  else if (rest === 'white' || rest === 'transparent' || rest === 'background' || rest === 'current' || /^surface(-|$)/.test(rest)) r = 'light'
  else if (/^brand-(50|100|200)$/.test(rest)) r = 'light'
  else if (/^brand/.test(rest)) r = 'dark'
  else if (new RegExp(`^(${COLORS})-(\\d{2,3})$`).test(rest)) r = Number(rest.split('-').pop()) >= 500 ? 'dark' : 'light'
  else if (/^\[#[0-9a-fA-F]{3,8}\]$/.test(rest)) { const l = hexLum(rest.slice(1, -1)); r = l == null ? 'dark' : l < 0.35 ? 'dark' : 'light' }
  else if (kind === 'bg' && /^\[(url|image|linear|radial|conic|var|rgb|hsl|color)/.test(rest)) r = 'dark' // unknown surface: be conservative
  else return null // bg-cover, bg-center, bg-gradient-to-r, bg-clip-*, ... not a colour
  if (r === 'light' && hasAlpha) return null // translucent light surface: look further up
  return r
}
const LIGHT_TEXT = new RegExp(`^!?text-(white|(${PALETTE})-(50|100|200))(/\\d+)?$`)

// ---------- AST ----------
const isStringish = (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)

function fragTokens(node, sf) {
  const start = node.getStart(sf)
  const text = sf.text.slice(start, node.end)
  const out = []
  const re = /\S+/g
  let m
  while ((m = re.exec(text))) {
    const tokEnd = m.index + m[0].length
    // A token glued to a `${...}` boundary is only half a class name: skip it.
    if ((ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) && tokEnd >= text.length - 2) continue
    if ((ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && m.index <= 1) continue
    out.push({ tok: m[0].replace(/^[`'"}]+|[`'"{$]+$/g, ''), idx: start + m.index + (m[0].length - m[0].replace(/^[`'"}]+/, '').length) })
  }
  return out
}

// Path of conditional branches a node sits in, to tell exclusive alternatives (a ? 'x' : 'y') from siblings.
function branchPath(node) {
  const path = []
  for (let n = node; n.parent; n = n.parent) {
    const p = n.parent
    if (ts.isConditionalExpression(p)) {
      if (p.whenTrue === n) path.push([p, 'T'])
      else if (p.whenFalse === n) path.push([p, 'F'])
    }
  }
  return path
}
// Two fragments are alternatives when they sit in opposite branches of the same conditional, or of two conditionals with the
// identical test text (`isSelected ? 'bg-indigo-600' : 'bg-white'` on a parent and `isSelected ? 'text-white' : 'text-gray-500'` on a child).
const condText = (c) => c.condition.getText()
const exclusive = (a, b) => a.some(([c, s]) => b.some(([c2, s2]) => s !== s2 && (c === c2 || condText(c) === condText(c2))))

function attrFragments(attr) {
  const frags = []
  const visit = (n) => {
    if (isStringish(n)) frags.push(n)
    ts.forEachChild(n, visit)
  }
  if (attr.initializer) visit(attr.initializer)
  return frags
}

const ICON_SOURCES = /^(lucide-react|@heroicons\/|react-icons|@radix-ui\/react-icons|@phosphor-icons|@tabler\/icons)/

function analyseFile(file, src) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const iconNames = new Set()
  sf.forEachChild((n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && ICON_SOURCES.test(n.moduleSpecifier.text)) {
      const c = n.importClause
      if (c?.name) iconNames.add(c.name.text)
      if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) c.namedBindings.elements.forEach((e) => iconNames.add(e.name.text))
    }
  })

  // ---- file-level surface census (state variants ignored) ----
  let darkCount = 0, lightCount = 0
  const census = (n) => {
    if (isStringish(n)) {
      for (const { tok } of fragTokens(n, sf)) {
        const { variants, base } = splitToken(tok)
        if (!onlyResponsive(variants)) continue
        const k = bgKind(base)
        if (k === 'dark') darkCount++
        else if (k === 'light') lightCount++
      }
    }
    ts.forEachChild(n, census)
  }
  census(sf)
  // A dark *container* (an element that wraps others, not a button/badge/input) is what can sit above a helper's text.
  let darkContainers = 0, lightContainers = 0
  const censusContainers = (n) => {
    if (ts.isJsxElement(n)) {
      const t = n.openingElement.tagName.getText(sf)
      if (!/^(button|a|span|input|label|select|option|textarea|Link|Button|Badge)$/.test(t) && n.children.some((c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c))) {
        const d = decideFragments((n.openingElement.attributes?.properties ?? []).filter((a) => ts.isJsxAttribute(a) && /class/i.test(a.name.getText(sf))).flatMap(attrFragments), null)
        if (d === 'dark' || styleBg(n.openingElement) === 'dark') darkContainers++
        else if (d === 'light') lightContainers++
      }
    }
    ts.forEachChild(n, censusContainers)
  }
  const hasDarkLater = () => darkContainers > 0

  // ---- context of a JSX element's own classes ----
  const elementOf = (node) => {
    for (let n = node; n; n = n.parent) {
      if (ts.isJsxAttribute(n)) {
        const el = n.parent?.parent
        return { attr: n, el }
      }
    }
    return null
  }
  const classAttrs = (opening) => (opening.attributes?.properties ?? []).filter((a) => ts.isJsxAttribute(a) && /class/i.test(a.name.getText(sf)))
  const tagName = (opening) => opening.tagName.getText(sf)

  function decideFragments(frags, matchBranch) {
    let dark = false, light = false
    for (const f of frags) {
      if (matchBranch && exclusive(branchPath(f), matchBranch)) continue
      for (const { tok } of fragTokens(f, sf)) {
        const { variants, base } = splitToken(tok)
        if (!onlyResponsive(variants)) continue
        const k = bgKind(base)
        if (k === 'dark') dark = true
        else if (k === 'light') light = true
        else if (LIGHT_TEXT.test(base)) dark = dark || 'text'
      }
    }
    if (dark === true) return 'dark'
    if (light) return 'light'
    if (dark === 'text') return 'dark'
    return 'none'
  }
  function styleBg(opening) {
    for (const a of opening.attributes?.properties ?? []) {
      if (ts.isJsxAttribute(a) && a.name.getText(sf) === 'style' && a.initializer) {
        const t = a.initializer.getText(sf)
        if (/background/i.test(t)) {
          const hexes = [...t.matchAll(/background(?:Color)?\s*:\s*['"`](#[0-9a-fA-F]{3,8})['"`]/g)]
          if (hexes.length && hexes.every((h) => (hexLum(h[1]) ?? 0) >= 0.35)) return 'light'
          return 'dark' // gradient, rgb(), variables, dark hex: unknown surfaces are treated as dark
        }
      }
    }
    return 'none'
  }

  // Walks from the match's element up its JSX ancestors; the nearest element with a decisive surface wins.
  function surfaceOf(matchNode) {
    const own = elementOf(matchNode)
    let el = own?.el
    if (!el) return null // not inside a JSX class attribute
    let first = true
    const mb = branchPath(matchNode)
    let climb = el
    while (climb) {
      if (ts.isJsxElement(climb)) {
        // the element's own opening tag was already judged (with branch exclusion) on the first pass
        if (climb.openingElement !== el) climb = climb.openingElement
        else { climb = climb.parent; continue }
      }
      if (ts.isJsxOpeningElement(climb) || ts.isJsxSelfClosingElement(climb)) {
        const frags = classAttrs(climb).flatMap(attrFragments)
        let d = decideFragments(frags, mb)
        const sb = styleBg(climb)
        if (sb === 'dark') d = 'dark'
        else if (sb === 'light' && d === 'none') d = 'light'
        if (d !== 'none') return d
        first = false
        if (ts.isJsxOpeningElement(climb)) climb = climb.parent // -> its JsxElement, then upward
      }
      climb = climb.parent
    }
    return 'none'
  }

  const edits = [] // {pos, len, to}
  const decisions = [] // for reporting
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line
  const lines = src.split('\n')
  const marked = (pos) => {
    const l = lineOf(pos)
    return /contrast-ok/.test(lines[l] ?? '') || /contrast-ok/.test(lines[l - 1] ?? '')
  }

  function decide(node, tokInfo) {
    const { tok, idx } = tokInfo
    const { variants, base: base0 } = splitToken(tok)
    const bang = base0.startsWith('!') ? '!' : ''
    const base = base0.replace(/^!/, '')
    let m = new RegExp(`^(text|placeholder)-(${PALETTE})-(300|400|500)(/\\d+)?$`).exec(base)
    let isPlaceholder = false, newBase = null
    if (m) {
      isPlaceholder = m[1] === 'placeholder' || variants.includes('placeholder')
      const step = Number(m[3])
      const target = isPlaceholder ? 500 : TEXT_MAP[step]
      if (isPlaceholder && step >= 500) return null // already at the floor
      newBase = `${m[1]}-${m[2]}-${target}`
    } else if ((m = /^text-\[(#[0-9a-fA-F]{3,8})\]$/.exec(base))) {
      const h = m[1].toLowerCase()
      if (HEX_TO_600.has(h)) newBase = `text-[${HEX_600}]`
      else if (HEX_TO_700.has(h)) newBase = `text-[${HEX_700}]`
    }
    if (!newBase) return null
    const rec = { pos: idx, len: tok.length, line: lineOf(idx) + 1, from: tok, to: [...variants, bang + newBase].join(':'), reason: 'fix' }
    // ---- reasons to leave it alone ----
    if (marked(idx)) return { ...rec, reason: 'marked' }
    if (variants.some((v) => /disabled/.test(v)) || variants.includes('dark')) return { ...rec, reason: 'disabled' }
    if (variants.some((v) => v.startsWith('['))) return { ...rec, reason: 'icon' } // [&>svg]:text-gray-400 targets an icon child
    // the string itself, or a conditional on `disabled`
    const fragText = sf.text.slice(node.getStart(sf), node.end)
    if (/cursor-not-allowed|pointer-events-none|aria-disabled/.test(fragText)) return { ...rec, reason: 'disabled' }
    for (let n = node; n.parent && !ts.isJsxElement(n) && !ts.isBlock(n); n = n.parent) {
      if (ts.isConditionalExpression(n.parent) && n.parent.condition.getText(sf).match(/disabled/i) && (n.parent.whenTrue === n || n.parent.whenFalse === n)) return { ...rec, reason: 'disabled' }
    }
    // same-fragment surface
    const own = elementOf(node)
    if (own?.el) {
      const t = tagName(own.el)
      if (t === 'svg' || t === 'path' || t === 'circle' || iconNames.has(t)) return { ...rec, reason: 'icon' }
      if (own.el.attributes?.properties?.some((a) => ts.isJsxAttribute(a) && /^aria-disabled$/.test(a.name.getText(sf)))) return { ...rec, reason: 'disabled' }
    }
    // dark in the same literal (e.g. 'bg-gray-900 text-gray-400' in a constant)
    const sameFrag = decideFragments([node], null)
    if (sameFrag === 'dark') return { ...rec, reason: 'dark-context' }
    const surf = surfaceOf(node)
    if (surf === 'dark') return { ...rec, reason: 'dark-context' }
    if (surf === 'light' || sameFrag === 'light') return rec
    // no surface anywhere above/beside it
    if (hasDarkLater()) return { ...rec, reason: 'uncertain' }
    return rec
  }

  censusContainers(sf)
  const darkFile = (darkContainers >= 2 && darkContainers > lightContainers) || /\blogin-dark\b/.test(src)
  const visit = (node) => {
    if (isStringish(node)) {
      const text = node.getText(sf)
      if (/(text|placeholder)-(gray|slate|zinc|neutral|stone)-[345]00|text-\[#/.test(text)) {
        for (const ti of fragTokens(node, sf)) {
          const d = decide(node, ti)
          if (d) decisions.push(d)
        }
      }
    }
    // style={{ color: '#9ca3af' }} and any `color: '#hex'` object property
    if (ts.isPropertyAssignment(node) && node.name.getText(sf) === 'color' && ts.isStringLiteral(node.initializer)) {
      const h = node.initializer.text.toLowerCase()
      const to = HEX_TO_600.has(h) ? HEX_600 : HEX_TO_700.has(h) ? HEX_700 : null
      if (to) {
        const pos = node.initializer.getStart(sf) + 1
        const rec = { pos, len: h.length, line: lineOf(pos) + 1, from: h, to, reason: 'fix' }
        // surface: nearest JSX opening element above; unknown -> uncertain when the file has dark surfaces
        let d = rec
        if (marked(pos)) d = { ...rec, reason: 'marked' }
        else {
          let el = node
          while (el && !ts.isJsxOpeningElement(el) && !ts.isJsxSelfClosingElement(el)) el = el.parent
          if (el) {
            const t = tagName(el)
            if (t === 'svg' || iconNames.has(t)) d = { ...rec, reason: 'icon' }
          }
          if (d.reason === 'fix') {
            // the same element's / ancestors' surface
            let surf = 'none'
            for (let c0 = el; c0; c0 = c0.parent) {
              const c = ts.isJsxElement(c0) ? c0.openingElement : c0
              if (ts.isJsxOpeningElement(c) || ts.isJsxSelfClosingElement(c)) {
                let k = decideFragments(classAttrs(c).flatMap(attrFragments), null)
                const sb = styleBg(c)
                if (sb === 'dark') k = 'dark'
                else if (sb === 'light' && k === 'none') k = 'light'
                if (k !== 'none') { surf = k; break }
              }
            }
            if (surf === 'dark') d = { ...rec, reason: 'dark-context' }
            else if (surf === 'none' && hasDarkLater()) d = { ...rec, reason: 'uncertain' }
          }
        }
        decisions.push(d)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { decisions, darkFile, darkCount: darkContainers, lightCount: lightContainers }
}

// ---------- run ----------
function listFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return [...new Set(out.split('\0'))].filter((f) => f && ROOTS.test(f) && EXT.test(f))
}
const CANDIDATE = /(text|placeholder)-(gray|slate|zinc|neutral|stone)-[345]00|text-\[#|color:\s*['"]#/

const tally = { fix: 0, 'dark-file': 0, 'dark-context': 0, uncertain: 0, disabled: 0, icon: 0, marked: 0, 'excluded-path': 0 }
const skippedFiles = { path: [], dark: [] }
const uncertainFiles = new Map()
const rawCounts = { 'text gray/slate/zinc/neutral/stone 300/400/500': 0, 'placeholder light grays': 0, 'light hex (#9ca3af #6b7280 #a1a1aa …)': 0, 'muted-foreground var refs': 0 }
const byClass = {}
const changed = []
const verbose = []

for (const file of listFiles()) {
  let src
  try { src = readFileSync(file, 'utf8') } catch { continue }
  if (REPORT) {
    rawCounts['text gray/slate/zinc/neutral/stone 300/400/500'] += (src.match(/(?<![\w-])text-(gray|slate|zinc|neutral|stone)-(300|400|500)\b/g) ?? []).length
    rawCounts['placeholder light grays'] += (src.match(/placeholder(-|:text-)(gray|slate|zinc|neutral|stone)-(300|400)\b/g) ?? []).length
    rawCounts['light hex (#9ca3af #6b7280 #a1a1aa …)'] += (src.match(/#(9ca3af|6b7280|a1a1aa|94a3b8|d1d5db)\b/gi) ?? []).length
    rawCounts['muted-foreground var refs'] += (src.match(/muted-foreground/g) ?? []).length
    for (const m of src.matchAll(/(?<![\w-])text-(gray|slate|zinc|neutral|stone)-(300|400|500)\b/g)) byClass[m[0]] = (byClass[m[0]] ?? 0) + 1
  }
  if (!CANDIDATE.test(src)) continue
  const excl = EXCLUDED_PATH.find(([re]) => re.test(file))
  const { decisions, darkFile, darkCount, lightCount } = analyseFile(file, src)
  if (!decisions.length) continue
  if (excl) {
    if (excl[1] !== 'test') { tally['excluded-path'] += decisions.length; skippedFiles.path.push([file, excl[1], decisions.length]) }
    continue
  }
  if (darkFile) {
    tally['dark-file'] += decisions.length
    skippedFiles.dark.push([file, `${darkCount} dark vs ${lightCount} light container surfaces`, decisions.length])
    continue
  }
  const edits = []
  for (const d of decisions) {
    tally[d.reason]++
    if (d.reason === 'uncertain') uncertainFiles.set(file, (uncertainFiles.get(file) ?? 0) + 1)
    if (VERBOSE && d.reason !== 'fix') verbose.push(`${file}:${d.line} ${d.reason} ${d.from}`)
    if (d.reason === 'uncertain' && FIX_UNCERTAIN && /^(text|placeholder)-/.test(d.from.split(':').pop())) d.reason = 'fix' // class tokens only, never hex data colors
    if (d.reason === 'fix') { edits.push(d); if (VERBOSE) verbose.push(`${file}:${d.line} fix ${d.from} -> ${d.to}`) }
  }
  if (edits.length) {
    changed.push([file, edits.length])
    if (!CHECK && !REPORT) {
      let out = src
      for (const e of edits.sort((a, b) => b.pos - a.pos)) out = out.slice(0, e.pos) + e.to + out.slice(e.pos + e.len)
      // A fixed base colour can now equal its own hover colour (text-gray-500 hover:text-gray-700 became 700/700): keep the hover visible.
      out = out.replace(/(?<![\w-])text-(gray|slate|zinc|neutral|stone)-(600|700)([^"'`\n]*?)(?<![\w-])hover:text-\1-\2(?![\w\/-])/g, 'text-$1-$2$3hover:text-$1-900')
      writeFileSync(file, out)
    }
  }
}

if (REPORT) {
  console.log('RAW counts (every occurrence, any background):')
  for (const [k, v] of Object.entries(rawCounts)) console.log(`  ${String(v).padStart(5)}  ${k}`)
  console.log('  by class:', Object.entries(byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '))
}
if (REPORT || VERBOSE || !CHECK) {
  console.log(`\nClassified occurrences: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join('  ')}`)
  if (skippedFiles.dark.length) {
    console.log('\nSkipped as dark-themed files:')
    for (const [f, why, n] of skippedFiles.dark) console.log(`  ${f}  (${why}; ${n} matches left)`)
  }
  if (skippedFiles.path.length) {
    console.log('\nSkipped by path:')
    for (const [f, why, n] of skippedFiles.path) console.log(`  ${f}  (${why}; ${n})`)
  }
  if (uncertainFiles.size) {
    console.log('\nUncertain (no surface above them in a file with dark surfaces; left for a human):')
    for (const [f, n] of uncertainFiles) console.log(`  ${f}  (${n})`)
  }
  if (verbose.length) console.log('\n' + verbose.join('\n'))
}
if (CHECK) {
  if (changed.length) {
    console.error(`contrast-sweep: ${tally.fix} light-gray text class(es) left on light surfaces in ${changed.length} file(s):`)
    for (const [f, n] of changed) console.error(`  ${f} (${n})`)
    console.error('Fix: node scripts/contrast-sweep.mjs   (use /* contrast-ok: reason */ for text on a photo or map)')
    process.exit(1)
  }
  console.log(`contrast-sweep: clean (${tally['dark-file'] + tally['dark-context']} dark-surface, ${tally.uncertain} uncertain, ${tally.disabled + tally.icon} disabled/icon matches skipped)`)
} else if (!REPORT) {
  console.log(`\ncontrast-sweep: fixed ${tally.fix} occurrence(s) in ${changed.length} file(s).`)
  // Keep the lint guard's exemption list (dark-themed files) in step with what this run found.
  const rc = '.eslintrc.json'
  const txt = readFileSync(rc, 'utf8')
  const list = ['scripts/contrast-sweep.mjs', ...skippedFiles.dark.map(([f]) => f), ...skippedFiles.path.filter(([f]) => f === 'components/Nav.tsx').map(([f]) => f)]
  const next = txt.replace(/("files": \[)"scripts\/contrast-sweep\.mjs"[^\]]*(\])/, `$1${list.map((f) => JSON.stringify(f)).join(', ')}$2`)
  if (next !== txt) { writeFileSync(rc, next); console.log(`contrast-sweep: updated the dark-file exemptions in ${rc} (${list.length - 1} files)`) }
}
