/**
 * Google Solar API pilot — can imagery find solar homes the permits can't?
 *
 *   npx tsx --env-file=.env.local scripts/solar-permits/solar-api-pilot.ts --probe
 *   npx tsx --env-file=.env.local scripts/solar-permits/solar-api-pilot.ts --validate --limit 100
 *   npx tsx --env-file=.env.local scripts/solar-permits/solar-api-pilot.ts --control  --limit 100
 *   npx tsx --env-file=.env.local scripts/solar-permits/solar-api-pilot.ts --discover --county cabarrus --limit 500
 *
 * Needs GOOGLE_SOLAR_API_KEY (server-side only — never NEXT_PUBLIC_).
 *
 * RUN THE MODES IN ORDER. Discovery is worthless until we know the detector's
 * error rates, and we can measure both against data we already hold:
 *
 *   --probe     one address, dumps the raw response. Confirms the request/response
 *               contract before burning calls on a wrong parameter name.
 *   --validate  known-solar addresses from solar_installs. Every MISS here is a
 *               false negative → tells us what fraction of real arrays imagery
 *               would never find.
 *   --control   addresses with NO solar permit. Every HIT is either a false
 *               positive OR a real unpermitted install — the whole point. Sample
 *               a few by hand on the map before believing either story.
 *   --discover  the actual scan.
 *
 * TERMS — read before scaling this up:
 * Google allows caching Solar API results for 30 CONSECUTIVE DAYS, after which
 * the cached copy must be deleted. So this deliberately writes a dated CSV and
 * NOT a row in solar_installs: a permanent Google-derived table would break that.
 * The intended flow is Google points → a rep confirms at the door → the rep's
 * observation becomes our permanent record, which is ours and never expires.
 * Output files carry their own expiry date in the header for that reason.
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetchAllArcGISFeatures } from './arcgis'

const args = process.argv.slice(2)
const argVal = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
const MODE = args.includes('--probe')
  ? 'probe'
  : args.includes('--validate')
    ? 'validate'
    : args.includes('--control')
      ? 'control'
      : args.includes('--discover')
        ? 'discover'
        : null
const LIMIT = Number(argVal('--limit') ?? 100)
// Detector accuracy doesn't vary by county, and Cabarrus alone has only ~86
// known-solar addresses — too thin to estimate an error rate from. Default to the
// full 5,656-row pool; pass --county cabarrus to scope it deliberately.
const COUNTY = argVal('--county') ?? 'all'

/** Free tier is 10,000 buildingInsights calls/month. Refuse to blow it by accident. */
const HARD_CAP = 2000
/** Documented ceiling is 600 QPM; stay well under it. */
const DELAY_MS = 150
/** Google's cache limit. Stamped into every output file. */
const CACHE_DAYS = 30

const API_KEY = process.env.GOOGLE_SOLAR_API_KEY
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!MODE) {
  console.error('Pick a mode: --probe | --validate | --control | --discover')
  process.exit(1)
}
if (!API_KEY) {
  console.error('Missing GOOGLE_SOLAR_API_KEY.')
  console.error('  console.cloud.google.com → enable Solar API → Credentials → API key')
  console.error('  Restrict it to Solar API. Server-side only; never NEXT_PUBLIC_.')
  process.exit(1)
}
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (LIMIT > HARD_CAP) {
  console.error(`--limit ${LIMIT} exceeds the ${HARD_CAP} safety cap. Raise HARD_CAP deliberately.`)
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Detection = {
  status: 'ARRAY_DETECTED' | 'NO_ARRAY' | 'NOT_FOUND' | 'ERROR'
  captureDate: string | null
  detail: string | null
}

/**
 * One buildingInsights lookup.
 *
 * NOT_FOUND is a real, common answer (Google has no building at that point) and
 * is billed as a free error — it must never be conflated with NO_ARRAY, which
 * means "we looked and there are no panels."
 */
async function lookup(lat: number, lng: number): Promise<Detection> {
  const url = new URL('https://solar.googleapis.com/v1/buildingInsights:findClosest')
  url.searchParams.set('location.latitude', String(lat))
  url.searchParams.set('location.longitude', String(lng))
  url.searchParams.set('requiredQuality', 'LOW') // accept any imagery tier; we want coverage
  url.searchParams.set('additionalInsights', 'DETECTED_ARRAYS')
  url.searchParams.set('key', API_KEY!)

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (res.status === 404) return { status: 'NOT_FOUND', captureDate: null, detail: null }
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = body?.error?.message ?? `HTTP ${res.status}`
      if (/NOT_FOUND|no building/i.test(String(msg)))
        return { status: 'NOT_FOUND', captureDate: null, detail: msg }
      return { status: 'ERROR', captureDate: null, detail: String(msg).slice(0, 160) }
    }

    const da = body?.detectedArrays
    const d = da?.latestCaptureDate
    const captureDate = d ? `${d.year}-${String(d.month ?? 1).padStart(2, '0')}-${String(d.day ?? 1).padStart(2, '0')}` : null
    const raw = String(da?.detectionStatus ?? '')
    // EXACT match, never a substring test. Google's negative value is
    // DETECTION_STATUS_NO_ARRAYS_DETECTED, which *contains* "ARRAYS_DETECTED" —
    // a /ARRAYS_DETECTED/ regex scores every "no arrays" answer as a detection
    // and returns a 100% hit rate on random homes. (Caught 2026-09-10 only
    // because the control run's result was implausible.)
    if (raw === 'DETECTION_STATUS_ARRAYS_DETECTED')
      return { status: 'ARRAY_DETECTED', captureDate, detail: raw }
    if (raw === 'DETECTION_STATUS_NO_ARRAYS_DETECTED')
      return { status: 'NO_ARRAY', captureDate, detail: raw }
    // Any other status is unknown, not negative — don't claim "no solar" from it.
    if (raw) return { status: 'ERROR', captureDate, detail: `unexpected status: ${raw}` }
    return { status: 'NO_ARRAY', captureDate, detail: 'no detectedArrays field' }
  } catch (err) {
    return { status: 'ERROR', captureDate: null, detail: (err as Error).message.slice(0, 160) }
  }
}

