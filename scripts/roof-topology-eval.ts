import fs from 'node:fs'
import path from 'node:path'
import {
  solveRoofTopology,
  solveRoofTopologyFromSegments,
  type RoofTopologyResult,
} from '@/lib/roof-topology-graph'
import type { ReconPlane, ReconPoint } from '@/lib/roof-plane-reconstruction'

type FixturePlane = {
  segment_index: number
  azimuth_degrees: number
  pitch_degrees: number
  cx: number
  cy: number
  cz: number
}

type FixtureTargets = {
  status?: 'ship' | 'force_manual'
  facetCount?: number
  ridgeLf?: number
  hipLf?: number
  hipLfMin?: number
  valleyLf?: number
  valleysLf?: number
  eavesLf?: number
  rakesLf?: number
  groundSqft?: number
}

type LatLng = { lat: number; lng: number }

type FixtureSegment = {
  segment_index: number
  pitch_degrees: number | null
  azimuth_degrees: number | null
  plane_height_at_center_meters: number | null
  center: LatLng | null
}

type Fixture = {
  id: string
  description?: string
  address?: string
  skip?: boolean
  captureStatus?: 'ok' | 'degraded'
  captureNotes?: string
  origin?: LatLng
  segments?: FixtureSegment[]
  footprintLatLng?: LatLng[]
  maskFacets?: unknown[]
  planes?: FixturePlane[]
  footprint?: ReconPoint[]
  targets: FixtureTargets
}

type EvalRow = {
  id: string
  kind: 'synthetic' | 'live'
  status: 'PASS' | 'FAIL' | 'SKIP' | 'PARITY'
  detail: string
  threw?: boolean
}

const fixturePath = path.join(process.cwd(), 'scripts', 'roof-topology-eval-fixtures.json')
const strictLive = process.argv.includes('--strict-live')

function readFixtures(): Fixture[] {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Fixture[]
}

function toPlane(spec: FixturePlane): ReconPlane {
  const p = (spec.pitch_degrees * Math.PI) / 180
  const a = (spec.azimuth_degrees * Math.PI) / 180
  const nx = Math.sin(p) * Math.sin(a)
  const ny = Math.sin(p) * Math.cos(a)
  const nz = Math.cos(p)
  return {
    segment_index: spec.segment_index,
    azimuth_degrees: spec.azimuth_degrees,
    pitch_degrees: spec.pitch_degrees,
    nx,
    ny,
    nz,
    d: nx * spec.cx + ny * spec.cy + nz * spec.cz,
    cx: spec.cx,
    cy: spec.cy,
    cz: spec.cz,
  }
}

function closeSynthetic(actual: number, expected: number, tol = 10): boolean {
  return Math.abs(actual - expected) <= tol
}

function closeLiveLf(actual: number, expected: number): boolean {
  const pctBand = Math.abs(expected) * 0.25
  return Math.abs(actual - expected) <= Math.max(15, pctBand)
}

function closeLiveSqft(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= Math.max(50, Math.abs(expected) * 0.2)
}

