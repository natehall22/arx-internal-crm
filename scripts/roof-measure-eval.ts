import fs from 'node:fs'
import path from 'node:path'

type Mode = 'solar' | 'vision'

type Fixture = {
  id: string
  provider: string
  sourceFile: string
  address: string
  targets: {
    totalRoofSqft: number
    totalSquares: number
    facetCount?: number
    predominantPitch?: string
    totalPerimeterLf?: number
    ridgeLf?: number
    hipLf?: number
    eavesLf?: number
    valleysLf?: number
    rakesLf?: number
    wallFlashingLf?: number
    stepFlashingLf?: number
    structures?: Array<{
      label: string
      roofSqft: number
      squares: number
      ridgeLf?: number
    }>
  }
}

type DetectResponse = {
  facets?: Array<{
    id?: string
    estimated_sq_ft?: number
    lat_lng_vertices?: Array<{ lat: number; lng: number }>
  }>
  ridges?: unknown[]
  valleys?: unknown[]
  step_flashing?: unknown[]
  wall_flashing?: unknown[]
  notes?: string
  facet_source?: string
  detection_mode?: string
  openai_calls?: number
  solar_ground_footprint_sqft?: number
  error?: string
}

const fixturePath = path.join(process.cwd(), 'scripts', 'roof-measure-eval-fixtures.json')

function readDotEnvLocal(): Record<string, string> {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return {}

  const rows = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  const env: Record<string, string> = {}
  for (const row of rows) {
    const line = row.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    env[line.slice(0, i)] = line.slice(i + 1).replace(/^['"]|['"]$/g, '')
  }
  return env
}

function getArg(name: string): string | null {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const idx = process.argv.indexOf(name)
  return idx >= 0 ? process.argv[idx + 1] || null : null
}

function hasArg(name: string): boolean {
  return process.argv.includes(name)
}

function printHelp() {
  console.log(`Roof measure eval

Runs known EagleView/Roofr/Xactimate addresses through /api/ai/detect-roof and compares output to ground truth.

Usage:
  npm run dev
  ROOF_EVAL_COOKIE='sb-...auth-token=...' ./node_modules/.bin/tsx scripts/roof-measure-eval.ts --mode solar

Options:
  --mode solar|vision|both     Default: solar. Vision spends OpenAI credits.
  --base-url URL               Default: http://localhost:3000
  --fixture ID                 Run one fixture only.
  --cookie COOKIE              Auth cookie header. Defaults to ROOF_EVAL_COOKIE.
  --help                       Show this help.

Fixtures:
${readFixtures().map((f) => `  ${f.id}  ${f.address}`).join('\n')}
`)
}

function readFixtures(): Fixture[] {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Fixture[]
}

function feetToMeters(feet: number) {
  return feet / 3.28084
}

function polygonAreaSqft(vertices: Array<{ lat: number; lng: number }>) {
  if (vertices.length < 3) return 0
  const lat0 = vertices.reduce((sum, point) => sum + point.lat, 0) / vertices.length
  const metersPerDegreeLat = 111_320
  const metersPerDegreeLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  let sum = 0
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]
    const x1 = a.lng * metersPerDegreeLng
    const y1 = a.lat * metersPerDegreeLat
    const x2 = b.lng * metersPerDegreeLng
    const y2 = b.lat * metersPerDegreeLat
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum / 2) * 10.7639
}

function boundsAround(lat: number, lng: number, radiusFeet: number) {
  const radiusM = feetToMeters(radiusFeet)
  const latDelta = radiusM / 111_320
  const lngDelta = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180))
  return {
    north: lat + latDelta,
    south: lat - latDelta,
    east: lng + lngDelta,
    west: lng - lngDelta,
  }
}

function loadApiKey() {
  const local = readDotEnvLocal()
  return process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    local.GOOGLE_MAPS_API_KEY || local.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
}

async function geocode(address: string) {
  const key = loadApiKey()
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is required for geocoding')

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('address', address)
  url.searchParams.set('key', key)

  const response = await fetch(url)
  const data = await response.json()
  const first = data.results?.[0]
  const location = first?.geometry?.location
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    throw new Error(`Geocode failed for ${address}: ${data.status || 'unknown status'}`)
  }
  return { lat: location.lat as number, lng: location.lng as number }
}

