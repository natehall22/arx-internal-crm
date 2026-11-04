import { randomUUID } from 'crypto'
import {
  PUBLIC_ESTIMATE_DEFAULT_PITCH_RISE,
  PUBLIC_ESTIMATE_MAX_IMAGERY_AGE_YEARS,
  PUBLIC_ESTIMATE_SATELLITE_SIZE,
  PUBLIC_ESTIMATE_SATELLITE_ZOOM,
  getPublicEstimateOrgId,
  getPublicEstimatePricePerSquare,
  getPublicEstimateSoldWastePercent,
  type PublicEstimateConfidence,
} from '@/lib/public-estimate-config'
import {
  resolvePublicEstimatePricingPath,
  computePublicEstimatePricing,
} from '@/lib/public-estimate-pricing'
import { resolvePublicEstimatePricePerSquare } from '@/lib/public-estimate-rate'
import { calibrationFactorFor, loadInstantEstimateCalibration } from '@/lib/instant-estimate-calibration'
import { measureLidarRoofNear } from '@/lib/lidar/measure-near'
import type { NearbyStructure } from '@/lib/lidar/roof-planes'
import { ROOF_MEASURE_LIDAR_ENABLED } from '@/lib/roof-measure-flags'
import { createServiceClient } from '@/lib/supabase/service'
import { isPublicEstimateManualMeasureRequired } from '@/lib/public-estimate-manual-measure'
import {
  approximatePlanarPolygonAreaSqft,
  haversineDistanceFeet,
  pitchMultiplierFromRise,
  squareMetersToSquareFeet,
} from '@/lib/roof-measure-geometry'
import { selectPublicEstimateMeasure } from '@/lib/public-estimate-measure-select'
import {
  tryFacetPayloadsFromSolarRoofMask,
  type SolarMaskAttemptResult,
  type SolarMaskSegment,
} from '@/lib/solar-roof-mask-facets'
import { fetchStaticSatelliteMapBase64 } from '@/lib/static-satellite-map'
import { LOW_SLOPE_DEGREES, pitchMultiplierFromDegrees } from '@/lib/public-estimate-pitch'

export { isPublicEstimateManualMeasureRequired } from '@/lib/public-estimate-manual-measure'

/** Bump when the measure or pricing logic changes, so accuracy checks compare like with like. */
export const INSTANT_ESTIMATE_VERSION = 'ie-2026-11a'

type GeocodeResult = { lat: number; lng: number; formatted_address: string; location_type: string | null }

async function geocodeAddressDetailed(address: string): Promise<GeocodeResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!apiKey || !address.trim()) return null
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    url.searchParams.set('address', address)
    url.searchParams.set('key', apiKey)
    const response = await fetch(url.toString(), { cache: 'no-store' })
    if (!response.ok) return null
    const data = (await response.json()) as {
      status?: string
      results?: Array<{
        formatted_address?: string
        geometry?: { location?: { lat?: number; lng?: number }; location_type?: string }
      }>
    }
    if (data.status !== 'OK') return null
    const top = data.results?.[0]
    const location = top?.geometry?.location
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') return null
    return {
      lat: location.lat,
      lng: location.lng,
      formatted_address: (top?.formatted_address || address).trim(),
      location_type: top?.geometry?.location_type ?? null,
    }
  } catch {
    return null
  }
}

export type PublicRoofMeasureResult = {
  address: string
  lat: number
  lng: number
  /** Squares the customer is priced on (base + sold waste, × calibration). */
  squares_mid: number
  squares_low: number
  squares_high: number
  /** Roof surface squares with no waste. */
  base_squares: number
  waste_percent: number
  facet_count: number
  measure_source: string
  confidence: PublicEstimateConfidence
  /** Reasons confidence dropped or things a rep should check (never shown to the homeowner). */
  flags: string[]
  /** Possible detached garages/shops (lidar only; sheds ignored). Not included in squares. */
  other_structures: NearbyStructure[]
  imagery_date: string | null
  lidar_collected_end: string | null
  calibration_factor: number
  estimate_version: string
  price_per_square: number
  price_mid: number
  price_low: number
  price_high: number
  satellite_image_base64: string | null
  requires_manual_measure: boolean
  /** Diagnostic — server-side only; not in preview token or website JSON. */
  mask_base_squares?: number | null
  segments_base_squares?: number | null
  split_quality_mode?: string | null
  measure_select_reason?: string | null
}

type SolarBuildingInsights = {
  anchor: { lat: number; lng: number } | null
  segments: SolarMaskSegment[]
  imageryDate: string | null
  imageryQuality: string | null
}

