export type WeatherLayer = 'off' | 'hail' | 'wind'

export type WeatherFeatureCollection = {
  type: 'FeatureCollection'
  features: WeatherFeature[]
  refreshedAt?: string
  degraded?: boolean
}

export type WeatherFeature = {
  type: 'Feature'
  geometry: GeoJSON.Geometry | null
  properties: {
    kind?: 'report' | 'warning' | 'swath'
    layer?: WeatherLayer
    magnitude?: number
    damage?: boolean
    date?: string
    event?: string
    source?: string
    expires?: string
  }
}

export type WeatherContext = {
  layer: Exclude<WeatherLayer, 'off'>
  features: WeatherFeature[]
  refreshedAt: string | null
  offline: boolean
}

const WEATHER_LAYER_STORAGE_KEY = 'canvass-weather-layer'

export function readStoredWeatherLayer(): Exclude<WeatherLayer, 'off'> {
  if (typeof window === 'undefined') return 'hail'
  const stored = window.localStorage.getItem(WEATHER_LAYER_STORAGE_KEY)
  return stored === 'wind' ? 'wind' : 'hail'
}

export function storeWeatherLayer(layer: Exclude<WeatherLayer, 'off'>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(WEATHER_LAYER_STORAGE_KEY, layer)
  } catch {
    // private-mode Safari can throw on setItem — selection just won't persist
  }
}

/**
 * Time-window quick filter. 730d is the product hard cap (insurance claim scope —
 * clamped again server-side in clampWindowDays). 30d isolates "the storm that just
 * hit" for knock strategizing; 6mo covers a season.
 */
export const WEATHER_WINDOW_OPTIONS = [
  { days: 30, label: '30d', title: 'Last 30 days' },
  { days: 183, label: '6mo', title: 'Last 6 months' },
  { days: 730, label: '2yr', title: 'Last 2 years' },
] as const

export type WeatherWindowDays = (typeof WEATHER_WINDOW_OPTIONS)[number]['days']

export const DEFAULT_WEATHER_WINDOW_DAYS: WeatherWindowDays = 730

const WEATHER_WINDOW_STORAGE_KEY = 'canvass-weather-window-days'

export function readStoredWeatherWindowDays(): WeatherWindowDays {
  if (typeof window === 'undefined') return DEFAULT_WEATHER_WINDOW_DAYS
  try {
    const stored = Number(window.localStorage.getItem(WEATHER_WINDOW_STORAGE_KEY))
    const match = WEATHER_WINDOW_OPTIONS.find((option) => option.days === stored)
    return match ? match.days : DEFAULT_WEATHER_WINDOW_DAYS
  } catch {
    return DEFAULT_WEATHER_WINDOW_DAYS
  }
}

export function storeWeatherWindowDays(days: WeatherWindowDays) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(WEATHER_WINDOW_STORAGE_KEY, String(days))
  } catch {
    // private-mode Safari can throw on setItem — selection just won't persist
  }
}

export function weatherWindowLabel(days: number): string {
  return WEATHER_WINDOW_OPTIONS.find((option) => option.days === days)?.label ?? `${days}d`
}

/** Hard cap used for the "wider window" probe when the selected window is empty. */
export const WEATHER_WIDER_PROBE_DAYS = DEFAULT_WEATHER_WINDOW_DAYS

/**
 * Claims-safe strip copy when the viewport is clear in the rep's window but recorded
 * storms exist at the 2yr cap — nudges them to widen without implying damage.
 */
export function widerWindowHintText(
  currentDays: number,
  widerDays: number,
  layer: Exclude<WeatherLayer, 'off'>,
): string {
  const currentLabel = weatherWindowLabel(currentDays)
  const widerLabel = weatherWindowLabel(widerDays)
  const layerWord = layer === 'hail' ? 'hail' : 'wind'
  return `No recorded ${layerWord} in last ${currentLabel} — history on ${widerLabel} (tap to switch)`
}

type StyleBucket = {
  fill: string
  fillOpacity: number
  stroke: string
  strokeOpacity: number
  strokeWeight: number
  dashed?: boolean
}