function sumEstimatedSqft(data: DetectResponse) {
  return (data.facets || []).reduce((sum, facet) => {
    const n = Number(facet.estimated_sq_ft)
    if (Number.isFinite(n) && n > 0) return sum + n
    const vertices = Array.isArray(facet.lat_lng_vertices) ? facet.lat_lng_vertices : []
    return sum + polygonAreaSqft(vertices)
  }, 0)
}

function pctDelta(actual: number, target: number) {
  if (!target) return 0
  return ((actual - target) / target) * 100
}

function fmtNumber(value: number | null | undefined, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '-'
}

function verdict(areaDeltaPct: number, actualFacetCount: number, targetFacetCount?: number) {
  const areaAbs = Math.abs(areaDeltaPct)
  const facetMiss = typeof targetFacetCount === 'number' ? Math.abs(actualFacetCount - targetFacetCount) : 0
  if (areaAbs <= 8 && facetMiss <= 2) return 'PASS'
  if (areaAbs <= 18 && facetMiss <= 4) return 'WARN'
  return 'FAIL'
}

async function runOne(baseUrl: string, cookie: string, fixture: Fixture, mode: Mode) {
  const { lat, lng } = await geocode(fixture.address)
  const body = {
    lat,
    lng,
    zoom: 21,
    opportunityId: '',
    mapWidthPx: 900,
    mapHeightPx: 640,
    mapBounds: boundsAround(lat, lng, 190),
    detectionMode: mode,
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/ai/detect-roof`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  })

  const data = (await response.json().catch(() => ({}))) as DetectResponse
  if (!response.ok) {
    return {
      id: fixture.id,
      mode,
      ok: false,
      status: response.status,
      error: data.error || response.statusText,
    }
  }

  const generatedSqft = sumEstimatedSqft(data)
  const generatedFacets = data.facets?.length || 0
  const delta = pctDelta(generatedSqft, fixture.targets.totalRoofSqft)

  return {
    id: fixture.id,
    mode,
    ok: true,
    status: response.status,
    provider: fixture.provider,
    address: fixture.address,
    targetSqft: fixture.targets.totalRoofSqft,
    generatedSqft,
    deltaPct: delta,
    targetFacets: fixture.targets.facetCount,
    generatedFacets,
    result: verdict(delta, generatedFacets, fixture.targets.facetCount),
    facetSource: data.facet_source || 'unknown',
    openaiCalls: data.openai_calls ?? 0,
    notes: data.notes || '',
  }
}

async function main() {
  if (hasArg('--help')) {
    printHelp()
    return
  }

  const modeArg = (getArg('--mode') || 'solar') as Mode | 'both'
  if (!['solar', 'vision', 'both'].includes(modeArg)) throw new Error('--mode must be solar, vision, or both')

  const baseUrl = getArg('--base-url') || process.env.ROOF_EVAL_BASE_URL || 'http://localhost:3000'
  const cookie = getArg('--cookie') || process.env.ROOF_EVAL_COOKIE || ''
  if (!cookie) {
    throw new Error('Provide an authenticated cookie with --cookie or ROOF_EVAL_COOKIE')
  }

  const fixtureId = getArg('--fixture')
  const fixtures = readFixtures().filter((fixture) => !fixtureId || fixture.id === fixtureId)
  if (fixtures.length === 0) throw new Error(`No fixture found for ${fixtureId}`)

  const modes: Mode[] = modeArg === 'both' ? ['solar', 'vision'] : [modeArg]
  const results = []
  for (const fixture of fixtures) {
    for (const mode of modes) {
      results.push(await runOne(baseUrl, cookie, fixture, mode))
    }
  }

  for (const result of results) {
    if (!result.ok) {
      console.log(`${result.id} [${result.mode}] ERROR ${result.status}: ${result.error}`)
      continue
    }

    console.log(
      [
        `${result.result} ${result.id} [${result.mode}]`,
        `target=${fmtNumber(result.targetSqft)} sqft`,
        `generated=${fmtNumber(result.generatedSqft)} sqft`,
        `delta=${fmtNumber(result.deltaPct, 1)}%`,
        `facets=${result.generatedFacets}${result.targetFacets ? `/${result.targetFacets}` : ''}`,
        `source=${result.facetSource}`,
        `openai=${result.openaiCalls}`,
      ].join(' | ')
    )
    if (result.notes) console.log(`  notes: ${result.notes}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
