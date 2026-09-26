/**
 * Score the in-house lidar roof measure against carrier reports.
 *
 *   npm run lidar:eval
 *
 * Reads cached building points (scripts/lidar-ingest.ts must have processed the tiles)
 * and prints squares / ridge / hip / valley / eave vs the carrier for each fixture, then
 * mean absolute errors. Read-only. Truth from scripts/roof-measure-eval-fixtures.json and
 * docs/measure-tool/lessons-learned.md; pins from the saved CRM measurements.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadBuildingPointsNear } from '../lib/lidar/building-points'
import { measureRoofFromLidar } from '../lib/lidar/roof-planes'

for (const filename of ['.env.local', '.env']) {
  const p = resolve(process.cwd(), filename)
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m || process.env[m[1]] != null) continue
    process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
  }
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

type Fixture = {
  name: string; lat: number; lng: number; squares: number
  ridge?: number; hip?: number; valley?: number; cap?: number; eaves?: number; note?: string
}
const FIXTURES: Fixture[] = [
  { name: 'corriher', lat: 35.58678368308799, lng: -80.65420313016108, squares: 74.02, ridge: 135.3, hip: 190.69 },
  { name: 'magnolia', lat: 35.4737195, lng: -80.8817724, squares: 27.99, ridge: 105.95, hip: 8.73 },
  { name: 'morales', lat: 35.55368020445127, lng: -80.58993369704308, squares: 12.6, ridge: 55.75, hip: 0 },
  { name: 'randyhart', lat: 35.52030365785559, lng: -80.66534543505763, squares: 17.01, ridge: 0, hip: 81, valley: 27, eaves: 168, note: 'ARX-reviewed, not carrier' },
  { name: 'kison', lat: 35.43764490274893, lng: -80.63291698773156, squares: 17.46, ridge: 64.67, valley: 40.83, eaves: 127.5 },
  { name: 'nottingham', lat: 35.4876174, lng: -80.77528219999999, squares: 37.83, ridge: 123.5, hip: 26.76 },
  { name: 'peduto', lat: 35.32260087009757, lng: -80.61937674425458, squares: 34.6, cap: 100.88, eaves: 163.39, note: 'dwelling; addition may postdate lidar' },
  { name: 'kaestner', lat: 35.393335094332826, lng: -80.56620571752828, squares: 23.16, cap: 107.72, eaves: 187.77 },
  { name: 'florence', lat: 35.500182216014956, lng: -80.58880566499609, squares: 12.65, ridge: 45.69, hip: 0 },
  { name: 'denbur', lat: 35.228288748919226, lng: -80.67331340817, squares: 27.53, note: 'house + attached secondary roof' },
]

const pct = (got: number, want?: number) =>
  want == null ? '' : want === 0 ? (got === 0 ? '(ok)' : `(+${got})`) : `(${got >= want ? '+' : ''}${Math.round(((got - want) / want) * 100)}%)`

async function main() {
  const err = { squares: [] as number[], cap: [] as number[], ridge: [] as number[] }
  for (const f of FIXTURES) {
    const loaded = await loadBuildingPointsNear(db, f.lat, f.lng)
    if (loaded.status !== 'ok') { console.log(`${f.name.padEnd(11)} ${loaded.status}`); continue }
    const r = measureRoofFromLidar(loaded.points)
    if (!r) { console.log(`${f.name.padEnd(11)} no building at pin (built after the survey?)`); continue }
    const t = r.totals
    const cap = t.ridgeLf + t.hipLf
    const capTruth = f.cap ?? (f.ridge != null && f.hip != null ? f.ridge + f.hip : undefined)
    err.squares.push(Math.abs(t.squares - f.squares) / f.squares)
    if (capTruth) err.cap.push(Math.abs(cap - capTruth) / capTruth)
    if (f.ridge) err.ridge.push(Math.abs(t.ridgeLf - f.ridge) / f.ridge)
    console.log(
      `${f.name.padEnd(11)} sq ${t.squares} vs ${f.squares} ${pct(t.squares, f.squares)}  R=${t.ridgeLf}${pct(t.ridgeLf, f.ridge)} H=${t.hipLf}${pct(t.hipLf, f.hip)} ` +
      `cap=${cap}${pct(cap, capTruth)} V=${t.valleyLf}${pct(t.valleyLf, f.valley)} E=${t.eaveLf}${pct(t.eaveLf, f.eaves)} K=${t.rakeLf} step=${t.stepLf} planes=${r.planes.length}` +
      (f.note ? `  [${f.note}]` : '')
    )
  }
  const mean = (xs: number[]) => (xs.length ? `${Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100)}% (n=${xs.length})` : 'n/a')
  console.log(`\nmean abs error — squares ${mean(err.squares)}, cap ${mean(err.cap)}, ridge ${mean(err.ridge)}`)
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