function hailBucket(magnitude: number): StyleBucket {
  // Sequential warm "heat" ramp: light amber (low) → dark crimson/violet (extreme).
  // Order is carried by LUMINANCE, so it survives deuteranopia/protanopia and a
  // sunlit screen even when hue discrimination fails. Warm hues sit far from the
  // green/blue of satellite imagery so swaths stay visible over rooftops & grass.
  // Stroke weight escalates with severity as a second, colorblind-proof channel.
  // Strokes are HEAVY (3px+) on purpose: MESH swath cells are ~1km, so at field
  // zoom (16–18) the boundary line is often the ONLY perceivable part of the
  // polygon — the fill covers the whole screen as a uniform tint. A hairline
  // stroke made swaths read as "transparent" on phones (field-verified Jul 2026).
  if (magnitude >= 2.5) {
    // tennis ball+ — darkest, heaviest edge: the "go here first" band
    return { fill: '#7F1D6F', fillOpacity: 0.52, stroke: '#4A0E40', strokeOpacity: 1, strokeWeight: 4 }
  }
  if (magnitude >= 1.75) {
    // golf ball+ — deep red
    return { fill: '#B91C1C', fillOpacity: 0.52, stroke: '#7F1D1D', strokeOpacity: 1, strokeWeight: 3.75 }
  }
  if (magnitude >= 1.25) {
    // half-dollar → golf ball — orange-red
    return { fill: '#EA580C', fillOpacity: 0.5, stroke: '#9A3412', strokeOpacity: 0.95, strokeWeight: 3.5 }
  }
  if (magnitude >= 1.0) {
    // quarter → half-dollar — orange (the ~1" functional-damage line)
    return { fill: '#F59E0B', fillOpacity: 0.48, stroke: '#B45309', strokeOpacity: 0.95, strokeWeight: 3.25 }
  }
  // penny → quarter — amber-yellow, kept warm so it doesn't read as foliage
  return { fill: '#FACC15', fillOpacity: 0.48, stroke: '#A16207', strokeOpacity: 1, strokeWeight: 3.5 }
}

function windBucket(magnitude: number): StyleBucket {
  if (magnitude >= 70) {
    return { fill: '#B91C1C', fillOpacity: 0.38, stroke: '#7F1D1D', strokeOpacity: 0.9, strokeWeight: 2, dashed: true }
  }
  if (magnitude >= 58) {
    return { fill: '#F97316', fillOpacity: 0.38, stroke: '#C2410C', strokeOpacity: 0.85, strokeWeight: 1.75 }
  }
  return { fill: '#F59E0B', fillOpacity: 0.35, stroke: '#B45309', strokeOpacity: 0.85, strokeWeight: 1.5 }
}

export function weatherFeatureStyle(feature: { getProperty: (key: string) => unknown }) {
  const kind = String(feature.getProperty('kind') || '')
  if (kind === 'swath') {
    const magnitude = Number(feature.getProperty('magnitude') || 0)
    const bucket = hailBucket(magnitude)
    return {
      fillColor: bucket.fill,
      fillOpacity: bucket.fillOpacity,
      strokeColor: bucket.stroke,
      strokeOpacity: bucket.strokeOpacity,
      strokeWeight: bucket.strokeWeight,
      clickable: false,
      zIndex: 1,
    }
  }
  if (kind === 'warning') {
    const layer = String(feature.getProperty('layer') || 'hail')
    const bucket = layer === 'wind' ? windBucket(70) : hailBucket(1.25)
    return {
      fillColor: bucket.fill,
      fillOpacity: 0.22,
      strokeColor: bucket.stroke,
      strokeOpacity: bucket.strokeOpacity,
      strokeWeight: 1.5,
      clickable: false,
      zIndex: 1,
    }
  }

  const layer = String(feature.getProperty('layer') || 'hail')
  const magnitude = Number(feature.getProperty('magnitude') || 0)
  const damage = Boolean(feature.getProperty('damage'))
  const { scale, strokeWeight } = reportDotScale(layer, magnitude, damage)

  return {
    icon: {
      path: 0, // google.maps.SymbolPath.CIRCLE — resolved at runtime in CanvassMap
      scale,
      fillColor: reportDotFill(layer, magnitude, damage),
      fillOpacity: 1,
      // White halo ring: the one color guaranteed to pop on gray-brown satellite
      // imagery AND on the purple pin clusters it sits among. The old flat-gray
      // dots were invisible in the field.
      strokeColor: '#FFFFFF',
      strokeOpacity: 1,
      strokeWeight,
    },
    clickable: true,
    // Above swaths/warnings (zIndex 1) but below canvass pins/clusters — the rep's
    // knock state stays the top-priority signal.
    zIndex: 3,
  }
}