async function pagedSelect<T>(table: string, columns: string, filter?: (q: any) => any, orderBy = 'id'): Promise<T[]> {
  const out: T[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(columns).order(orderBy, { ascending: true }).range(from, from + PAGE - 1)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) {
      console.error(`read ${table} failed: ${error.message}`)
      process.exit(1)
    }
    out.push(...((data ?? []) as unknown as T[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

type Target = { label: string; address: string; lat: number; lng: number }

async function knownSolarTargets(): Promise<Target[]> {
  const rows = await pagedSelect<{ address: string; lat: number; lng: number; county: string }>(
    'solar_installs',
    'id, address, lat, lng, county',
    (q) => {
      let b = q.eq('pv_class', 'CONFIRMED_PV').eq('is_commercial', false).not('lat', 'is', null)
      if (COUNTY !== 'all') b = b.eq('county', COUNTY)
      return b
    },
  )
  return rows.map((r) => ({ label: 'known-solar', address: r.address, lat: r.lat, lng: r.lng }))
}

/**
 * Control group: canvassed addresses with coordinates that have NO solar permit.
 * Uses leads (rep-visited homes) so the control sits in the same neighborhoods as
 * the treatment — a control drawn from the whole county would differ in housing
 * stock, not just in solar.
 */
async function controlTargets(): Promise<Target[]> {
  const solar = await pagedSelect<{ address: string }>('solar_installs', 'id, address')
  const taken = new Set(
    solar.map((s) => String(s.address ?? '').split(',')[0].toUpperCase().replace(/\s+/g, ' ').trim()).filter(Boolean),
  )
  const leads = await pagedSelect<{ address_text: string; lat: number; lng: number }>(
    'leads',
    'id, address_text, lat, lng',
    (q) => q.not('lat', 'is', null).not('address_text', 'is', null),
  )
  return leads
    .filter((l) => {
      const k = String(l.address_text).split(',')[0].toUpperCase().replace(/\s+/g, ' ').trim()
      return k && !taken.has(k)
    })
    .map((l) => ({ label: 'no-permit', address: l.address_text, lat: l.lat, lng: l.lng }))
}

/** Cabarrus parcel geometry + PIN14. Same layer the roof-age route uses. */
const CABARRUS_PARCELS_URL =
  'https://location.cabarruscounty.us/arcgisservices/rest/services/views/landrecords_view/MapServer/4'

const PARCEL_CACHE = join(__dirname, 'data', 'cabarrus-parcel-centroids.json')

type Parcel = { pin: string; lat: number; lng: number }

/** Bounding-box midpoint of the outer ring. Parcels are compact; this lands on the lot. */
function ringCentroid(rings: number[][][] | undefined): { lat: number; lng: number } | null {
  const ring = rings?.[0]
  if (!ring?.length) return null
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const v of ring) {
    const lng = Number(v?.[0]), lat = Number(v?.[1])
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 }
}

/** Cached — 107k polygons is ~108 paged requests, not worth repeating per run. */
async function cabarrusParcels(): Promise<Parcel[]> {
  if (existsSync(PARCEL_CACHE)) {
    const cached = JSON.parse(readFileSync(PARCEL_CACHE, 'utf8')) as Parcel[]
    console.log(`  parcel centroids (cached): ${cached.length}`)
    return cached
  }
  console.log('  fetching Cabarrus parcel centroids (one-time, ~108 pages)...')
  const feats = await fetchAllArcGISFeatures(CABARRUS_PARCELS_URL, '1=1', 'PIN14', {
    returnGeometry: true,
  })
  const out: Parcel[] = []
  for (const f of feats) {
    const pin = String(f.attributes.PIN14 ?? '').trim()
    if (!pin) continue
    const c = ringCentroid(f.geometry?.rings)
    if (c) out.push({ pin, ...c })
  }
  writeFileSync(PARCEL_CACHE, JSON.stringify(out))
  console.log(`  parcel centroids: ${out.length} (cached to data/)`)
  return out
}

/** Equirectangular approximation — plenty accurate for ranking at county scale. */
function distMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (a.lat - b.lat) * 111320
  const dLng = (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot(dLat, dLng)
}

/**
 * Parcels with no known solar permit, ordered by distance to the nearest home
 * that DOES have one.
 *
 * Solar spreads down a street — one neighbour installs, others follow — so
 * proximity to a known array is the cheapest available prior. A flat random scan
 * hits the ~1% base rate measured in the control run; this should beat it.
 */
/**
 * Coordinates already scanned in earlier discover runs, read back from the dated
 * CSVs. Re-querying them would burn free-tier calls to re-learn what we know, and
 * a plain offset would double-scan if a run were ever interrupted mid-way.
 */
function alreadyScanned(): Set<string> {
  const dir = join(__dirname, 'data')
  const key = (lat: string, lng: string) => `${Number(lat).toFixed(6)}|${Number(lng).toFixed(6)}`
  const seen = new Set<string>()
  if (!existsSync(dir)) return seen
  for (const f of readdirSync(dir)) {
    if (!/^solar-api-discover-.*\.csv$/.test(f)) continue
    const lines = readFileSync(join(dir, f), 'utf8').split('\n').slice(2)
    for (const line of lines) {
      const c = line.split(',')
      if (c.length < 4) continue
      const k = key(c[2], c[3])
      if (k !== 'NaN|NaN') seen.add(k)
    }
  }
  return seen
}

async function discoverTargets(): Promise<Target[]> {
  const parcels = await cabarrusParcels()
  const known = await pagedSelect<{ pin: string; lat: number; lng: number; address: string }>(
    'solar_installs',
    'id, pin, lat, lng, address',
    (q) => q.eq('county', 'cabarrus').not('lat', 'is', null),
  )
  const knownPins = new Set(known.map((k) => String(k.pin ?? '').trim()).filter(Boolean))
  const seeds = known.map((k) => ({ lat: k.lat, lng: k.lng }))
  console.log(`  known cabarrus solar: ${seeds.length} (excluding ${knownPins.size} pins)`)

  const scanned = alreadyScanned()
  const candidates = parcels.filter(
    (p) => !knownPins.has(p.pin) && !scanned.has(`${p.lat.toFixed(6)}|${p.lng.toFixed(6)}`),
  )
  console.log(`  already scanned in prior runs: ${scanned.size}`)
  console.log(`  candidate parcels: ${candidates.length}`)

  // Coarse grid so we don't do 107k x 280 distance checks.
  const CELL = 0.01 // ~1.1km
  const grid = new Map<string, Array<{ lat: number; lng: number }>>()
  const cellKey = (lat: number, lng: number) => `${Math.floor(lat / CELL)}|${Math.floor(lng / CELL)}`
  for (const s of seeds) {
    const k = cellKey(s.lat, s.lng)
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k)!.push(s)
  }
  const nearest = (p: Parcel): number => {
    const ci = Math.floor(p.lat / CELL), cj = Math.floor(p.lng / CELL)
    let best = Infinity
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const s of grid.get(`${ci + di}|${cj + dj}`) ?? []) {
          const d = distMeters(p, s)
          if (d < best) best = d
        }
      }
    }
    return best
  }

  return candidates
    .map((p) => ({ p, d: nearest(p) }))
    .filter((x) => Number.isFinite(x.d))
    .sort((a, b) => a.d - b.d)
    .map((x) => ({ label: `near-solar-${Math.round(x.d)}m`, address: `PIN ${x.p.pin}`, lat: x.p.lat, lng: x.p.lng }))
}

