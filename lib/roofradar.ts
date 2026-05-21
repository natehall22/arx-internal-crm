export type RoofRadarScore = 'A' | 'B' | 'C' | 'D'
export type RoofRadarListingStatus = 'sold' | 'pending' | 'active' | 'contingent'
export type RoofRadarSource = 'Redfin' | 'Zillow' | 'MLS' | 'Provider'

export type RoofRadarStormEvent = {
  type: 'hail' | 'wind'
  /** YYYY-MM-DD */
  date: string
  /** inches for hail, mph for wind */
  magnitude: number
  distanceMiles: number
}

export type RoofRadarStormExposure = {
  hailEvents: number
  maxHailInches: number
  windEvents: number
  maxWindMph: number
  lastEventDaysAgo: number
  /** ISO date of most recent nearby event, e.g. "2024-04-03" */
  lastEventDate?: string
  confidence: 'High' | 'Medium' | 'Low'
  /** Up to 10 most recent events with actual dates, sorted newest first */
  recentEvents?: RoofRadarStormEvent[]
}

export type RoofRadarProperty = {
  id: number | string
  street: string
  city: string
  zip: string
  lat?: number
  lng?: number
  status: RoofRadarListingStatus
  score: RoofRadarScore
  roofAge: number
  yearBuilt: number
  value: number
  sqft: number
  daysAgo: number
  source: RoofRadarSource
  signals: string[]
  storm: RoofRadarStormExposure
  tagged: boolean
  notes: string
}

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const normalizeStatus = (value: unknown): RoofRadarListingStatus => {
  const status = String(value || '').toLowerCase()
  if (status.includes('sold')) return 'sold'
  if (status.includes('pending')) return 'pending'
  if (status.includes('contingent')) return 'contingent'
  return 'active'
}

const normalizeSource = (value: unknown): RoofRadarSource => {
  const source = String(value || '').toLowerCase()
  if (source.includes('redfin')) return 'Redfin'
  if (source.includes('zillow')) return 'Zillow'
  if (source.includes('mls')) return 'MLS'
  return 'Provider'
}

export const calculateRoofRadarScore = (
  roofAge: number,
  signalCount: number,
  storm: RoofRadarStormExposure
): RoofRadarScore => {
  const stormPressure =
    storm.hailEvents * 12 +
    storm.windEvents * 7 +
    Math.max(0, storm.maxHailInches - 0.75) * 18 +
    Math.max(0, storm.maxWindMph - 45) * 0.9 +
    (storm.lastEventDaysAgo <= 45 ? 12 : storm.lastEventDaysAgo <= 120 ? 6 : 0)
  const total = Math.min(35, roofAge) * 2.2 + signalCount * 12 + stormPressure
  if (total >= 75) return 'A'
  if (total >= 48) return 'B'
  if (total >= 25) return 'C'
  return 'D'
}

export function normalizeRoofRadarProperty(raw: unknown, index: number): RoofRadarProperty | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const address =
    row.street ||
    row.address ||
    row.fullAddress ||
    row.formattedAddress ||
    row.UnparsedAddress ||
    row.StreetName ||
    row.line1 ||
    row.propertyAddress ||
    ''
  const street = String(address).trim()
  if (!street) return null

  const city = String(row.city || row.City || row.locality || row.market || '').trim()
  const zip = String(row.zip || row.zipCode || row.PostalCode || row.postalCode || '').trim()
  const roofAge = toNumber(row.roofAge || row.estimatedRoofAge || row.roof_age, 0)
  const yearBuilt = toNumber(row.yearBuilt || row.YearBuilt || row.year_built || row.builtYear, new Date().getFullYear())
  const value = toNumber(row.value || row.price || row.ListPrice || row.listPrice || row.estimate || row.zestimate, 0)
  const sqft = toNumber(row.sqft || row.LivingArea || row.livingArea || row.squareFeet || row.lotSqft, 0)
  const lat = toNumber(row.lat || row.latitude || row.Latitude || row.propertyLatitude || row.Y, Number.NaN)
  const lng = toNumber(row.lng || row.lon || row.longitude || row.Longitude || row.propertyLongitude || row.X, Number.NaN)
  const modificationTimestamp = String(row.ModificationTimestamp || row.modificationTimestamp || '')
  const modifiedDaysAgo = modificationTimestamp
    ? Math.max(0, Math.round((Date.now() - new Date(modificationTimestamp).getTime()) / 86400000))
    : 0
  const daysAgo = toNumber(row.daysAgo || row.daysOnMarket || row.dom || row.lastActivityDaysAgo, modifiedDaysAgo)
  const signals = Array.isArray(row.signals)
    ? row.signals.map(String)
    : Array.isArray(row.tags)
      ? row.tags.map(String)
      : []
  const rawEvents = Array.isArray(row.recentEvents) ? row.recentEvents : []
  const storm: RoofRadarStormExposure = {
    hailEvents: toNumber(row.hailEvents || row.hail_event_count, 0),
    maxHailInches: toNumber(row.maxHailInches || row.max_hail_inches, 0),
    windEvents: toNumber(row.windEvents || row.wind_event_count, 0),
    maxWindMph: toNumber(row.maxWindMph || row.max_wind_mph, 0),
    lastEventDaysAgo: toNumber(row.lastStormDaysAgo || row.last_event_days_ago, 999),
    ...(row.lastEventDate ? { lastEventDate: String(row.lastEventDate) } : {}),
    confidence: ['High', 'Medium', 'Low'].includes(String(row.stormConfidence))
      ? (row.stormConfidence as RoofRadarStormExposure['confidence'])
      : 'Medium',
    ...(rawEvents.length > 0 ? { recentEvents: rawEvents as RoofRadarStormEvent[] } : {}),
  }

  return {
    id: String(row.id || row.propertyId || row.listingId || `${street}-${index}`),
    street,
    city,
    zip,
    ...(Number.isFinite(lat) ? { lat } : {}),
    ...(Number.isFinite(lng) ? { lng } : {}),
    status: normalizeStatus(row.status || row.StandardStatus || row.MlsStatus || row.listingStatus),
    score: calculateRoofRadarScore(roofAge, signals.length, storm),
    roofAge,
    yearBuilt,
    value,
    sqft,
    daysAgo,
    source: normalizeSource(row.source || row.SourceSystemName || row.SourceSystemID || row.provider || row.portal),
    signals,
    storm,
    tagged: false,
    notes: '',
  }
}