/**
 * Warm severity fill for report dots — same luminance-ordered ramp family as the
 * hail swaths, so "darker = worse" holds everywhere and survives colorblindness
 * and sunlit screens. Never gray: gray dies on satellite imagery.
 */
export function reportDotFill(layer: string, magnitude: number, damage: boolean) {
  if (layer === 'wind') {
    if (damage || magnitude <= 0) return '#EA580C' // damage report (no measured speed)
    if (magnitude >= 70) return '#B91C1C'
    if (magnitude >= 58) return '#EA580C'
    return '#F59E0B'
  }
  if (magnitude >= 1.75) return '#B91C1C'
  if (magnitude >= 1.0) return '#EA580C'
  return '#F59E0B'
}

/** Ground radius for report markers — Data-layer SVG symbols fail to paint on iOS Safari. */
export function reportMarkerRadiusMeters(layer: string, magnitude: number, damage: boolean): number {
  if (layer === 'wind' && (damage || magnitude <= 0)) return 55
  if (layer === 'hail') {
    if (magnitude >= 1.75) return 50
    if (magnitude >= 1.0) return 45
    return 40
  }
  if (magnitude >= 70) return 50
  if (magnitude >= 58) return 45
  return 40
}

/** Storm report dots: size + darkness convey severity (distinct from canvass pins). */
function reportDotScale(layer: string, magnitude: number, damage: boolean) {
  if (layer === 'wind' && (damage || magnitude <= 0)) {
    return { scale: 7, strokeWeight: 2.5 }
  }
  if (layer === 'hail') {
    if (magnitude >= 1.75) return { scale: 9, strokeWeight: 2.5 }
    if (magnitude >= 1.0) return { scale: 7.5, strokeWeight: 2.5 }
    return { scale: 6, strokeWeight: 2 }
  }
  if (magnitude >= 70) return { scale: 9, strokeWeight: 2.5 }
  if (magnitude >= 58) return { scale: 7.5, strokeWeight: 2.5 }
  return { scale: 6, strokeWeight: 2 }
}

/**
 * Wind has no MRMS swaths, so impact AREA comes from translucent halos around
 * damage reports and strong (58+ mph) gusts — the HailTrace-style "shaded
 * neighborhood" read that tells a rep where to knock, visible at any zoom.
 * Radius is an unscientific "canvass this area" est. hint, not a claim.
 */
export const WIND_IMPACT_HALO = {
  fill: '#F97316',
  // 0.16 was invisible on iPhone satellite imagery (field-verified Jul 2026) — wind
  // has no polygon swaths, so this halo IS the "impact area" read reps expect.
  fillOpacity: 0.34,
  stroke: '#EA580C',
  strokeOpacity: 0.95,
  strokeWeight: 3.5,
  radiusMeters: 750,
  /** Hard cap on halo circles per paint — keeps a dense metro viewport smooth. */
  maxCircles: 150,
}

export function windReportGetsHalo(magnitude: number, damage: boolean): boolean {
  return damage || magnitude <= 0 || magnitude >= 58
}

function distanceMiles(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (value: number) => (value * Math.PI) / 180
  const earthMiles = 3958.8
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return earthMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function ringContainsPoint(ring: number[][], lat: number, lng: number) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function geometryContainsPoint(geometry: GeoJSON.Geometry | null, lat: number, lng: number) {
  if (!geometry) return false
  try {
    if (geometry.type === 'Polygon') {
      const [outer, ...holes] = geometry.coordinates
      if (!outer || !ringContainsPoint(outer, lat, lng)) return false
      return !holes.some((hole) => ringContainsPoint(hole, lat, lng))
    }
    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.some(([outer, ...holes]) => {
        if (!outer || !ringContainsPoint(outer, lat, lng)) return false
        return !holes.some((hole) => ringContainsPoint(hole, lat, lng))
      })
    }
  } catch {
    return false
  }
  return false
}

const METERS_PER_MILE = 1609.344