function shuffle<T>(a: T[]): T[] {
  const c = [...a]
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[c[i], c[j]] = [c[j], c[i]]
  }
  return c
}

async function main() {
  console.log(`=== Google Solar API pilot — ${MODE} ===\n`)

  if (MODE === 'probe') {
    const [t] = await knownSolarTargets()
    if (!t) {
      console.error(`No geocoded CONFIRMED_PV rows for county=${COUNTY} to probe.`)
      process.exit(1)
    }
    console.log(`probing a known-solar address: ${t.address}`)
    const url = new URL('https://solar.googleapis.com/v1/buildingInsights:findClosest')
    url.searchParams.set('location.latitude', String(t.lat))
    url.searchParams.set('location.longitude', String(t.lng))
    url.searchParams.set('requiredQuality', 'LOW')
    url.searchParams.set('additionalInsights', 'DETECTED_ARRAYS')
    url.searchParams.set('key', API_KEY!)
    const res = await fetch(url)
    const body = await res.json().catch(() => null)
    console.log(`HTTP ${res.status}`)
    console.log('top-level keys:', body ? Object.keys(body).join(', ') : '(none)')
    console.log('\ndetectedArrays:', JSON.stringify(body?.detectedArrays ?? null, null, 2))
    if (!body?.detectedArrays) {
      console.log('\nNOTE: no detectedArrays field came back. Either the parameter name has')
      console.log('changed or the feature is not enabled for this key. Check the response above')
      console.log('against developers.google.com/maps/documentation/solar/building-insights')
      console.log('BEFORE running --validate, or the results will be meaningless.')
    }
    return
  }

  const pool =
    MODE === 'validate'
      ? await knownSolarTargets()
      : MODE === 'control'
        ? await controlTargets()
        : await discoverTargets()

  // Discovery is ranked by proximity, so taking the head of the list is the point.
  // The measurement modes sample randomly so the estimate isn't biased.
  const targets = MODE === 'discover' ? pool.slice(0, LIMIT) : shuffle(pool).slice(0, LIMIT)
  console.log(`pool: ${pool.length} | sampling: ${targets.length} | ~${targets.length} API calls\n`)

  const results: Array<Target & Detection> = []
  const tally: Record<string, number> = {}
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    const d = await lookup(t.lat, t.lng)
    results.push({ ...t, ...d })
    tally[d.status] = (tally[d.status] ?? 0) + 1
    if ((i + 1) % 20 === 0) process.stdout.write(`\r  ${i + 1}/${targets.length}`)
    await sleep(DELAY_MS)
  }
  console.log(`\r  ${targets.length}/${targets.length}\n`)

  const detected = tally.ARRAY_DETECTED ?? 0
  const looked = detected + (tally.NO_ARRAY ?? 0)
  console.log('=== Results ===')
  Object.entries(tally).forEach(([k, v]) => console.log(`  ${k.padEnd(16)} ${v}`))
  if (looked > 0) {
    const pct = ((detected / looked) * 100).toFixed(1)
    console.log(`\n  detection rate (of buildings actually assessed): ${pct}%`)
    if (MODE === 'validate') {
      console.log(`  → these ALL have solar per county permits, so ${(100 - Number(pct)).toFixed(1)}% is the FALSE-NEGATIVE rate.`)
      console.log('    A high number here means imagery cannot be trusted to find arrays.')
    } else {
      console.log('  → none of these have a solar permit. Hits are either false positives')
      console.log('    OR real unpermitted installs. Spot-check a few on the map before deciding.')
    }
  }

  const expires = new Date(Date.now() + CACHE_DAYS * 864e5).toISOString().slice(0, 10)
  // Timestamp to the minute, not the day: two runs on one date must not clobber
  // each other. alreadyScanned() globs every discover-*.csv, so extra files are
  // free and the exclusion set stays complete.
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const out = join(__dirname, 'data', `solar-api-${MODE}-${stamp}.csv`)
  const headers = ['label', 'address', 'lat', 'lng', 'status', 'captureDate', 'detail']
  const csv = [
    `# Google Solar API ${MODE} run. DELETE BY ${expires} — Google's terms allow ${CACHE_DAYS} days of caching.`,
    headers.join(','),
    ...results.map((r) =>
      headers
        .map((h) => {
          const v = (r as Record<string, unknown>)[h]
          const s = v == null ? '' : String(v)
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(','),
    ),
  ].join('\n')
  writeFileSync(out, `${csv}\n`)
  console.log(`\nwritten: ${out}`)
  console.log(`DELETE BY ${expires} (Google 30-day cache limit)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
