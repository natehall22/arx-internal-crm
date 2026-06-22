import {
  calculateRoofRadarScore,
  type RoofRadarProperty,
  type RoofRadarStormEvent,
  type RoofRadarStormExposure,
} from '@/lib/roofradar'

type SpcReportType = 'hail' | 'wind'

type SpcReport = {
  type: SpcReportType
  date: Date
  magnitude: number
  lat: number
  lng: number
  location?: string
  state?: string
}

type CachedReports = {
  expiresAt: number
  reports: SpcReport[]
}

type GeocodeResult = {
  lat: number
  lng: number
}

type OpenDataSummary = {
  storm: {
    provider: string
    enabled: boolean
    radiusMiles: number
    years: number[]
  }
  geocoder: {
    provider: string
    enabled: boolean
    attempted: number
    matched: number
  }
}

const reportCache = new Map<string, CachedReports>()
const geocodeCache = new Map<string, GeocodeResult | null>()

const DAY_MS = 86400000
const DEFAULT_STORM_RADIUS_MILES = 8
const DEFAULT_CACHE_MS = 1000 * 60 * 30

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index]
    const next = csv[index + 1]
    if (char === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

function readCell(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = row[key] || row[key.toUpperCase()] || row[key.toLowerCase()]
    if (value != null && String(value).trim() !== '') return value
  }
  return ''
}