/** Nearest halo-worthy wind report within WIND_IMPACT_HALO.radiusMeters of a
 * point, or null. Wind has no polygon geometry to test containment against —
 * halos are circles around report points, so "inside" is a distance check. */
function nearestWindImpact(
  features: WeatherFeature[],
  lat: number,
  lng: number,
): { magnitude: number; damage: boolean; date: string } | null {
  let best: { magnitude: number; damage: boolean; date: string; distanceMeters: number } | null = null
  for (const f of features) {
    if (f.properties.kind !== 'report' || f.properties.layer !== 'wind') continue
    if (f.geometry?.type !== 'Point') continue
    const magnitude = Number(f.properties.magnitude || 0)
    const damage = Boolean(f.properties.damage)
    if (!windReportGetsHalo(magnitude, damage)) continue
    const [reportLng, reportLat] = f.geometry.coordinates as [number, number]
    const distanceMeters = distanceMiles(lat, lng, reportLat, reportLng) * METERS_PER_MILE
    if (distanceMeters > WIND_IMPACT_HALO.radiusMeters) continue
    if (!best || distanceMeters < best.distanceMeters) {
      best = { magnitude, damage, date: String(f.properties.date || ''), distanceMeters }
    }
  }
  return best
}

/** Worst (largest-magnitude) hail swath containing a point, or null. Shared by
 * the viewport strip and the pin peek so they can never disagree about whether
 * a location is "inside" a swath. */
function worstContainingSwath(
  features: WeatherFeature[],
  lat: number,
  lng: number,
): { magnitude: number; date: string } | null {
  const containing = features
    .filter(
      (f) =>
        f.properties.kind === 'swath' &&
        f.geometry &&
        geometryContainsPoint(f.geometry, lat, lng),
    )
    .map((f) => ({
      magnitude: Number(f.properties.magnitude || 0),
      date: String(f.properties.date || ''),
    }))
    .filter((s) => s.magnitude > 0)
  if (!containing.length) return null
  return containing.reduce((best, s) => (s.magnitude > best.magnitude ? s : best), containing[0])
}

export type PinStormSummary = {
  kind: 'report' | 'warning' | 'none'
  magnitude?: number
  dateLabel?: string
  expiresLabel?: string
  headline: string
  expandedHeadline: string
  talkTrack: string
  emptyMessage?: string
}

function formatShortDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function hailSizeLabel(inches: number) {
  // Coin language matches HAIL_LEGEND and the worker's band buckets (US references:
  // penny≈0.75″, quarter≈1″, half-dollar≈1.25″, golf ball≈1.75″, tennis ball≈2.5″).
  if (inches >= 2.5) return 'tennis-ball hail'
  if (inches >= 1.75) return 'golf-ball hail'
  if (inches >= 1.25) return 'half-dollar hail'
  if (inches >= 1.0) return 'quarter hail'
  if (inches >= 0.75) return 'penny-size hail'
  return 'small hail'
}

