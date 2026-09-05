/**
 * Duke NM city strings → Charlotte-metro county. Canonicalize before lookup.
 */

const CITY_TO_COUNTY: Record<string, string> = {
  CHARLOTTE: 'Mecklenburg',
  MATTHEWS: 'Mecklenburg',
  'MINT HILL': 'Mecklenburg',
  MINTHILL: 'Mecklenburg',
  PINEVILLE: 'Mecklenburg',
  HUNTERSVILLE: 'Mecklenburg',
  CORNELIUS: 'Mecklenburg',
  DAVIDSON: 'Mecklenburg',
  CONCORD: 'Cabarrus',
  KANNAPOLIS: 'Cabarrus',
  HARRISBURG: 'Cabarrus',
  MIDLAND: 'Cabarrus',
  LOCUST: 'Cabarrus',
  'MOUNT PLEASANT': 'Cabarrus',
  'N MOUNT PLEASANT': 'Cabarrus',
  SALISBURY: 'Rowan',
  'CHINA GROVE': 'Rowan',
  LANDIS: 'Rowan',
  FAITH: 'Rowan',
  ROCKWELL: 'Rowan',
  'GRANITE QUARRY': 'Rowan',
  SPENCER: 'Rowan',
  CLEVELAND: 'Rowan',
  MONROE: 'Union',
  WAXHAW: 'Union',
  'INDIAN TRAIL': 'Union',
  STALLINGS: 'Union',
  WEDDINGTON: 'Union',
  MARVIN: 'Union',
  'WESLEY CHAPEL': 'Union',
  'MINERAL SPRINGS': 'Union',
  WINGATE: 'Union',
  MARSHVILLE: 'Union',
  GASTONIA: 'Gaston',
  'GASTONIA CITY': 'Gaston',
  BELMONT: 'Gaston',
  'MOUNT HOLLY': 'Gaston',
  CRAMERTON: 'Gaston',
  DALLAS: 'Gaston',
  STANLEY: 'Gaston',
  LOWELL: 'Gaston',
  RANLO: 'Gaston',
  MCADENVILLE: 'Gaston',
  'BESSEMER CITY': 'Gaston',
  CHERRYVILLE: 'Gaston',
  'KINGS MOUNTAIN': 'Gaston',
  STATESVILLE: 'Iredell',
  MOORESVILLE: 'Iredell',
  TROUTMAN: 'Iredell',
  LINCOLNTON: 'Lincoln',
  DENVER: 'Lincoln',
  'IRON STATION': 'Lincoln',
  MAIDEN: 'Lincoln',
}

const ALIASES: Record<string, string> = {
  'WINSTON SALEM': 'WINSTON-SALEM',
  'KINGS MTN': 'KINGS MOUNTAIN',
  'KINGS MOUNTIAN': 'KINGS MOUNTAIN',
  'MT HOLLY': 'MOUNT HOLLY',
  'MT PLEASANT': 'MOUNT PLEASANT',
}

