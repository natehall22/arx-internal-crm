/**
 * Offline diagnose: Solar segment count, mask path reason, DSM layers.
 * Usage: npx tsx scripts/roof-measure-mask-diagnose.ts
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fetchSolarDataLayerUrls } from '../lib/solar-dsm'
import {
  tryFacetPayloadsFromSolarRoofMask,
  type SolarMaskSegment,
} from '../lib/solar-roof-mask-facets'

function loadEnvFile(filename: string) {
  const path = resolve(process.cwd(), filename)
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    const key = m[1]
    let val = m[2].trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] == null) process.env[key] = val
  }
}

loadEnvFile('.env.local')
loadEnvFile('.env')

const DEFAULT_ADDRESSES = [
  '304 Greenway Dr, Huntersville NC 28078',
  '1361 Kison Court Northwest, Concord, NC 28027',
  '2712 Lyla Ave, Concord, NC',
  '276 Epworth St NW, Concord, NC 28027',
]
const cliAddress = process.argv.slice(2).join(' ').trim()
const ADDRESSES = cliAddress ? [cliAddress] : DEFAULT_ADDRESSES

function loadApiKey(): string {
  const key =
    process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY required in .env.local')
  return key
}

async function geocode(address: string, key: string) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('address', address)
  url.searchParams.set('key', key)
  const response = await fetch(url)
  const data = await response.json()
  const loc = data.results?.[0]?.geometry?.location
  if (!loc) throw new Error(`Geocode failed: ${address} (${data.status})`)
  return { lat: loc.lat as number, lng: loc.lng as number }
}

async function fetchSolarSegments(lat: number, lng: number, key: string) {
  const url =
    `https://solar.googleapis.com/v1/buildingInsights:findClosest` +
    `?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${key}`
  const response = await fetch(url)
  if (!response.ok) {
    return { segments: [] as SolarMaskSegment[], status: response.status }
  }
  const data = await response.json()
  const roofSegments = data?.solarPotential?.roofSegmentStats ?? []
  const segments: SolarMaskSegment[] = roofSegments.map((segment: any, index: number) => ({
    segment_index: index,
    pitch_degrees: typeof segment.pitchDegrees === 'number' ? segment.pitchDegrees : null,
    azimuth_degrees: typeof segment.azimuthDegrees === 'number' ? segment.azimuthDegrees : null,
    area_m2: typeof segment?.stats?.areaMeters2 === 'number' ? segment.stats.areaMeters2 : null,
    ground_area_m2:
      typeof segment?.stats?.groundAreaMeters2 === 'number' ? segment.stats.groundAreaMeters2 : null,
    plane_height_at_center_meters:
      typeof segment?.planeHeightAtCenterMeters === 'number'
        ? segment.planeHeightAtCenterMeters
        : null,
    center: segment?.center
      ? { lat: segment.center.latitude, lng: segment.center.longitude }
      : null,
    bounding_box:
      segment?.boundingBox?.sw && segment?.boundingBox?.ne
        ? {
            sw: { lat: segment.boundingBox.sw.latitude, lng: segment.boundingBox.sw.longitude },
            ne: { lat: segment.boundingBox.ne.latitude, lng: segment.boundingBox.ne.longitude },
          }
        : null,
  }))
  return { segments, status: 200 }
}

async function main() {
  const key = loadApiKey()
  console.log('Roof measure mask/DSM diagnose\n')

  for (const address of ADDRESSES) {
    const { lat, lng } = await geocode(address, key)
    const { segments, status } = await fetchSolarSegments(lat, lng, key)
    const layers = await fetchSolarDataLayerUrls(lat, lng, key)

    const labels = ['requested_pin', 'capture_center'] as const

    console.log('---')
    console.log(address)
    console.log(`  lat/lng: ${lat.toFixed(6)}, ${lng.toFixed(6)}`)
    console.log(`  buildingInsights: ${status === 200 ? 'ok' : status}`)
    console.log(`  solar segments: ${segments.length}`)
    for (const segment of segments) {
      console.log(
        `    #${segment.segment_index}: pitch=${segment.pitch_degrees ?? '-'} az=${segment.azimuth_degrees ?? '-'} ground_m2=${segment.ground_area_m2?.toFixed(1) ?? '-'} height_m=${segment.plane_height_at_center_meters?.toFixed(2) ?? '-'}`
      )
    }
    console.log(`  dataLayers mask: ${layers.maskUrl ? 'yes' : 'no'}  dsm: ${layers.dsmUrl ? 'yes' : 'no'}`)
    for (const label of labels) {
      const attempt = await tryFacetPayloadsFromSolarRoofMask({
        lat,
        lng,
        apiKey: key,
        referenceLat: lat,
        referenceLng: lng,
        segments,
        querySource: label,
      })
      const extra =
        attempt.details?.nearest_contour_m != null
          ? ` nearest_m=${attempt.details.nearest_contour_m}`
          : ''
      const splitMethod =
        typeof attempt.details?.split_method === 'string'
          ? ` split=${attempt.details.split_method}`
          : ''
      const mergedCount =
        typeof attempt.details?.merged_segment_count === 'number'
          ? ` merged=${attempt.details.merged_segment_count}`
          : ''
      console.log(
        `  mask @ ${label}: reason=${attempt.reason} facets=${attempt.facets?.length ?? 0}${splitMethod}${mergedCount}${extra}`
      )
      if (attempt.reason === 'ok' && attempt.facets?.length) {
        const path =
          typeof attempt.details?.path === 'string' ? attempt.details.path : '-'
        const mode =
          typeof attempt.details?.split_quality_mode === 'string'
            ? attempt.details.split_quality_mode
            : '-'
        console.log(`    path=${path} split_quality_mode=${mode}`)
        for (const facet of attempt.facets) {
          console.log(`    facet ${facet.id}: source=${facet.facet_source}`)
        }
        if (typeof attempt.details?.overlapping_pairs === 'number') {
          console.log(`    overlapping_pairs=${attempt.details.overlapping_pairs}`)
        }
      }
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
