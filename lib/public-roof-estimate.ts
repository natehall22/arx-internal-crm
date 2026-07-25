import { randomUUID } from 'crypto'
import {
  PUBLIC_ESTIMATE_DEFAULT_PITCH_RISE,
  PUBLIC_ESTIMATE_SATELLITE_SIZE,
  PUBLIC_ESTIMATE_SATELLITE_ZOOM,
  getPublicEstimatePricePerSquare,
} from '@/lib/public-estimate-config'
import {
  resolvePublicEstimatePricingPath,
  computePublicEstimatePricing,
} from '@/lib/public-estimate-pricing'
import { isPublicEstimateManualMeasureRequired } from '@/lib/public-estimate-manual-measure'
import {
  approximatePlanarPolygonAreaSqft,
  pitchMultiplierFromRise,
  slopedAreaSqft,
  squareMetersToSquareFeet,
} from '@/lib/roof-measure-geometry'
import { pitchRiseFromDegrees } from '@/lib/roof-face-solar-alignment'
import { calculateRoofWaste } from '@/lib/roof-waste-model'
import { selectPublicEstimateMeasure } from '@/lib/public-estimate-measure-select'
import {
  tryFacetPayloadsFromSolarRoofMask,
  type SolarMaskAttemptResult,
  type SolarMaskSegment,
} from '@/lib/solar-roof-mask-facets'
import { fetchStaticSatelliteMapBase64 } from '@/lib/static-satellite-map'

export { isPublicEstimateManualMeasureRequired } from '@/lib/public-estimate-manual-measure'

async function geocodeAddressDetailed(
  address: string
): Promise<{ lat: number; lng: number; formatted_address: string } | null> {
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
        geometry?: { location?: { lat?: number; lng?: number } }
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
    }
  } catch {
    return null
  }
}

export type PublicRoofMeasureResult = {
  address: string
  lat: number
  lng: number
  squares_mid: number
  squares_low: number
  squares_high: number
  waste_percent: number
  facet_count: number
  measure_source: string
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

async function fetchGoogleSolarBuildingInsights(
  lat: number,
  lng: number,
  apiKey: string
): Promise<SolarBuildingInsights> {
  const url =
    `https://solar.googleapis.com/v1/buildingInsights:findClosest` +
    `?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${apiKey}`

  const response = await fetch(url)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.warn('[public-estimate] buildingInsights failed:', response.status, detail?.slice(0, 200))
    return { anchor: null, segments: [] }
  }

  const data = await response.json().catch(() => null)
  const buildingCenter = extractLatLng(data?.center)
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

  return { anchor: buildingCenter, segments }
}

function squaresFromMaskFacets(
  facets: Array<{
    lat_lng_vertices: { lat: number; lng: number }[]
    suggested_pitch_degrees: number | null
    suggested_ground_area_sqft: number | null
  }>
): { baseSquares: number; facetCount: number; avgPitchMultiplier: number } | null {
  if (!facets.length) return null
  let totalSloped = 0
  let pitchSum = 0
  let pitchWeight = 0
  for (const facet of facets) {
    const polygonArea =
      facet.lat_lng_vertices?.length >= 3
        ? approximatePlanarPolygonAreaSqft(facet.lat_lng_vertices)
        : 0
    const flat =
      polygonArea > 0
        ? polygonArea
        : typeof facet.suggested_ground_area_sqft === 'number' && facet.suggested_ground_area_sqft > 0
          ? facet.suggested_ground_area_sqft
          : 0
    if (flat <= 0) continue
    const rise =
      pitchRiseFromDegrees(facet.suggested_pitch_degrees) || PUBLIC_ESTIMATE_DEFAULT_PITCH_RISE
    const sloped = slopedAreaSqft({ flat_area_sqft: flat, pitch_rise: rise })
    totalSloped += sloped
    pitchSum += pitchMultiplierFromRise(rise) * flat
    pitchWeight += flat
  }
  if (totalSloped <= 0) return null
  return {
    baseSquares: totalSloped / 100,
    facetCount: facets.length,
    avgPitchMultiplier: pitchWeight > 0 ? pitchSum / pitchWeight : pitchMultiplierFromRise(PUBLIC_ESTIMATE_DEFAULT_PITCH_RISE),
  }
}

function squaresFromSolarSegments(segments: SolarMaskSegment[]): {
  baseSquares: number
  facetCount: number
  avgPitchMultiplier: number
} | null {
  if (!segments.length) return null
  let totalSloped = 0
  let pitchSum = 0
  let pitchWeight = 0
  for (const seg of segments) {
    const groundSqft =
      seg.ground_area_m2 != null && seg.ground_area_m2 > 0
        ? squareMetersToSquareFeet(seg.ground_area_m2)
        : seg.area_m2 != null && seg.area_m2 > 0
          ? squareMetersToSquareFeet(seg.area_m2)
          : 0
    if (groundSqft <= 0) continue
    const rise = pitchRiseFromDegrees(seg.pitch_degrees) || PUBLIC_ESTIMATE_DEFAULT_PITCH_RISE
    // Prefer Solar ground footprint × pitch (same rule as internal tool: don't trust Solar sloped alone).
    const sloped =
      seg.ground_area_m2 != null && seg.ground_area_m2 > 0
        ? slopedAreaSqft({ flat_area_sqft: groundSqft, pitch_rise: rise })
        : groundSqft
    totalSloped += sloped
    pitchSum += pitchMultiplierFromRise(rise) * groundSqft
    pitchWeight += groundSqft
  }
  if (totalSloped <= 0) return null
  return {
    baseSquares: totalSloped / 100,
    facetCount: Math.max(1, segments.length),
    avgPitchMultiplier:
      pitchWeight > 0 ? pitchSum / pitchWeight : pitchMultiplierFromRise(PUBLIC_ESTIMATE_DEFAULT_PITCH_RISE),
  }
}

