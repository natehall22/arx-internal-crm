/**
 * Score DSM plane-fit drain direction + 3D edge rule against carrier reports.
 *
 *   npx tsx scripts/roof-measure-dsm-eval.ts
 *
 * Replays each fixture's saved CRM measurement (auto geometry only — drawn ridge /
 * valley lines excluded) three ways and prints ridge / hip / cap / valley / eave LF
 * next to the carrier's numbers:
 *   today   — drain direction as saved (mostly footprint_auto guesses)
 *   dsm-az  — drain direction from a DSM plane fit per facet (manual still wins)
 *   dsm-3d  — dsm-az plus the 3D convex/concave + level-edge rule on interior edges
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { classifyRoofEdges, type FacetInput } from '../lib/roof-measure-edge-classification'
import { slopeCorrectEdgeTotals } from '../lib/roof-edge-slope-correction'
import { fitFacetPlaneFromDsm } from '../lib/roof-facet-dsm-plane'
import { splitFacetEdgesAtTJunctions } from '../lib/roof-facet-tjunction'
import { fetchSolarDataLayerUrls, loadDsmHeightSampler } from '../lib/solar-dsm'

for (const filename of ['.env.local', '.env']) {
  const p = resolve(process.cwd(), filename)
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m || process.env[m[1]] != null) continue
    process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SOLAR_KEY = process.env.GOOGLE_SOLAR_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''

// Carrier truth (scripts/roof-measure-eval-fixtures.json) → saved measurement id. Scope notes
// from docs/measure-tool/lessons-learned.md: Peduto/Kaestner carriers report ridge+hip as "Ridge".
const JOBS: { id: string; label: string; ridge?: number; hip?: number; cap?: number; eaves?: number; valleys?: number }[] = [
  { id: 'e70480e2-51dd-4faa-882a-cc235c264cb9', label: 'Corriher', ridge: 135.3, hip: 190.69 },
  { id: '08364e95-24fb-44c6-bd77-3675c5ddba52', label: 'Magnolia', ridge: 105.95, hip: 8.73 },
  { id: '643e0e5b-3d10-4d33-bdbf-85fa33029b5c', label: 'Morales', ridge: 55.75, hip: 0 },
  { id: '39a4742a-1e83-431e-99a0-21dff0d97621', label: 'Nottingham', ridge: 123.5, hip: 26.76 },
  { id: '9494a3f8-64d9-4997-a982-d0be2614bea0', label: 'Kaestner', cap: 107.72, ridge: 83, hip: 20, eaves: 187.77 },
  { id: '352fc4d3-7038-426f-8d66-80fb4edc33a1', label: 'Peduto', cap: 100.88, eaves: 163.39 },
  { id: 'ed335a9a-17a6-4a22-934e-b7b28061be15', label: 'Kison', ridge: 64.67, eaves: 127.5, valleys: 40.83 },
  { id: '2abdc232-8542-494e-98ce-0143b7470cba', label: 'Florence', ridge: 45.69, hip: 0 },
  { id: '32255b20-8bc3-410b-ae0b-63c1049655ce', label: 'Florida(house)', ridge: 53.9, hip: 0 },
  { id: '294763b4-1b95-48d1-9849-2875ec0a33ad', label: 'RandyHart*', ridge: 0, hip: 81, eaves: 168, valleys: 27 },
]

type SavedFacet = FacetInput & { pitch?: string; pitch_multiplier?: number }

async function loadMeasurement(id: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/roof_measurements?id=eq.${id}&select=raw_data`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  const rows = (await r.json()) as { raw_data: { lat: number | string; lng: number | string; facets: SavedFacet[] } }[]
  return rows[0]?.raw_data
}

function run(facets: SavedFacet[]) {
  const raw = classifyRoofEdges(facets)
  const mult = new Map(facets.map((f) => [f.id, f.pitch && f.pitch !== 'Unset' ? f.pitch_multiplier || 1.118 : 1]))
  return slopeCorrectEdgeTotals(raw, mult)
}

const pct = (got: number, want?: number) =>
  want == null ? '' : want === 0 ? (got === 0 ? ' (ok)' : ` (+${got})`) : ` (${got >= want ? '+' : ''}${Math.round(((got - want) / want) * 100)}%)`

async function main() {
  const errs: Record<string, { cap: number[]; ridge: number[] }> = {
    today: { cap: [], ridge: [] }, 'dsm-az': { cap: [], ridge: [] }, 'dsm-3d': { cap: [], ridge: [] },
    tjunc: { cap: [], ridge: [] }, 'tj+az': { cap: [], ridge: [] }, 'tj+3d': { cap: [], ridge: [] },
  }
  for (const job of JOBS) {
    const raw = await loadMeasurement(job.id)
    if (!raw) { console.log(job.label, 'missing'); continue }
    const lat = Number(raw.lat), lng = Number(raw.lng)
    const urls = await fetchSolarDataLayerUrls(lat, lng, SOLAR_KEY).catch(() => null)
    const sampler = urls?.dsmUrl ? await loadDsmHeightSampler(urls.dsmUrl, SOLAR_KEY) : null
    const facets = raw.facets.filter((f) => Array.isArray(f.points) && f.points.length >= 3)

    const planes = new Map(facets.map((f) => [f.id, sampler ? fitFacetPlaneFromDsm(f.points, sampler) : null]))
    const withAz = facets.map((f) => {
      const pl = planes.get(f.id)
      if (f.drain_azimuth_source === 'manual' || !pl || pl.drainAzimuthDegrees == null) return f
      return { ...f, drain_azimuth_degrees: pl.drainAzimuthDegrees, drain_azimuth_source: 'dsm' as const }
    })
    const with3d = withAz.map((f) => ({ ...f, dsm_plane: planes.get(f.id) ?? null }))

    const fitted = Array.from(planes.values()).filter(Boolean).length
    console.log(`\n${job.label}  facets=${facets.length} dsm-fit=${fitted}  truth R=${job.ridge ?? '-'} H=${job.hip ?? '-'} cap=${job.cap ?? (job.ridge != null && job.hip != null ? +(job.ridge + job.hip).toFixed(1) : '-')} eaves=${job.eaves ?? '-'} V=${job.valleys ?? '-'}`)
    const variants: [string, SavedFacet[]][] = [
      ['today', facets], ['dsm-az', withAz], ['dsm-3d', with3d],
      ['tjunc', splitFacetEdgesAtTJunctions(facets)], ['tj+az', splitFacetEdgesAtTJunctions(withAz)], ['tj+3d', splitFacetEdgesAtTJunctions(with3d)],
    ]
    for (const [name, fs] of variants) {
      const r = run(fs as SavedFacet[])
      const cap = r.ridges_lf + r.hips_lf
      const capTruth = job.cap ?? (job.ridge != null && job.hip != null ? job.ridge + job.hip : undefined)
      if (capTruth) errs[name].cap.push(Math.abs(cap - capTruth) / capTruth)
      if (job.ridge != null && job.ridge > 0 && job.cap == null) errs[name].ridge.push(Math.abs(r.ridges_lf - job.ridge) / job.ridge)
      console.log(
        `  ${name.padEnd(7)} R=${r.ridges_lf}${pct(r.ridges_lf, job.cap == null ? job.ridge : undefined)}  H=${r.hips_lf}  cap=${cap}${pct(cap, capTruth)}  V=${r.valleys_lf}${pct(r.valleys_lf, job.valleys)}  eaves=${r.eaves_lf}${pct(r.eaves_lf, job.eaves)} rakes=${r.rakes_lf} unk=${r.unclassified_shared_lf}`
      )
    }
  }
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) : NaN)
  console.log('\nMean abs error  cap / ridge (ridge only where carrier splits it):')
  for (const k of Object.keys(errs)) console.log(`  ${k.padEnd(7)} cap ${mean(errs[k].cap)}% (n=${errs[k].cap.length})   ridge ${mean(errs[k].ridge)}% (n=${errs[k].ridge.length})`)
}

main().catch((e) => { console.error(e); process.exit(1) })
