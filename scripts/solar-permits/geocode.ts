/**
 * Add coordinates and current owner names to ingested solar_installs rows.
 *
 *   npx tsx --env-file=.env.local scripts/solar-permits/geocode.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/solar-permits/geocode.ts --commit
 *   npx tsx --env-file=.env.local scripts/solar-permits/geocode.ts --county mecklenburg
 *
 * The extract deliberately skipped geometry, so ingested rows have no lat/lng and
 * cannot render on the canvass map. This re-queries the same county ArcGIS layers
 * the extract used, this time asking for geometry (reprojected to WGS84) and the
 * owner-name fields, then joins back on permit number.
 *
 * Two things worth knowing about the sources:
 *  - Mecklenburg's `xcoord`/`ycoord` columns are STATE PLANE, not lat/lng. The
 *    reprojected geometry is the only correct coordinate source.
 *  - Cabarrus and Rowan publish parcel POLYGONS, so the marker is a ring centroid
 *    (bbox midpoint — parcels are compact enough that this lands on the lot).
 *
 * Owner names here are the *current* county record, which is what a mailer should
 * use. They are stored in current_owner_name, never in permit_owner_name.
 */

import { createClient } from '@supabase/supabase-js'
import { fetchAllArcGISFeatures, type ArcGISFeature } from './arcgis'
import {
  CABARRUS_ARCGIS_BASE,
  CABARRUS_HISTORICAL_PERMIT_LAYERS,
  CABARRUS_SOLAR_WHERE,
  CABARRUS_YEAR_LAYERS,
} from './collectors/cabarrus'
import { ROWAN_LAYER_URL, ROWAN_PV_WHERE } from './collectors/rowan'
import {
  MECKLENBURG_BUILDING_PERMITS_URL,
  MECKLENBURG_EPIC_PERMITS_URL,
  MECKLENBURG_EPIC_SOLAR_PV_WHERE,
  MECKLENBURG_LEGACY_SOLAR_WHERE,
} from './collectors/mecklenburg'

const COMMIT = process.argv.includes('--commit')
const countyArgIndex = process.argv.indexOf('--county')
const ONLY_COUNTY = countyArgIndex >= 0 ? process.argv[countyArgIndex + 1] : null

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/** Charlotte-region sanity box. Anything outside is a projection error, not a house. */
const NC_BOUNDS = { minLat: 34.5, maxLat: 36.6, minLng: -81.6, maxLng: -79.8 }

type Located = { lat: number; lng: number; owner: string | null }

function inBounds(lat: number, lng: number): boolean {
  return (
    lat >= NC_BOUNDS.minLat &&
    lat <= NC_BOUNDS.maxLat &&
    lng >= NC_BOUNDS.minLng &&
    lng <= NC_BOUNDS.maxLng
  )
}

/** Point layers give x/y directly; polygon layers give rings → bbox midpoint. */
function coordsOf(feature: ArcGISFeature): { lat: number; lng: number } | null {
  const g = feature.geometry
  if (!g) return null

  if (typeof g.x === 'number' && typeof g.y === 'number') {
    return inBounds(g.y, g.x) ? { lat: g.y, lng: g.x } : null
  }

  const ring = g.rings?.[0]
  if (!ring?.length) return null
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const v of ring) {
    const lng = Number(v?.[0])
    const lat = Number(v?.[1])
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null
  const lat = (minLat + maxLat) / 2
  const lng = (minLng + maxLng) / 2
  return inBounds(lat, lng) ? { lat, lng } : null
}

function clean(value: unknown): string | null {
  const s = String(value ?? '').trim()
  return s && s.toUpperCase() !== 'NULL' ? s : null
}

function record(
  map: Map<string, Located>,
  permitNumber: unknown,
  feature: ArcGISFeature,
  owner: string | null,
) {
  const key = clean(permitNumber)
  if (!key) return
  const c = coordsOf(feature)
  if (!c) return
  // First win: layers are queried newest-first and a permit appears once.
  if (!map.has(key)) map.set(key, { ...c, owner })
}

async function collectMecklenburg(): Promise<Map<string, Located>> {
  const out = new Map<string, Located>()

  const legacy = await fetchAllArcGISFeatures(
    MECKLENBURG_BUILDING_PERMITS_URL,
    MECKLENBURG_LEGACY_SOLAR_WHERE,
    'permitnum,parcelnum,ownname',
    { returnGeometry: true },
  )
  for (const f of legacy) {
    record(out, f.attributes.permitnum, f, clean(f.attributes.ownname))
  }
  console.log(`  legacy BuildingPermits: ${legacy.length} features → ${out.size} located`)

  const epic = await fetchAllArcGISFeatures(
    MECKLENBURG_EPIC_PERMITS_URL,
    MECKLENBURG_EPIC_SOLAR_PV_WHERE,
    '*',
    { returnGeometry: true },
  )
  const before = out.size
  for (const f of epic) {
    const num = f.attributes.permit_number ?? f.attributes.permitnum ?? f.attributes.permit_num
    record(out, num, f, null)
  }
  console.log(`  EPIC Accela: ${epic.length} features → +${out.size - before}`)
  return out
}

