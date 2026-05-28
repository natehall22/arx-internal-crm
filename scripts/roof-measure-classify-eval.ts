/**
 * Classify-only eval: polygon fixtures → classifyRoofEdges → compare LF to targets.
 * No HTTP, no webhooks. Run: npx tsx scripts/roof-measure-classify-eval.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { classifyRoofEdges, FacetInput } from '../lib/roof-measure-edge-classification'

type RectSpec = { id: string; west: number; south: number; east: number; north: number }
type PointSpec = { id: string; points: [number, number][] }

type ClassifyFixture = {
  id: string
  provider?: string
  facets: Array<RectSpec | PointSpec>
  targets: {
    ridges_lf?: number
    hips_lf?: number
    valleys_lf?: number
    eaves_lf?: number
    rakes_lf?: number
    hips_lf_min?: number
    interior_lf_min?: number
  }
  tolerancePct?: number
}

type ClassifyFile = {
  baseLat: number
  baseLng: number
  cases: ClassifyFixture[]
}

const goldenPath = path.join(process.cwd(), 'lib/__tests__/fixtures/roof-edge-golden.json')
const calibrationPath = path.join(process.cwd(), 'scripts/roof-measure-classify-fixtures.json')

function ft(baseLat: number, baseLng: number, northFt: number, eastFt: number) {
  const ftToLat = 1 / 364000
  const ftToLng = ftToLat / Math.cos((baseLat * Math.PI) / 180)
  return { lat: baseLat + northFt * ftToLat, lng: baseLng + eastFt * ftToLng }
}

function toFacet(file: ClassifyFile, spec: RectSpec | PointSpec): FacetInput {
  if ('points' in spec) {
    return {
      id: spec.id,
      points: spec.points.map(([n, e]) => ft(file.baseLat, file.baseLng, n, e)),
    }
  }
  const { id, west, south, east, north } = spec
  return {
    id,
    points: [
      ft(file.baseLat, file.baseLng, south, west),
      ft(file.baseLat, file.baseLng, south, east),
      ft(file.baseLat, file.baseLng, north, east),
      ft(file.baseLat, file.baseLng, north, west),
    ],
  }
}

function withinPct(actual: number, target: number, tolerancePct: number) {
  if (target === 0) return actual === 0
  return Math.abs((actual - target) / target) * 100 <= tolerancePct
}

function runCase(file: ClassifyFile, c: ClassifyFixture) {
  const facets = c.facets.map((f) => toFacet(file, f))
  const r = classifyRoofEdges(facets)
  const tol = c.tolerancePct ?? 12
  const failures: string[] = []

  const check = (label: string, actual: number, target?: number) => {
    if (target == null) return
    if (!withinPct(actual, target, tol)) {
      failures.push(`${label}: got ${Math.round(actual)} expected ~${target} (±${tol}%)`)
    }
  }

  check('ridges_lf', r.ridges_lf, c.targets.ridges_lf)
  check('hips_lf', r.hips_lf, c.targets.hips_lf)
  check('valleys_lf', r.valleys_lf, c.targets.valleys_lf)
  check('eaves_lf', r.eaves_lf, c.targets.eaves_lf)
  check('rakes_lf', r.rakes_lf, c.targets.rakes_lf)

  if (c.targets.interior_lf_min != null) {
    const interior = r.ridges_lf + r.hips_lf + r.valleys_lf
    if (interior < c.targets.interior_lf_min) {
      failures.push(`interior LF: got ${interior} min ${c.targets.interior_lf_min}`)
    }
  }
  if (c.targets.hips_lf_min != null && r.hips_lf < c.targets.hips_lf_min) {
    failures.push(`hips_lf: got ${r.hips_lf} min ${c.targets.hips_lf_min}`)
  }
  if (r.unclassified_shared_lf > 0) {
    failures.push(`unclassified_shared_lf: ${r.unclassified_shared_lf}`)
  }

  const pass = failures.length === 0
  console.log(
    `${pass ? 'PASS' : 'FAIL'} ${c.id}${c.provider ? ` (${c.provider})` : ''} | ` +
      `ridge=${r.ridges_lf} hip=${r.hips_lf} valley=${r.valleys_lf} eave=${r.eaves_lf} rake=${r.rakes_lf}`
  )
  for (const f of failures) console.log(`  - ${f}`)
  return pass
}

function runFile(filePath: string, label: string) {
  if (!fs.existsSync(filePath)) {
    console.log(`Skip ${label}: missing ${filePath}`)
    return { passed: 0, total: 0 }
  }
  const file = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ClassifyFile
  let passed = 0
  console.log(`\n=== ${label} ===`)
  for (const c of file.cases) {
    if (runCase(file, c)) passed++
  }
  console.log(`${passed}/${file.cases.length} passed (${label})`)
  return { passed, total: file.cases.length }
}

function fixtureMode(): 'all' | 'golden' | 'classify' {
  const idx = process.argv.indexOf('--fixtures')
  if (idx >= 0) {
    const mode = process.argv[idx + 1]
    if (mode === 'classify' || mode === 'calibration') return 'classify'
    if (mode === 'golden') return 'golden'
  }
  if (process.argv.includes('--calibration-only')) return 'classify'
  return 'all'
}

function main() {
  const mode = fixtureMode()
  const golden = mode === 'classify' ? { passed: 0, total: 0 } : runFile(goldenPath, 'golden')
  const calibration =
    mode === 'golden' ? { passed: 0, total: 0 } : runFile(calibrationPath, 'Report-benchmark calibration')
  const passed = golden.passed + calibration.passed
  const total = golden.total + calibration.total
  console.log(`\n${passed}/${total} total classify fixtures passed`)
  if (passed !== total) process.exit(1)
}

main()
