/**
 * Roof-age overlay: county parcel year-built rendered as small colored markers
 * on the canvass map. The one signal storm data can't give a rep — which houses
 * are old enough to be worth knocking even without a fresh swath overhead.
 *
 * Age here is YEARS SINCE CONSTRUCTION (an estimate of original-roof age), not a
 * verified roof age — a house may have been re-roofed since. Copy always says "est."
 */

export type RoofAgeFeature = {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] } | null
  properties: {
    yearBuilt?: number
    roofAge?: number
  }
}

/** Why a successful fetch returned zero knock-worthy markers. */
export type RoofAgeEmptyReason = 'county_gaps' | 'all_too_new' | 'no_parcels'

export type RoofAgeFeatureCollection = {
  type: 'FeatureCollection'
  features: RoofAgeFeature[]
  degraded?: boolean
  /** Set when features is empty and the provider responded normally. */
  emptyReason?: RoofAgeEmptyReason
  /** County name from NC OneMap when emptyReason is county_gaps. */
  county?: string
}

/** Parcels only render at street zoom — a whole-town pull would be thousands of dots. */
export const MIN_ROOF_AGE_ZOOM = 16

/** Homes younger than this never render — not knock-worthy on age alone. */
export const MIN_ROOF_AGE_YEARS = 10

type RoofAgeBucket = { fill: string; label: string; minYears: number }

/**
 * Same warm luminance-ordered ramp family as the hail swaths, so "darker = worse"
 * (here: older) holds across every canvass layer and survives colorblindness and
 * sunlit screens.
 */
export const ROOF_AGE_LEGEND: RoofAgeBucket[] = [
  { minYears: 20, fill: '#B91C1C', label: '20+ yrs (est.)' },
  { minYears: 15, fill: '#EA580C', label: '15–19 yrs (est.)' },
  { minYears: MIN_ROOF_AGE_YEARS, fill: '#F59E0B', label: '10–14 yrs (est.)' },
]

export function roofAgeBucket(age: number): RoofAgeBucket | null {
  for (const bucket of ROOF_AGE_LEGEND) {
    if (age >= bucket.minYears) return bucket
  }
  return null
}

/**
 * Ground radius for roof-age markers — google.maps.Circle overlays (same fix as
 * storm-report dots in weather-overlay.ts). Data-layer SVG point symbols fail
 * to paint on iOS Safari (field-verified Jul 2026).
 */
export function roofAgeMarkerRadiusMeters(age: number): number {
  return age >= 20 ? 55 : 48
}

/** White stroke ring for contrast on satellite imagery (matches storm dots). */
export const ROOF_AGE_MARKER_STROKE = {
  strokeColor: '#FFFFFF',
  strokeOpacity: 1,
  strokeWeight: 3,
} as const

/** Above swaths/warnings (1), below storm-report dots (3) and canvass pins. */
export const ROOF_AGE_MARKER_Z_INDEX = 2

const ROOF_AGE_STORAGE_KEY = 'canvass-roof-age-on'

export function readStoredRoofAgeOn(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(ROOF_AGE_STORAGE_KEY) === 'true'
}

export function storeRoofAgeOn(on: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ROOF_AGE_STORAGE_KEY, on ? 'true' : 'false')
  } catch {
    // private-mode Safari can throw on setItem — selection just won't persist
  }
}