async function collectCabarrus(): Promise<Map<string, Located>> {
  const out = new Map<string, Located>()
  for (const layer of CABARRUS_YEAR_LAYERS) {
    const url = `${CABARRUS_ARCGIS_BASE}/${layer.layerId}`
    try {
      const features = await fetchAllArcGISFeatures(url, CABARRUS_SOLAR_WHERE, '*', {
        returnGeometry: true,
      })
      for (const f of features) {
        record(out, f.attributes.PermitNumber, f, clean(f.attributes.OwnerName))
      }
      console.log(`  ${layer.year}: ${features.length} features`)
    } catch (err) {
      console.warn(`  ${layer.year}: FAILED — ${(err as Error).message}`)
    }
  }
  for (const layer of CABARRUS_HISTORICAL_PERMIT_LAYERS) {
    try {
      const features = await fetchAllArcGISFeatures(layer.url, CABARRUS_SOLAR_WHERE, '*', {
        returnGeometry: true,
      })
      for (const f of features) {
        record(out, f.attributes.PermitNumber, f, clean(f.attributes.OwnerName))
      }
      console.log(`  ${layer.year} (historical): ${features.length} features`)
    } catch (err) {
      console.warn(`  ${layer.year} (historical): FAILED — ${(err as Error).message}`)
    }
  }
  return out
}

async function collectRowan(): Promise<Map<string, Located>> {
  const out = new Map<string, Located>()
  const features = await fetchAllArcGISFeatures(ROWAN_LAYER_URL, ROWAN_PV_WHERE, '*', {
    returnGeometry: true,
  })
  for (const f of features) {
    const first = clean(f.attributes.sFirstName_)
    const last = clean(f.attributes.sLastName_)
    const owner = [first, last].filter(Boolean).join(' ') || null
    record(out, f.attributes.sPermitNum, f, owner)
  }
  console.log(`  ALL Permits (Solar/Solar PV): ${features.length} features`)
  return out
}

const COLLECTORS: Record<string, () => Promise<Map<string, Located>>> = {
  mecklenburg: collectMecklenburg,
  cabarrus: collectCabarrus,
  rowan: collectRowan,
}

async function main() {
  const counties = ONLY_COUNTY ? [ONLY_COUNTY] : Object.keys(COLLECTORS)
  console.log('=== Solar geocode ===')
  console.log(`mode      ${COMMIT ? 'COMMIT' : 'DRY RUN (no writes)'}`)
  console.log(`counties  ${counties.join(', ')}\n`)

  let totalMatched = 0
  let totalRows = 0

  for (const county of counties) {
    const collector = COLLECTORS[county]
    if (!collector) {
      console.error(`unknown county: ${county}`)
      process.exit(1)
    }

    console.log(`--- ${county} ---`)
    const located = await collector()
    console.log(`  located permits: ${located.size}`)

    // PostgREST caps a plain select at 1000 rows. Mecklenburg alone has 6k+, so
    // paginate explicitly — without this the county silently geocodes only its
    // first 1000 properties and reports 100% success.
    const rows: Array<{ id: string; permit_numbers: string[] | null }> = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('solar_installs')
        .select('id, permit_numbers')
        .eq('county', county)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) {
        console.error(`  read failed: ${error.message}`)
        process.exit(1)
      }
      rows.push(...((data ?? []) as typeof rows))
      if (!data || data.length < PAGE) break
    }

    const updates: Array<{ id: string; lat: number; lng: number; owner: string | null }> = []
    for (const row of rows) {
      const permits: string[] = row.permit_numbers ?? []
      for (const p of permits) {
        const hit = located.get(String(p).trim())
        if (hit) {
          updates.push({ id: row.id as string, lat: hit.lat, lng: hit.lng, owner: hit.owner })
          break
        }
      }
    }

    totalRows += rows.length
    totalMatched += updates.length
    const pct = rows.length ? ((updates.length / rows.length) * 100).toFixed(1) : '0'
    console.log(`  db rows: ${rows.length} | matched: ${updates.length} (${pct}%)`)
    const withOwner = updates.filter((u) => u.owner).length
    console.log(`  with owner name: ${withOwner}`)

    if (!COMMIT) {
      console.log(`  [dry run] would update ${updates.length} rows\n`)
      continue
    }

    const now = new Date().toISOString()
    let done = 0
    for (const u of updates) {
      const patch: Record<string, unknown> = {
        lat: u.lat,
        lng: u.lng,
        geocoded_at: now,
        geocode_source: `${county}_arcgis`,
      }
      // Never clobber an owner name we already have with a null.
      if (u.owner) {
        patch.current_owner_name = u.owner
        patch.owner_refreshed_at = now
      }
      const { error: upErr } = await supabase.from('solar_installs').update(patch).eq('id', u.id)
      if (upErr) {
        console.error(`  update failed for ${u.id}: ${upErr.message}`)
        process.exit(1)
      }
      done += 1
      if (done % 200 === 0) process.stdout.write(`\r  updated ${done}/${updates.length}`)
    }
    console.log(`\r  updated ${done}/${updates.length}\n`)
  }

  console.log('=== Summary ===')
  console.log(`rows considered: ${totalRows}`)
  console.log(`rows matched:    ${totalMatched}`)

  if (COMMIT) {
    const { count: geocoded } = await supabase
      .from('solar_installs')
      .select('id', { count: 'exact', head: true })
      .not('lat', 'is', null)
    const { count: owned } = await supabase
      .from('solar_installs')
      .select('id', { count: 'exact', head: true })
      .not('current_owner_name', 'is', null)
    console.log(`\n=== Verification ===`)
    console.log(`solar_installs with coords: ${geocoded}`)
    console.log(`solar_installs with owner:  ${owned}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