export function summarizeViewport(
  layer: Exclude<WeatherLayer, 'off'>,
  features: WeatherFeature[],
  /** Map center — when it sits INSIDE a swath the strip says so explicitly. At
   * field zoom a swath fills the whole viewport as a uniform tint with no edge
   * in view, so the strip is the only way the rep can tell they're standing in it. */
  center?: { lat: number; lng: number },
): { text: string; empty: boolean; offline?: boolean; dateLabel?: string } {
  const warnings = features.filter((f) => f.properties.kind === 'warning')
  if (warnings.length > 0) {
    const warning = warnings[0]
    const expires = warning.properties.expires
    const expiresLabel = expires ? formatTime(expires) : ''
    return {
      text: expiresLabel
        ? `Active storm warning until ${expiresLabel}`
        : 'Active storm warning in this area',
      empty: false,
      dateLabel: expires ? formatShortDate(expires) : undefined,
    }
  }

  const allReports = features
    .filter((f) => f.properties.kind === 'report')
    .map((f) => ({
      magnitude: Number(f.properties.magnitude || 0),
      damage: Boolean(f.properties.damage),
      date: String(f.properties.date || ''),
    }))

  if (layer === 'hail') {
    if (center) {
      const worst = worstContainingSwath(features, center.lat, center.lng)
      if (worst) {
        const dateLabel = formatShortDate(worst.date)
        return {
          text: `Inside est. ${worst.magnitude.toFixed(1)}″ hail swath · ${dateLabel}`,
          empty: false,
          dateLabel,
        }
      }
    }
    const swaths = features
      .filter((f) => f.properties.kind === 'swath')
      .map((f) => ({
        magnitude: Number(f.properties.magnitude || 0),
        date: String(f.properties.date || ''),
      }))
      .filter((s) => s.magnitude > 0)
    const reports = allReports.filter((r) => r.magnitude > 0)
    const candidates = [...reports, ...swaths]
    if (!candidates.length) return { text: 'No recorded hail nearby', empty: true }
    const max = candidates.reduce(
      (best, r) => (r.magnitude > best.magnitude ? r : best),
      candidates[0],
    )
    const dateLabel = formatShortDate(max.date)
    return {
      text: `est. up to ${max.magnitude.toFixed(1)}″ hail · ${dateLabel}`,
      empty: false,
      dateLabel,
    }
  }

  // wind: measured gusts (mph) plus wind-damage reports (TSTM 'D' + non-TSTM 'O', no speed)
  if (center) {
    const impact = nearestWindImpact(features, center.lat, center.lng)
    if (impact) {
      const dateLabel = formatShortDate(impact.date)
      const text =
        impact.damage || impact.magnitude <= 0
          ? `Inside est. wind-damage impact area · ${dateLabel}`
          : `Inside est. ${Math.round(impact.magnitude)} mph wind impact area · ${dateLabel}`
      return { text, empty: false, dateLabel }
    }
  }
  const gusts = allReports.filter((r) => !r.damage && r.magnitude > 0)
  const damageReports = allReports.filter((r) => r.damage || r.magnitude <= 0)

  if (gusts.length) {
    const max = gusts.reduce((best, r) => (r.magnitude > best.magnitude ? r : best), gusts[0])
    const dateLabel = formatShortDate(max.date)
    // Keep the strip short so the date (the part the rep says) never ellipsis-clips
    // on a narrow phone — the damage-report count isn't sayable, so it's dropped here.
    return {
      text: `est. up to ${Math.round(max.magnitude)} mph wind · ${dateLabel}`,
      empty: false,
      dateLabel,
    }
  }

  if (damageReports.length) {
    const newest = damageReports.reduce(
      (best, r) => (new Date(r.date).getTime() > new Date(best.date).getTime() ? r : best),
      damageReports[0],
    )
    const dateLabel = formatShortDate(newest.date)
    const n = damageReports.length
    return {
      text: `${n} wind-damage report${n > 1 ? 's' : ''} · ${dateLabel}`,
      empty: false,
      dateLabel,
    }
  }

  return { text: 'No recorded wind nearby', empty: true }
}