function extractLatLng(value: unknown): { lat: number; lng: number } | null {
  if (!value || typeof value !== 'object') return null
  const lat = (value as { latitude?: unknown; lat?: unknown }).latitude ?? (value as { lat?: unknown }).lat
  const lng =
    (value as { longitude?: unknown; lng?: unknown }).longitude ?? (value as { lng?: unknown }).lng
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

function solarDate(value: unknown): string | null {
  const d = value as { year?: number; month?: number; day?: number } | null
  if (!d || typeof d.year !== 'number') return null
  const mm = String(d.month ?? 1).padStart(2, '0')
  const dd = String(d.day ?? 1).padStart(2, '0')
  return `${d.year}-${mm}-${dd}`
}

async function fetchGoogleSolarBuildingInsights(
  lat: number,
  lng: number,
  apiKey: string
): Promise<SolarBuildingInsights> {
  const url =
    `https://solar.googleapis.com/v1/buildingInsights:findClosest` +
    `?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${apiKey}`

  const empty: SolarBuildingInsights = { anchor: null, segments: [], imageryDate: null, imageryQuality: null }
  const response = await fetch(url)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.warn('[public-estimate] buildingInsights failed:', response.status, detail?.slice(0, 200))
    return empty
  }

  const data = await response.json().catch(() => null)
  if (!data) return empty
  const roofSegments = Array.isArray(data?.solarPotential?.roofSegmentStats)
    ? data.solarPotential.roofSegmentStats
    : []

  const segments: SolarMaskSegment[] = roofSegments.map((segment: any, index: number) => ({
    segment_index: index,
    pitch_degrees: typeof segment.pitchDegrees === 'number' ? segment.pitchDegrees : null,
    azimuth_degrees: typeof segment.azimuthDegrees === 'number' ? segment.azimuthDegrees : null,
    area_m2: typeof segment?.stats?.areaMeters2 === 'number' ? segment.stats.areaMeters2 : null,
    ground_area_m2:
      typeof segment?.stats?.groundAreaMeters2 === 'number' ? segment.stats.groundAreaMeters2 : null,
    plane_height_at_center_meters:
      typeof segment?.planeHeightAtCenterMeters === 'number' ? segment.planeHeightAtCenterMeters : null,
    center: extractLatLng(segment.center),
    bounding_box:
      segment?.boundingBox?.sw &&
      segment?.boundingBox?.ne &&
      extractLatLng(segment.boundingBox.sw) &&
      extractLatLng(segment.boundingBox.ne)
        ? {
            sw: extractLatLng(segment.boundingBox.sw) as { lat: number; lng: number },
            ne: extractLatLng(segment.boundingBox.ne) as { lat: number; lng: number },
          }
        : null,
  }))

  return {
    anchor: extractLatLng(data?.center),
    segments,
    imageryDate: solarDate(data?.imageryDate),
    imageryQuality: typeof data?.imageryQuality === 'string' ? data.imageryQuality : null,
  }
}

type SquaresBundle = { baseSquares: number; facetCount: number; avgPitchMultiplier: number; lowSlopeSqft: number }

function squaresFromMaskFacets(
  facets: Array<{
    lat_lng_vertices: { lat: number; lng: number }[]
    suggested_pitch_degrees: number | null
    suggested_ground_area_sqft: number | null
  }>
): SquaresBundle | null {
  if (!facets.length) return null
  let totalSloped = 0
  let pitchSum = 0
  let pitchWeight = 0
  let lowSlopeSqft = 0
  for (const facet of facets) {
    const polygonArea =
      facet.lat_lng_vertices?.length >= 3 ? approximatePlanarPolygonAreaSqft(facet.lat_lng_vertices) : 0
    const flat =
      polygonArea > 0
        ? polygonArea
        : typeof facet.suggested_ground_area_sqft === 'number' && facet.suggested_ground_area_sqft > 0
          ? facet.suggested_ground_area_sqft
          : 0
    if (flat <= 0) continue
    const mult = pitchMultiplierFromDegrees(facet.suggested_pitch_degrees)
    totalSloped += flat * mult
    pitchSum += mult * flat
    pitchWeight += flat
    if (facet.suggested_pitch_degrees != null && facet.suggested_pitch_degrees < LOW_SLOPE_DEGREES) lowSlopeSqft += flat
  }
  if (totalSloped <= 0) return null
  return {
    baseSquares: totalSloped / 100,
    facetCount: facets.length,
    avgPitchMultiplier: pitchWeight > 0 ? pitchSum / pitchWeight : pitchMultiplierFromRise(PUBLIC_ESTIMATE_DEFAULT_PITCH_RISE),
    lowSlopeSqft,
  }
}