function parseSpcDate(row: Record<string, string>) {
  const dateValue = readCell(row, ['date'])
  if (dateValue) {
    const parsed = new Date(dateValue)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  const year = toNumber(readCell(row, ['yr', 'year']))
  const month = toNumber(readCell(row, ['mo', 'month']))
  const day = toNumber(readCell(row, ['dy', 'day']))
  if (year && month && day) return new Date(Date.UTC(year, month - 1, day))
  return null
}

async function fetchSpcReports(year: number, type: SpcReportType) {
  const cacheKey = `${year}-${type}`
  const cached = reportCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.reports

  const url = `https://www.spc.noaa.gov/wcm/data/${year}_${type}.csv`
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    reportCache.set(cacheKey, { expiresAt: Date.now() + DEFAULT_CACHE_MS, reports: [] })
    return []
  }

  const rows = parseCsv(await response.text())
  const [headers = [], ...body] = rows
  const reports = body
    .map((values): SpcReport | null => {
      const row = Object.fromEntries(headers.map((header, index) => [header.trim(), String(values[index] || '').trim()]))
      const date = parseSpcDate(row)
      const lat = toNumber(readCell(row, ['slat', 'lat', 'latitude']), Number.NaN)
      const lng = toNumber(readCell(row, ['slon', 'lon', 'lng', 'longitude']), Number.NaN)
      if (!date || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
      return {
        type,
        date,
        lat,
        lng,
        magnitude: toNumber(readCell(row, ['mag', 'magnitude'])),
        location: readCell(row, ['location', 'loc']),
        state: readCell(row, ['st', 'state']),
      }
    })
    .filter(Boolean) as SpcReport[]

  reportCache.set(cacheKey, { expiresAt: Date.now() + DEFAULT_CACHE_MS, reports })
  return reports
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

function stormExposureFromReports(
  reports: SpcReport[],
  property: RoofRadarProperty,
  propLat: number,
  propLng: number,
): RoofRadarStormExposure {
  const hailReports = reports.filter((r) => r.type === 'hail')
  const windReports = reports.filter((r) => r.type === 'wind')

  // Sort all reports newest-first
  const sorted = [...reports].sort((a, b) => b.date.getTime() - a.date.getTime())
  const mostRecent = sorted[0]
  const lastEventDaysAgo = mostRecent
    ? Math.max(0, Math.round((Date.now() - mostRecent.date.getTime()) / DAY_MS))
    : 999
  const lastEventDate = mostRecent ? mostRecent.date.toISOString().slice(0, 10) : undefined

  // Build per-event list (newest first, cap at 12)
  const recentEvents: RoofRadarStormEvent[] = sorted.slice(0, 12).map((r) => ({
    type: r.type,
    date: r.date.toISOString().slice(0, 10),
    magnitude: r.magnitude,
    distanceMiles: Math.round(distanceMiles(propLat, propLng, r.lat, r.lng) * 10) / 10,
  }))

  const exposure: RoofRadarStormExposure = {
    hailEvents: hailReports.length,
    maxHailInches: Number(Math.max(0, ...hailReports.map((r) => r.magnitude)).toFixed(1)),
    windEvents: windReports.length,
    maxWindMph: Math.max(0, ...windReports.map((r) => r.magnitude)),
    lastEventDaysAgo,
    ...(lastEventDate ? { lastEventDate } : {}),
    confidence:
      reports.length >= 3 ||
      hailReports.some((r) => r.magnitude >= 1) ||
      windReports.some((r) => r.magnitude >= 58)
        ? 'High'
        : reports.length > 0
          ? 'Medium'
          : property.storm.confidence,
    ...(recentEvents.length > 0 ? { recentEvents } : {}),
  }

  return exposure.hailEvents || exposure.windEvents ? exposure : property.storm
}

async function censusGeocode(property: RoofRadarProperty) {
  if (property.lat != null && property.lng != null) return { lat: property.lat, lng: property.lng }
  const address = [property.street, property.city, property.zip].filter(Boolean).join(', ')
  if (!address) return null
  const cacheKey = address.toLowerCase()
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey) || null

  const params = new URLSearchParams({
    address,
    benchmark: 'Public_AR_Current',
    format: 'json',
  })
  const response = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`, {
    cache: 'no-store',
  }).catch(() => null)

  if (!response?.ok) {
    geocodeCache.set(cacheKey, null)
    return null
  }

  const payload = await response.json().catch(() => null)
  const coordinates = payload?.result?.addressMatches?.[0]?.coordinates
  const result =
    coordinates && Number.isFinite(Number(coordinates.y)) && Number.isFinite(Number(coordinates.x))
      ? { lat: Number(coordinates.y), lng: Number(coordinates.x) }
      : null

  geocodeCache.set(cacheKey, result)
  return result
}

function candidateYears() {
  const current = new Date().getFullYear()
  // Default 3 years; set ROOFRADAR_STORM_YEARS=5 in env for deeper history (fetches more SPC CSVs)
  const count = Math.min(5, Math.max(1, toNumber(process.env.ROOFRADAR_STORM_YEARS, 3)))
  return Array.from({ length: count }, (_, i) => current - i)
}

function yearsForWindow(windowDays: number) {
  const cutoff = new Date(Date.now() - windowDays * DAY_MS)
  const currentYear = new Date().getFullYear()
  const startYear = cutoff.getFullYear()
  const years: number[] = []
  for (let year = startYear; year <= currentYear; year += 1) {
    years.push(year)
  }
  const allowed = new Set(candidateYears())
  return years.filter((year) => allowed.has(year))
}

function inBbox(lat: number, lng: number, bbox: { n: number; s: number; e: number; w: number }) {
  return lat <= bbox.n && lat >= bbox.s && lng <= bbox.e && lng >= bbox.w
}

/** Returns SPC reports of the given type within a bbox, restricted to the last `windowDays`. */
export async function getSpcReportsInBbox(
  bbox: { n: number; s: number; e: number; w: number },
  type: 'hail' | 'wind',
  windowDays: number,
): Promise<Array<{ lat: number; lng: number; magnitude: number; date: Date }>> {
  const cutoff = new Date(Date.now() - Math.max(1, windowDays) * DAY_MS)
  const years = yearsForWindow(windowDays)
  const reports = (
    await Promise.all(years.map((year) => fetchSpcReports(year, type).catch(() => [])))
  ).flat()

  return reports
    .filter(
      (report) =>
        report.type === type &&
        report.date >= cutoff &&
        inBbox(report.lat, report.lng, bbox),
    )
    .map((report) => ({
      lat: report.lat,
      lng: report.lng,
      magnitude: report.magnitude,
      date: report.date,
    }))
}

export async function enrichPropertiesWithOpenData(properties: RoofRadarProperty[]) {
  if (!properties.length) {
    return {
      properties,
      openData: {
        storm: {
          provider: 'NOAA/SPC public storm reports',
          enabled: process.env.ROOFRADAR_OPEN_STORM_ENABLED !== 'false',
          radiusMiles: DEFAULT_STORM_RADIUS_MILES,
          years: candidateYears(),
        },
        geocoder: {
          provider: 'US Census Geocoder',
          enabled: process.env.ROOFRADAR_CENSUS_GEOCODER_ENABLED !== 'false',
          attempted: 0,
          matched: 0,
        },
      } satisfies OpenDataSummary,
    }
  }

  const stormEnabled = process.env.ROOFRADAR_OPEN_STORM_ENABLED !== 'false'
  const geocoderEnabled = process.env.ROOFRADAR_CENSUS_GEOCODER_ENABLED !== 'false'
  const geocodeLimit = Math.max(0, toNumber(process.env.ROOFRADAR_CENSUS_GEOCODE_LIMIT, 25))
  const radiusMiles = Math.max(1, toNumber(process.env.ROOFRADAR_STORM_RADIUS_MILES, DEFAULT_STORM_RADIUS_MILES))
  const years = candidateYears()
  let geocodeAttempts = 0
  let geocodeMatches = 0

  const reports = stormEnabled
    ? (
        await Promise.all(
          years.flatMap((year) => [
            fetchSpcReports(year, 'hail').catch(() => []),
            fetchSpcReports(year, 'wind').catch(() => []),
          ])
        )
      ).flat()
    : []

  const enriched: RoofRadarProperty[] = []
  for (const property of properties) {
    let next = property
    let coordinates =
      property.lat != null && property.lng != null ? { lat: property.lat, lng: property.lng } : null

    if (!coordinates && geocoderEnabled && geocodeAttempts < geocodeLimit) {
      geocodeAttempts += 1
      coordinates = await censusGeocode(property)
      if (coordinates) {
        geocodeMatches += 1
        next = { ...next, lat: coordinates.lat, lng: coordinates.lng }
      }
    }

    if (stormEnabled && coordinates && reports.length) {
      const nearbyReports = reports.filter(
        (report) => distanceMiles(coordinates.lat, coordinates.lng, report.lat, report.lng) <= radiusMiles
      )
      const storm = stormExposureFromReports(nearbyReports, next, coordinates.lat, coordinates.lng)
      const signals = [...next.signals]
      if ((storm.hailEvents > 0 || storm.windEvents > 0) && !signals.includes('Storm exposure')) {
        signals.unshift('Storm exposure')
      }
      if (storm.maxHailInches >= 1 && !signals.includes('Hail 1 inch+ nearby')) {
        signals.unshift('Hail 1 inch+ nearby')
      }
      if (storm.maxWindMph >= 58 && !signals.includes('Wind event 58+ mph')) {
        signals.unshift('Wind event 58+ mph')
      }
      next = {
        ...next,
        storm,
        signals,
        score: calculateRoofRadarScore(next.roofAge, signals.length, storm),
      }
    }

    enriched.push(next)
  }

  return {
    properties: enriched,
    openData: {
      storm: {
        provider: 'NOAA/SPC public storm reports',
        enabled: stormEnabled,
        radiusMiles,
        years,
      },
      geocoder: {
        provider: 'US Census Geocoder',
        enabled: geocoderEnabled,
        attempted: geocodeAttempts,
        matched: geocodeMatches,
      },
    } satisfies OpenDataSummary,
  }
}