function pctError(actual: number, expected: number): string {
  if (expected === 0) return actual === 0 ? '0%' : 'n/a'
  const pct = ((actual - expected) / expected) * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

function isLiveFixture(f: Fixture): boolean {
  return Boolean(f.segments && f.footprintLatLng)
}

function solveFixture(f: Fixture): RoofTopologyResult | null {
  if (f.segments && f.footprintLatLng) {
    return solveRoofTopologyFromSegments(f.segments, f.footprintLatLng, f.origin)
  }
  if (f.planes && f.footprint) {
    return solveRoofTopology({
      planes: f.planes.map(toPlane),
      footprint: f.footprint,
    })
  }
  return null
}

function metricChecks(
  result: RoofTopologyResult,
  t: FixtureTargets,
  live: boolean
): { failures: string[]; parityLines: string[] } {
  const failures: string[] = []
  const parityLines: string[] = []
  const closeLf = live ? closeLiveLf : closeSynthetic
  const closeSqft = live ? closeLiveSqft : (a: number, e: number) => closeSynthetic(a, e, 50)

  const note = (label: string, actual: number, expected: number, ok: boolean) => {
    const err = pctError(actual, expected)
    parityLines.push(`${label}: act=${actual} tgt=${expected} (${err})`)
    if (!ok) failures.push(`${label} ${actual} vs ${expected} (${err})`)
  }

  if (t.status && result.status !== t.status) {
    failures.push(`status ${result.status} != ${t.status} (${result.reason})`)
    parityLines.push(`status: act=${result.status} tgt=${t.status}`)
  }

  if (typeof t.facetCount === 'number') {
    note('facetCount', result.totals.facetCount, t.facetCount, result.totals.facetCount === t.facetCount)
  }
  if (typeof t.ridgeLf === 'number') {
    note('ridgeLf', result.totals.ridgeLf, t.ridgeLf, closeLf(result.totals.ridgeLf, t.ridgeLf))
  }
  if (typeof t.hipLf === 'number') {
    note('hipLf', result.totals.hipLf, t.hipLf, closeLf(result.totals.hipLf, t.hipLf))
  }
  if (typeof t.hipLfMin === 'number' && result.totals.hipLf < t.hipLfMin) {
    failures.push(`hipLf ${result.totals.hipLf} < min ${t.hipLfMin}`)
  }
  const valleyTarget = t.valleyLf ?? t.valleysLf
  if (typeof valleyTarget === 'number') {
    note('valleyLf', result.totals.valleyLf, valleyTarget, closeLf(result.totals.valleyLf, valleyTarget))
  }
  if (typeof t.eavesLf === 'number') {
    note('eavesLf', result.totals.eavesLf, t.eavesLf, closeLf(result.totals.eavesLf, t.eavesLf))
  }
  if (typeof t.rakesLf === 'number') {
    note('rakesLf', result.totals.rakesLf, t.rakesLf, closeLf(result.totals.rakesLf, t.rakesLf))
  }
  if (typeof t.groundSqft === 'number') {
    note(
      'groundSqft',
      result.totals.groundSqft,
      t.groundSqft,
      closeSqft(result.totals.groundSqft, t.groundSqft)
    )
  }

  return { failures, parityLines }
}

function checkFixture(f: Fixture): EvalRow {
  if (f.skip) {
    const note = f.captureNotes ? ` — ${f.captureNotes}` : ''
    return {
      id: f.id,
      kind: isLiveFixture(f) ? 'live' : 'synthetic',
      status: 'SKIP',
      detail: (f.description ?? 'skipped') + note,
    }
  }

  try {
    const result = solveFixture(f)
    if (!result) {
      return {
        id: f.id,
        kind: isLiveFixture(f) ? 'live' : 'synthetic',
        status: 'FAIL',
        detail: 'missing planes/footprint or segments/footprintLatLng',
      }
    }

    const live = isLiveFixture(f)
    const { failures, parityLines } = metricChecks(result, f.targets, live)

    if (live) {
      const summary = `${result.status} R${result.totals.ridgeLf}/H${result.totals.hipLf}/V${result.totals.valleyLf}/E${result.totals.eavesLf}/K${result.totals.rakesLf} sq=${result.totals.groundSqft} facets=${result.totals.facetCount}`
      if (failures.length > 0) {
        if (f.id === 'randy-hart-arx-reviewed') {
          parityLines.push(
            'note: reviewed PDF labels ridge=0 valleys=27 hip=81 — geometric hip roofs often have ridge+hips and 0 valleys; report both'
          )
        }
        return {
          id: f.id,
          kind: 'live',
          status: 'PARITY',
          detail: `${summary}\n    ${parityLines.join('\n    ')}`,
        }
      }
      return {
        id: f.id,
        kind: 'live',
        status: 'PASS',
        detail: `${summary} (within live tolerance)`,
      }
    }

    if (failures.length > 0) {
      return { id: f.id, kind: 'synthetic', status: 'FAIL', detail: failures.join('; ') }
    }
    return {
      id: f.id,
      kind: 'synthetic',
      status: 'PASS',
      detail: `${result.status} R${result.totals.ridgeLf}/H${result.totals.hipLf}/V${result.totals.valleyLf} facets=${result.totals.facetCount}`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      id: f.id,
      kind: isLiveFixture(f) ? 'live' : 'synthetic',
      status: 'FAIL',
      detail: `threw: ${msg}`,
      threw: true,
    }
  }
}

function main() {
  const fixtures = readFixtures()
  const rows = fixtures.map(checkFixture)

  console.log('\nRoof topology eval\n')
  console.log(
    'fixture'.padEnd(28) +
      'kind'.padEnd(12) +
      'status'.padEnd(10) +
      'detail'
  )
  for (const r of rows) {
    const lines = r.detail.split('\n')
    console.log(r.id.padEnd(28) + r.kind.padEnd(12) + r.status.padEnd(10) + lines[0])
    for (let i = 1; i < lines.length; i++) {
      console.log(''.padEnd(50) + lines[i])
    }
  }
  console.log('')

  const syntheticFail = rows.filter((r) => r.kind === 'synthetic' && r.status === 'FAIL')
  const liveThrow = rows.filter((r) => r.kind === 'live' && r.threw)
  const liveParity = rows.filter((r) => r.kind === 'live' && r.status === 'PARITY')

  if (syntheticFail.length > 0) {
    console.log(`Synthetic FAIL: ${syntheticFail.map((r) => r.id).join(', ')}`)
  }
  if (liveParity.length > 0) {
    console.log(`Live parity distance (report-only${strictLive ? ', strict mode' : ''}):`)
    for (const r of liveParity) {
      console.log(`  ${r.id}`)
    }
  }
  if (liveThrow.length > 0) {
    console.log(`Live threw: ${liveThrow.map((r) => r.id).join(', ')}`)
  }

  const shouldExit =
    syntheticFail.length > 0 || liveThrow.length > 0 || (strictLive && liveParity.length > 0)
  if (shouldExit) process.exit(1)
}

main()