function squaresFromSolarSegments(segments: SolarMaskSegment[]): SquaresBundle | null {
  if (!segments.length) return null
  let totalSloped = 0
  let pitchSum = 0
  let pitchWeight = 0
  let lowSlopeSqft = 0
  for (const seg of segments) {
    const hasGround = seg.ground_area_m2 != null && seg.ground_area_m2 > 0
    const groundSqft = hasGround
      ? squareMetersToSquareFeet(seg.ground_area_m2 as number)
      : seg.area_m2 != null && seg.area_m2 > 0
        ? squareMetersToSquareFeet(seg.area_m2)
        : 0
    if (groundSqft <= 0) continue
    const mult = pitchMultiplierFromDegrees(seg.pitch_degrees)
    // Prefer Solar ground footprint × pitch (same rule as internal tool: don't trust Solar sloped alone).
    totalSloped += hasGround ? groundSqft * mult : groundSqft
    pitchSum += mult * groundSqft
    pitchWeight += groundSqft
    if (seg.pitch_degrees != null && seg.pitch_degrees < LOW_SLOPE_DEGREES) lowSlopeSqft += groundSqft
  }
  if (totalSloped <= 0) return null
  return {
    baseSquares: totalSloped / 100,
    facetCount: Math.max(1, segments.length),
    avgPitchMultiplier: pitchWeight > 0 ? pitchSum / pitchWeight : pitchMultiplierFromRise(PUBLIC_ESTIMATE_DEFAULT_PITCH_RISE),
    lowSlopeSqft,
  }
}

function solarGroundSqft(segments: SolarMaskSegment[]): number {
  return segments.reduce((sum, seg) => sum + (seg.ground_area_m2 && seg.ground_area_m2 > 0 ? squareMetersToSquareFeet(seg.ground_area_m2) : 0), 0)
}

function yearsBetween(isoA: string, isoB: string): number {
  return (new Date(isoB).getTime() - new Date(isoA).getTime()) / (365.25 * 86_400_000)
}

/** Lidar gets this long; past it the estimate falls back to Solar so the 60 s route never times out. */
const LIDAR_TIMEOUT_MS = 15_000

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Imagery more than this far from the geocoded point is probably a different building. */
const MAX_BUILDING_OFFSET_FT = 100

export type MeasurePublicRoofEstimateOptions = {
  /** Accuracy checks: skip the satellite still (cost/time). */
  shadow?: boolean
  /** Use known coordinates instead of geocoding the address text. */
  lat?: number
  lng?: number
  orgId?: string
}

/**
 * Address → main building's roof → squares + sold waste → pricebook $/sq → range by confidence.
 * Lidar (in-house, ~5% vs carrier) first; Google Solar as the fallback.
 * Never returns facet polygons to the caller — only numbers + optional satellite still.
 */
export async function measurePublicRoofEstimate(
  addressInput: string,
  opts: MeasurePublicRoofEstimateOptions = {}
): Promise<
  | { ok: true; result: PublicRoofMeasureResult }
  | { ok: false; reason: 'missing_address' | 'geocode_failed' | 'missing_api_key' | 'measure_failed' }
