export type WeatherLayer = 'off' | 'hail' | 'wind'

export type WeatherFeatureCollection = {
  type: 'FeatureCollection'
  features: WeatherFeature[]
  refreshedAt?: string
}

export type WeatherFeature = {
  type: 'Feature'
  geometry: GeoJSON.Geometry | null
  properties: {
    kind?: 'report' | 'warning'
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
  window.localStorage.setItem(WEATHER_LAYER_STORAGE_KEY, layer)
}

type StyleBucket = {
  fill: string
  fillOpacity: number
  stroke: string
  strokeOpacity: number
  dashed?: boolean
}

function hailBucket(magnitude: number): StyleBucket {
  if (magnitude >= 1.75) {
    return { fill: '#E11D74', fillOpacity: 0.4, stroke: '#9D174D', strokeOpacity: 0.9 }
  }
  if (magnitude >= 1.25) {
    return { fill: '#A855F7', fillOpacity: 0.38, stroke: '#7E22CE', strokeOpacity: 0.9 }
  }
  if (magnitude >= 1.0) {
    return { fill: '#6366F1', fillOpacity: 0.35, stroke: '#4338CA', strokeOpacity: 0.85 }
  }
  return { fill: '#2DD4BF', fillOpacity: 0.35, stroke: '#0F766E', strokeOpacity: 0.85 }
}

function windBucket(magnitude: number): StyleBucket {
  if (magnitude >= 70) {
    return { fill: '#B91C1C', fillOpacity: 0.38, stroke: '#7F1D1D', strokeOpacity: 0.9, dashed: true }
  }
  if (magnitude >= 58) {
    return { fill: '#F97316', fillOpacity: 0.38, stroke: '#C2410C', strokeOpacity: 0.85 }
  }
  return { fill: '#F59E0B', fillOpacity: 0.35, stroke: '#B45309', strokeOpacity: 0.85 }
}

export function weatherFeatureStyle(feature: { getProperty: (key: string) => unknown }) {
  const kind = String(feature.getProperty('kind') || '')
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

  // Wind-damage reports have no measured gust — render as a neutral "damage" dot.
  if (layer === 'wind' && (damage || magnitude <= 0)) {
    return {
      icon: {
        path: 0,
        scale: 5.5,
        fillColor: '#9CA3AF',
        fillOpacity: 0.6,
        strokeColor: '#374151',
        strokeOpacity: 0.9,
        strokeWeight: 1.5,
      },
      clickable: false,
      zIndex: 1,
    }
  }

  const bucket = layer === 'wind' ? windBucket(magnitude) : hailBucket(magnitude)
  return {
    icon: {
      path: 0, // google.maps.SymbolPath.CIRCLE — resolved at runtime in CanvassMap
      scale: 7,
      fillColor: bucket.fill,
      fillOpacity: bucket.fillOpacity,
      strokeColor: bucket.stroke,
      strokeOpacity: bucket.strokeOpacity,
      strokeWeight: 1.5,
    },
    clickable: false,
    zIndex: 1,
  }
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
  return false
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
  if (inches >= 1.75) return 'golf-ball hail'
  if (inches >= 1.25) return 'half-dollar hail'
  if (inches >= 1.0) return 'quarter hail'
  return `${inches.toFixed(1)}″ hail`
}

export function summarizeViewport(
  layer: Exclude<WeatherLayer, 'off'>,
  features: WeatherFeature[],
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
    const reports = allReports.filter((r) => r.magnitude > 0)
    if (!reports.length) return { text: 'No recorded hail nearby', empty: true }
    const max = reports.reduce((best, r) => (r.magnitude > best.magnitude ? r : best), reports[0])
    const dateLabel = formatShortDate(max.date)
    return {
      text: `est. up to ${max.magnitude.toFixed(1)}″ hail · ${dateLabel}`,
      empty: false,
      dateLabel,
    }
  }

  // wind: measured gusts (mph) plus thunderstorm-wind-damage reports (no speed)
  const gusts = allReports.filter((r) => !r.damage && r.magnitude > 0)
  const damageReports = allReports.filter((r) => r.damage || r.magnitude <= 0)

  if (gusts.length) {
    const max = gusts.reduce((best, r) => (r.magnitude > best.magnitude ? r : best), gusts[0])
    const dateLabel = formatShortDate(max.date)
    const extra = damageReports.length ? ` · ${damageReports.length} damage` : ''
    return {
      text: `est. up to ${Math.round(max.magnitude)} mph wind · ${dateLabel}${extra}`,
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

  const inWarning = warnings.length > 0
  const hasNearbyReport = closestReport != null && closestReport.distance <= 8

  if (inWarning && !hasNearbyReport) {
    const expires = warnings[0].properties.expires
    return {
      kind: 'warning',
      expiresLabel: expires ? formatTime(expires) : undefined,
      headline: `⛈ Active storm warning${expires ? ` until ${formatTime(expires)}` : ''} ▸`,
      expandedHeadline: `In an active storm warning — no confirmed or estimated ${
        layer === 'wind' ? 'wind impact' : 'hail'
      } yet`,
      talkTrack:
        'Your street may have been impacted — we are offering free roof inspections in the area.',
      dateLabel: expires ? formatShortDate(expires) : undefined,
    }
  }

  if (hasNearbyReport && closestReport) {
    const dateLabel = formatShortDate(closestReport.date)
    if (layer === 'hail') {
      const sizeLabel = hailSizeLabel(closestReport.magnitude)
      return {
        kind: 'report',
        magnitude: closestReport.magnitude,
        dateLabel,
        headline: `⛈ est. ${sizeLabel} · ${dateLabel} ▸`,
        expandedHeadline: `est. ${closestReport.magnitude.toFixed(1)}″ hail`,
        talkTrack: `Your street may have been impacted by hail on ${dateLabel} — we're offering free roof inspections in the area.`,
      }
    }
    if (closestReport.damage || closestReport.magnitude <= 0) {
      return {
        kind: 'report',
        dateLabel,
        headline: `⛈ wind damage reported · ${dateLabel} ▸`,
        expandedHeadline: 'Thunderstorm wind damage reported nearby',
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
    talkTrack: '',
    emptyMessage:
      layer === 'hail'
        ? 'No recorded hail at this address — data is incomplete.'
        : 'No recorded wind at this address — data is incomplete.',
  }
}

export const HAIL_LEGEND = [
  { label: '0.75–1″ quarter', fill: '#2DD4BF', stroke: '#0F766E' },
  { label: '1–1.25″ half-dollar', fill: '#6366F1', stroke: '#4338CA' },
  { label: '1.25–1.75″ golf ball', fill: '#A855F7', stroke: '#7E22CE' },
  { label: '1.75″+', fill: '#E11D74', stroke: '#9D174D' },
]

export const WIND_LEGEND = [
  { label: '45–58 mph', fill: '#F59E0B', stroke: '#B45309' },
  { label: '58–70 mph', fill: '#F97316', stroke: '#C2410C' },
  { label: '70+ mph', fill: '#B91C1C', stroke: '#7F1D1D' },
  { label: 'Damage reported', fill: '#9CA3AF', stroke: '#374151' },
]