/**
 * Geocode → Solar (server-side) → squares + waste → $413/sq (reliable), $530/$550 fallback, or silent manual.
 * Never returns facet polygons to the caller — only numbers + optional satellite still.
 */
export async function measurePublicRoofEstimate(addressInput: string): Promise<
  | { ok: true; result: PublicRoofMeasureResult }
  | {
      ok: false
      reason:
        | 'missing_address'
        | 'geocode_failed'
        | 'missing_api_key'
        | 'measure_failed'
    }
> {
  const address = addressInput.trim()
  if (!address) return { ok: false, reason: 'missing_address' }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!apiKey) return { ok: false, reason: 'missing_api_key' }

  const coords = await geocodeAddressDetailed(address)
  if (!coords) return { ok: false, reason: 'geocode_failed' }
  const normalizedAddress = coords.formatted_address

  try {
    const solar = await fetchGoogleSolarBuildingInsights(coords.lat, coords.lng, apiKey)
    const queryLat = solar.anchor?.lat ?? coords.lat
    const queryLng = solar.anchor?.lng ?? coords.lng

    let measured: {
      baseSquares: number
      facetCount: number
      avgPitchMultiplier: number
    } | null = null
    let measure_source = 'none'
    let measureDiagnostics: Pick<
      PublicRoofMeasureResult,
      'mask_base_squares' | 'segments_base_squares' | 'split_quality_mode' | 'measure_select_reason'
    > = {}
    let force_manual_reconcile = false

    const segmentSquares = solar.segments.length > 0 ? squaresFromSolarSegments(solar.segments) : null
    let maskAttempt: SolarMaskAttemptResult | null = null

    if (solar.segments.length > 0) {
      maskAttempt = await tryFacetPayloadsFromSolarRoofMask({
        lat: queryLat,
        lng: queryLng,
        apiKey,
        referenceLat: coords.lat,
        referenceLng: coords.lng,
        segments: solar.segments,
        buildingCenter: solar.anchor,
        querySource: 'public_estimate',
      })

      const maskSquares = maskAttempt.facets?.length
        ? squaresFromMaskFacets(maskAttempt.facets)
        : null

      const selection = selectPublicEstimateMeasure({
        maskAttempt,
        maskSquares,
        segmentSquares,
        segmentCount: solar.segments.length,
      })

      if (selection) {
        measured = selection.chosen
        measure_source = selection.measure_source
        force_manual_reconcile = selection.force_manual_reconcile
        measureDiagnostics = {
          mask_base_squares: selection.mask_base_squares,
          segments_base_squares: selection.segments_base_squares,
          split_quality_mode: selection.split_quality_mode,
          measure_select_reason: selection.measure_select_reason,
        }
      }
    }

    if (!measured && segmentSquares) {
      measured = segmentSquares
      measure_source = 'solar_segments'
    }

    let satellite_image_base64: string | null = null
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

    if (!measured || measured.baseSquares <= 0) {
      const pricePerSquare = getPublicEstimatePricePerSquare()
      return {
        ok: true,
        result: {
          address: normalizedAddress,
          lat: coords.lat,
          lng: coords.lng,
          squares_mid: 0,
          squares_low: 0,
          squares_high: 0,
          waste_percent: 0,
          facet_count: 0,
          measure_source: 'none',
          price_per_square: pricePerSquare,
          price_mid: 0,
          price_low: 0,
          price_high: 0,
          satellite_image_base64,
          requires_manual_measure: true,
        },
      }
    }

    const waste = calculateRoofWaste({
      baseSquares: measured.baseSquares,
      facetCount: measured.facetCount,
      valleys_lf: 0,
      hips_lf: 0,
      ridges_lf: 0,
      avgPitchMultiplier: measured.avgPitchMultiplier,
    })

    const squaresWithWaste = measured.baseSquares + waste.wasteSquares
    const requires_manual_measure = isPublicEstimateManualMeasureRequired({
      measure_source,
      facet_count: measured.facetCount,
      force_manual_reconcile,
    })
    const { pricePerSquare } = resolvePublicEstimatePricingPath({
      requires_manual_measure,
      squares_mid: squaresWithWaste,
      facet_count: measured.facetCount,
    })
    const pricing = computePublicEstimatePricing(squaresWithWaste, pricePerSquare)

    return {
      ok: true,
      result: {
        address: normalizedAddress,
        lat: coords.lat,
        lng: coords.lng,
        ...pricing,
        waste_percent: waste.wastePercent,
        facet_count: measured.facetCount,
        measure_source,
        satellite_image_base64,
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