export function lookupPinStorm(
  layer: Exclude<WeatherLayer, 'off'>,
  features: WeatherFeature[],
  lat: number,
  lng: number,
): PinStormSummary {
  const warnings = features.filter(
    (f) => f.properties.kind === 'warning' && geometryContainsPoint(f.geometry, lat, lng),
  )
  const nearbyReports = features
    .filter((f) => f.properties.kind === 'report')
    .map((f) => {
      const coords =
        f.geometry?.type === 'Point' ? (f.geometry.coordinates as [number, number]) : null
      if (!coords) return null
      const [reportLng, reportLat] = coords
      return {
        magnitude: Number(f.properties.magnitude || 0),
        damage: Boolean(f.properties.damage),
        date: String(f.properties.date || ''),
        distance: distanceMiles(lat, lng, reportLat, reportLng),
      }
    })
    .filter(Boolean) as Array<{ magnitude: number; damage: boolean; date: string; distance: number }>

  const closestReport =
    nearbyReports.length > 0
      ? nearbyReports.reduce((best, r) => (r.distance < best.distance ? r : best), nearbyReports[0])
      : null

  const bestSwath = layer === 'hail' ? worstContainingSwath(features, lat, lng) : null

  const inWarning = warnings.length > 0
  const hasNearbyReport = closestReport != null && closestReport.distance <= 8

  if (inWarning && !hasNearbyReport && !bestSwath) {
    const expires = warnings[0].properties.expires
    return {
      kind: 'warning',
      expiresLabel: expires ? formatTime(expires) : undefined,
      headline: `⛈ Active storm warning${expires ? ` until ${formatTime(expires)}` : ''} ▸`,
      expandedHeadline: `In an active storm warning — no confirmed or estimated ${
        layer === 'wind' ? 'wind impact' : 'hail'
      } yet`,
      talkTrack:
        'Your street is under an active storm warning — we are offering free roof inspections in the area.',
      dateLabel: expires ? formatShortDate(expires) : undefined,
    }
  }

  if (layer === 'hail' && (hasNearbyReport || bestSwath)) {
    const hailMagnitude = Math.max(
      hasNearbyReport && closestReport ? closestReport.magnitude : 0,
      bestSwath?.magnitude ?? 0,
    )
    const hailDate =
      bestSwath &&
      (!closestReport ||
        bestSwath.magnitude >= closestReport.magnitude ||
        !hasNearbyReport)
        ? bestSwath.date
        : closestReport?.date || bestSwath?.date || ''
    const dateLabel = formatShortDate(hailDate)
    const sizeLabel = hailSizeLabel(hailMagnitude)
    return {
      kind: 'report',
      magnitude: hailMagnitude,
      dateLabel,
      headline: `⛈ est. ${sizeLabel} · ${dateLabel} ▸`,
      expandedHeadline: `est. ${hailMagnitude.toFixed(1)}″ hail`,
      talkTrack: `Your street may have been impacted by hail on ${dateLabel} — we're offering free roof inspections in the area.`,
    }
  }

  if (layer === 'wind' && hasNearbyReport && closestReport) {
    const dateLabel = formatShortDate(closestReport.date)
    if (closestReport.damage || closestReport.magnitude <= 0) {
      return {
        kind: 'report',
        dateLabel,
        headline: `⛈ wind damage reported · ${dateLabel} ▸`,
        expandedHeadline: 'Wind damage reported nearby',
        talkTrack: `Storm-related wind damage was reported near here on ${dateLabel} — we're offering free roof inspections in the area.`,
      }
    }
    return {
      kind: 'report',
      magnitude: closestReport.magnitude,
      dateLabel,
      headline: `⛈ est. ${Math.round(closestReport.magnitude)} mph wind · ${dateLabel} ▸`,
      expandedHeadline: `est. ${Math.round(closestReport.magnitude)} mph wind`,
      talkTrack: `Your street may have been impacted by wind on ${dateLabel} — we're offering free roof inspections in the area.`,
    }
  }

  return {
    kind: 'none',
    headline: '',
    expandedHeadline: '',
    // No dot here ≠ no damage. Give the rep a claims-safe line so an empty spot
    // never reads as "skip this house" (storm data has real coverage gaps).
    talkTrack:
      'This neighborhood may have been impacted by recent storms — we’re offering free roof inspections in the area.',
    emptyMessage:
      layer === 'hail'
        ? 'No hail recorded right at this spot. Storm data has gaps — nearby homes may still have damage.'
        : 'No wind recorded right at this spot. Storm data has gaps — nearby homes may still have damage.',
  }
}

export const STORM_REPORT_LEGEND = {
  label: 'Storm report (bigger/darker = stronger)',
  // Legend swatch colors — map dots use a white halo ring, but white-on-white
  // vanishes in the panel, so the swatch outlines with the darker ramp tone.
  fill: '#EA580C',
  stroke: '#9A3412',
}

/** Hail swath polygon ramp — report dots are gray (see STORM_REPORT_LEGEND). */
export const HAIL_SWATH_LEGEND = [
  { label: '0.75–1″ (penny)', fill: '#FACC15', stroke: '#A16207' },
  { label: '1–1.25″ quarter', fill: '#F59E0B', stroke: '#B45309' },
  { label: '1.25–1.75″ half-dollar', fill: '#EA580C', stroke: '#9A3412' },
  { label: '1.75–2.5″ golf ball', fill: '#B91C1C', stroke: '#7F1D1D' },
  { label: '2.5″+ tennis ball', fill: '#7F1D6F', stroke: '#4A0E40' },
]

/** @deprecated Use STORM_REPORT_LEGEND + HAIL_SWATH_LEGEND */
export const HAIL_LEGEND = HAIL_SWATH_LEGEND

/** @deprecated Use STORM_REPORT_LEGEND only — wind has no swath ramp */
export const WIND_LEGEND: typeof HAIL_SWATH_LEGEND = []
