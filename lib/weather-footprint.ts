/** Cabarrus County NC + adjacent canvass ZIPs — superset footprint for cache pre-warm. */
export type WeatherBbox = { n: number; s: number; e: number; w: number }

/** Verified superset bbox enclosing WEATHER_REFRESH_ZIPS from refresh-job spec. */
export const DEFAULT_WEATHER_FOOTPRINT: WeatherBbox = {
  n: 35.58,
  s: 35.12,
  e: -80.32,
  w: -80.82,
}

export const DEFAULT_WEATHER_WINDOW_DAYS = 730

export const MAX_WEATHER_BBOX_SPAN_DEGREES = 5

export function footprintFromEnv(): WeatherBbox {
  const n = Number(process.env.WEATHER_FOOTPRINT_N)
  const s = Number(process.env.WEATHER_FOOTPRINT_S)
  const e = Number(process.env.WEATHER_FOOTPRINT_E)
  const w = Number(process.env.WEATHER_FOOTPRINT_W)
  if ([n, s, e, w].every(Number.isFinite) && n > s && e > w) {
    return { n, s, e, w }
  }
  return DEFAULT_WEATHER_FOOTPRINT
}

export function clampWindowDays(value: number | string | null | undefined) {
  const parsed = Number(value ?? DEFAULT_WEATHER_WINDOW_DAYS)
  if (!Number.isFinite(parsed)) return DEFAULT_WEATHER_WINDOW_DAYS
  return Math.min(DEFAULT_WEATHER_WINDOW_DAYS, Math.max(1, Math.round(parsed)))
}

export function bboxesOverlap(a: WeatherBbox, b: WeatherBbox) {
  return a.n >= b.s && a.s <= b.n && a.e >= b.w && a.w <= b.e
}

export function clampQueryBbox(bbox: WeatherBbox): WeatherBbox | null {
  if (![bbox.n, bbox.s, bbox.e, bbox.w].every(Number.isFinite)) return null
  if (bbox.n <= bbox.s || bbox.e <= bbox.w) return null
  if (bbox.n > 90 || bbox.s < -90 || bbox.e > 180 || bbox.w < -180) return null
  const latSpan = bbox.n - bbox.s
  const lngSpan = bbox.e - bbox.w
  if (latSpan > MAX_WEATHER_BBOX_SPAN_DEGREES || lngSpan > MAX_WEATHER_BBOX_SPAN_DEGREES) {
    return null
  }
  return bbox
}

export function weatherOverlayFeatureEnabled() {
  return process.env.NEXT_PUBLIC_CANVASS_WEATHER_OVERLAY === 'true'
}