> {
  const address = addressInput.trim()
  if (!address) return { ok: false, reason: 'missing_address' }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!apiKey) return { ok: false, reason: 'missing_api_key' }

  const known = Number.isFinite(opts.lat) && Number.isFinite(opts.lng)
  const coords: GeocodeResult | null = known
    ? { lat: opts.lat as number, lng: opts.lng as number, formatted_address: address, location_type: 'KNOWN' }
    : await geocodeAddressDetailed(address)
  if (!coords) return { ok: false, reason: 'geocode_failed' }
  const normalizedAddress = coords.formatted_address

  try {
    const flags: string[] = []
    const admin = createServiceClient()
    let orgId: string | null = opts.orgId ?? null
    if (!orgId) {
      try { orgId = getPublicEstimateOrgId() } catch { orgId = null }
    }

    // Geocodes that aren't a rooftop hit can land on the street or the wrong lot.
    if (coords.location_type && coords.location_type !== 'ROOFTOP' && coords.location_type !== 'KNOWN') {
      flags.push(`geocode_${coords.location_type.toLowerCase()}`)
    }

    const [solar, pricePerSquare, calibration] = await Promise.all([
      fetchGoogleSolarBuildingInsights(coords.lat, coords.lng, apiKey),
      orgId ? resolvePublicEstimatePricePerSquare(admin, orgId) : Promise.resolve(getPublicEstimatePricePerSquare()),
      orgId ? loadInstantEstimateCalibration(admin, orgId) : Promise.resolve({}),
    ])
    const queryLat = solar.anchor?.lat ?? coords.lat
    const queryLng = solar.anchor?.lng ?? coords.lng

    const today = new Date().toISOString().slice(0, 10)
    const imageryOld =
      solar.imageryDate != null && yearsBetween(solar.imageryDate, today) > PUBLIC_ESTIMATE_MAX_IMAGERY_AGE_YEARS
    if (imageryOld) flags.push('imagery_old')
    if (solar.anchor && haversineDistanceFeet(coords, solar.anchor) > MAX_BUILDING_OFFSET_FT) {
      flags.push('building_far_from_address')
    }

    let measured: (SquaresBundle & { hipValleyLf: number | null }) | null = null
    let measure_source = 'none'
    let confidence: PublicEstimateConfidence = 'standard'
    let other_structures: NearbyStructure[] = []
    let lidar_collected_end: string | null = null
    let measureDiagnostics: Pick<
      PublicRoofMeasureResult,
      'mask_base_squares' | 'segments_base_squares' | 'split_quality_mode' | 'measure_select_reason'
    > = {}
    let force_manual_reconcile = false

    // ── 1. In-house lidar (main building only; detached structures flagged, not added) ──
    if (ROOF_MEASURE_LIDAR_ENABLED) {
      try {
        const geocodeApproximate = flags.some((f) => f.startsWith('geocode_'))
        const lidar = await withTimeout(
          measureLidarRoofNear(admin, { lat: coords.lat, lng: coords.lng }, solar.anchor, {
            anchorFirst: geocodeApproximate,
          }),
          LIDAR_TIMEOUT_MS
        )
        if (lidar && lidar.status === 'ok' && lidar.roof.totals.squares > 0) {
          const t = lidar.roof.totals
          const solarGround = solarGroundSqft(solar.segments)
          // Is Google's building the same one lidar measured? (within ~20 m of the lidar pin)
          const solarSameBuilding =
            solar.anchor != null && haversineDistanceFeet(solar.anchor, lidar.pin) / 3.28084 <= 20
          // Lidar landed on something much smaller than Google's building at this address
          // (a garage, a neighbour's shed) → don't trust it; let Solar measure the house.
          const lidarTooSmall = solarSameBuilding && solarGround > 0 && t.flatSqft < solarGround * 0.6
          if (lidarTooSmall) {
            flags.push('lidar_solar_mismatch')
          } else {
            let baseSquares = t.squares
            lidar_collected_end = lidar.collectedEnd
            other_structures = lidar.otherStructures
            if (other_structures.length) flags.push('possible_detached_structure')
            // Survey is 2016–17. If newer Solar imagery of the SAME building sees clearly more
            // footprint, assume an addition since the survey: scale up, standard confidence.
            const newerImagery =
              solar.imageryDate != null && lidar.collectedEnd != null && solar.imageryDate > lidar.collectedEnd
            if (
              solarSameBuilding &&
              newerImagery &&
              t.flatSqft > 0 &&
              solarGround > t.flatSqft * 1.15 &&
              solarGround - t.flatSqft > 150
            ) {
              baseSquares = baseSquares * (solarGround / t.flatSqft)
              flags.push('possible_addition_since_lidar_survey')
              confidence = 'standard'
            } else {
              // An approximate address pin that Google couldn't confirm stays at standard.
              confidence = geocodeApproximate && !solarSameBuilding ? 'standard' : 'high'
            }
            measured = {
              baseSquares,
              facetCount: lidar.roof.planes.length,
              avgPitchMultiplier: t.flatSqft > 0 ? (t.squares * 100) / t.flatSqft : 1,
              lowSlopeSqft: lidar.roof.planes
                .filter((p) => p.pitchDegrees < LOW_SLOPE_DEGREES)
                .reduce((s, p) => s + p.flatAreaM2 * 10.7639, 0),
              hipValleyLf: t.hipLf + t.valleyLf,
            }
            measure_source = 'lidar'
          }
        } else if (lidar == null) {
          console.warn('[public-estimate] lidar timed out; using Solar')
        }
      } catch (lidarError) {
        console.warn('[public-estimate] lidar failed; using Solar', lidarError)
      }
    }

    // ── 2. Google Solar fallback (unchanged reconcile rules) ──
    if (!measured && solar.segments.length > 0) {
      const segmentSquares = squaresFromSolarSegments(solar.segments)
      const maskAttempt: SolarMaskAttemptResult = await tryFacetPayloadsFromSolarRoofMask({
        lat: queryLat,
        lng: queryLng,
        apiKey,
        referenceLat: coords.lat,
        referenceLng: coords.lng,
        segments: solar.segments,
        buildingCenter: solar.anchor,
        querySource: 'public_estimate',
      })
      const maskSquares = maskAttempt.facets?.length ? squaresFromMaskFacets(maskAttempt.facets) : null
      const selection = selectPublicEstimateMeasure({
        maskAttempt,
        maskSquares,
        segmentSquares,
        segmentCount: solar.segments.length,
      })
      if (selection) {
        measured = { ...(selection.chosen as SquaresBundle), hipValleyLf: null }
        measure_source = selection.measure_source
        force_manual_reconcile = selection.force_manual_reconcile
        measureDiagnostics = {
          mask_base_squares: selection.mask_base_squares,
          segments_base_squares: selection.segments_base_squares,
          split_quality_mode: selection.split_quality_mode,
          measure_select_reason: selection.measure_select_reason,
        }
      } else if (segmentSquares) {
        measured = { ...segmentSquares, hipValleyLf: null }
        measure_source = 'solar_segments'
      }
    }

    let satellite_image_base64: string | null = null
    if (!opts.shadow) {
      try {
        satellite_image_base64 = await fetchStaticSatelliteMapBase64({
          lat: coords.lat,
          lng: coords.lng,
          zoom: PUBLIC_ESTIMATE_SATELLITE_ZOOM,
          sizeW: PUBLIC_ESTIMATE_SATELLITE_SIZE,
          sizeH: PUBLIC_ESTIMATE_SATELLITE_SIZE,
        })
      } catch (err) {
        console.warn('[public-estimate] static satellite failed:', err)
      }
    }

    const base = {
      address: normalizedAddress,
      lat: coords.lat,
      lng: coords.lng,
      other_structures,
      imagery_date: solar.imageryDate,
      lidar_collected_end,
      estimate_version: INSTANT_ESTIMATE_VERSION,
      satellite_image_base64,
    }

    if (!measured || measured.baseSquares <= 0) {
      return {
        ok: true,
        result: {
          ...base,
          squares_mid: 0,
          squares_low: 0,
          squares_high: 0,
          base_squares: 0,
          waste_percent: 0,
          facet_count: 0,
          measure_source: 'none',
          confidence: 'low',
          flags: [...flags, 'no_roof_data'],
          calibration_factor: 1,
          price_per_square: pricePerSquare,
          price_mid: 0,
          price_low: 0,
          price_high: 0,
          requires_manual_measure: true,
        },
      }
    }

    if (measured.lowSlopeSqft >= 100) flags.push('low_slope_section')

    // Self-calibration from real jobs (lib/instant-estimate-accuracy.ts); 1 until ≥8 checks.
    const calibration_factor = calibrationFactorFor(calibration, measure_source)
    const baseSquares = measured.baseSquares * calibration_factor
    const waste_percent = getPublicEstimateSoldWastePercent({
      facetCount: measured.facetCount,
      hipValleyLf: measured.hipValleyLf,
    })
    const squaresWithWaste = baseSquares * (1 + waste_percent / 100)

    // Lidar handles complex roofs, so the Solar-era "≥7 facets → manual" rule only applies to Solar.
    const requires_manual_measure =
      measure_source === 'lidar'
        ? false
        : isPublicEstimateManualMeasureRequired({
            measure_source,
            facet_count: measured.facetCount,
            force_manual_reconcile,
          })
    // Stale imagery / a building far from the address only undermine the Solar path; lidar
    // measured the building under the geocoded point directly.
    const solarDoubts = measure_source !== 'lidar' && (imageryOld || flags.includes('building_far_from_address'))
    if (requires_manual_measure || solarDoubts) confidence = 'low'

    const { confidence: pricedConfidence } = resolvePublicEstimatePricingPath({
      requires_manual_measure,
      squares_mid: squaresWithWaste,
      facet_count: measured.facetCount,
      price_per_square: pricePerSquare,
      confidence,
    })
    const pricing = computePublicEstimatePricing(squaresWithWaste, pricePerSquare, pricedConfidence)

    return {
      ok: true,
      result: {
        ...base,
        ...pricing,
        base_squares: Math.round(baseSquares * 100) / 100,
        waste_percent,
        facet_count: measured.facetCount,
        measure_source,
        confidence: pricedConfidence,
        flags,
        calibration_factor,
        requires_manual_measure,
        ...measureDiagnostics,
      },
    }
  } catch (err) {
    console.error('[public-estimate] measure failed:', err)
    return { ok: false, reason: 'measure_failed' }
  }
}

export function newPublicEstimateJti(): string {
  return randomUUID()
}