export function canonicalCity(raw: string | null | undefined): string {
  if (!raw) return ''
  let value = raw
    .toUpperCase()
    .replace(/[.,`]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\bCITY\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  value = value.replace(/^MT\.?\s+/, 'MOUNT ')
  value = ALIASES[value] ?? value
  if (value === 'WINSTON-SALEM') return 'WINSTON-SALEM'
  return value
}

export function countyForMetroCity(raw: string | null | undefined): string | null {
  const city = canonicalCity(raw)
  if (!city) return null
  return CITY_TO_COUNTY[city] ?? CITY_TO_COUNTY[city.replace(/-/g, ' ')] ?? null
}

/** Cabarrus + Rowan + east Meck only. Not Gaston/Lincoln/Iredell/Union, not south/north Charlotte. */
const EAST_MECK_CITIES = new Set(['MINT HILL', 'MINTHILL', 'MATTHEWS', 'HARRISBURG'])
const EAST_MECK_ZIPS = new Set([
  '28205',
  '28211',
  '28212',
  '28215',
  '28227',
  '28105',
  '28075',
])
const EXCLUDED_CITIES = new Set([
  'HUNTERSVILLE',
  'CORNELIUS',
  'DAVIDSON',
  'PINEVILLE',
  'MOORESVILLE',
  'GASTONIA',
])
const EXCLUDED_ZIPS = new Set(['28078', '28031', '28036', '28134', '28269', '28262', '28277', '28226'])

export function isEastCharlotteCanvass(row: {
  sourceCounty?: string | null
  city?: string | null
  zip?: string | null
  address?: string | null
}): boolean {
  const city = canonicalCity(row.city)
  const parsed = parseCityZipFromAddress(row.address)
  const zip = (row.zip || parsed.zip || '').replace(/\D/g, '').slice(0, 5)
  const addressCity = canonicalCity(parsed.city)
  const blob = `${row.city || ''} ${row.address || ''} ${row.zip || ''}`.toUpperCase()
  if (EXCLUDED_CITIES.has(city) || EXCLUDED_CITIES.has(addressCity)) return false
  if (Array.from(EXCLUDED_CITIES).some((name) => blob.includes(name))) return false
  const zipsInBlob = blob.match(/\b\d{5}\b/g) || []
  if ((zip && EXCLUDED_ZIPS.has(zip)) || zipsInBlob.some((z) => EXCLUDED_ZIPS.has(z))) return false
  const county = (row.sourceCounty || '').trim()
  if (county === 'Cabarrus' || county === 'Rowan') return true
  if (county !== 'Mecklenburg') return false
  if (EAST_MECK_CITIES.has(city)) return true
  return EAST_MECK_ZIPS.has(zip)
}

type CanvassPlaceRow = {
  sourceCounty?: string | null
  city?: string | null
  zip?: string | null
  address?: string | null
}

function canvassPlace(row: CanvassPlaceRow): { city: string; zip: string; blob: string; zips: string[] } {
  const parsed = parseCityZipFromAddress(row.address)
  const city = canonicalCity(row.city)
  const zip = fiveDigitZip(row.zip) || parsed.zip || ''
  const blob = `${row.city || ''} ${row.address || ''} ${row.zip || ''}`.toUpperCase()
  const zips = new Set<string>()
  if (zip) zips.add(zip)
  for (const match of Array.from(blob.matchAll(/\bNC\s+(\d{5})\b/g))) {
    zips.add(match[1])
  }
  return { city, zip, blob, zips: Array.from(zips) }
}

function fiveDigitZip(raw: string | null | undefined): string {
  const digits = (raw || '').replace(/\D/g, '')
  if (digits.length === 5) return digits
  if (digits.length === 9) return digits.slice(0, 5)
  return ''
}

/** South Charlotte proper + Matthews / Pineville. Steele Creek (28273/78/17) is southwest — not this slice. */
const SOUTH_CITIES = new Set(['MATTHEWS', 'PINEVILLE'])
const SOUTH_ZIPS = new Set([
  '28210',
  '28226',
  '28270',
  '28277',
  '28203',
  '28207',
  '28209',
  '28105',
  '28134',
])

export function isSouthCharlotteCanvass(row: CanvassPlaceRow): boolean {
  const place = canvassPlace(row)
  if (SOUTH_CITIES.has(place.city) || SOUTH_CITIES.has(canonicalCity(parseCityZipFromAddress(row.address).city))) {
    return true
  }
  return place.zips.some((z) => SOUTH_ZIPS.has(z))
}

export function parseCityZipFromAddress(address: string | null | undefined): {
  city: string | null
  zip: string | null
} {
  if (!address) return { city: null, zip: null }
  const match = address.match(/,\s*([^,]+),\s*NC\s+(\d{5})(?:-\d{4})?\s*$/i)
  if (!match) return { city: null, zip: null }
  return { city: collapse(match[1]), zip: match[2] }
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
