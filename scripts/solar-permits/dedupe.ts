import type {
  CountyExtractStats,
  ExtractSummary,
  PermitRecord,
  UniqueProperty,
} from './schema'

const MIN_INSTALL_YEAR = 1990

export function normalizePin(pin: string | null | undefined): string | null {
  if (!pin) return null
  const compact = pin.toUpperCase().replace(/[\s-]/g, '').trim()
  return compact.length ? compact : null
}

export function normalizeAddress(address: string | null | undefined): string | null {
  if (!address) return null
  const compact = address
    .toUpperCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return compact.length ? compact : null
}

/**
 * PIN preferred, else normalized address. County-prefixed so Cabarrus PIN14 and
 * Meck parcel numbers never collide. Extract keeps rows without lat/lng.
 */
export function propertyKey(record: Pick<PermitRecord, 'sourceCounty' | 'pin' | 'address'>): string | null {
  const county = record.sourceCounty.trim().toLowerCase()
  if (!county) return null
  const pin = normalizePin(record.pin)
  if (pin) return `${county}|pin:${pin}`
  const address = normalizeAddress(record.address)
  if (address) return `${county}|addr:${address}`
  return null
}

export function yearsSinceInstall(issuedOn: string | null, asOfYear: number): number | null {
  if (!issuedOn) return null
  const year = Number(issuedOn.slice(0, 4))
  if (!Number.isFinite(year) || year < MIN_INSTALL_YEAR || year > asOfYear) return null
  return asOfYear - year
}

function earliestIssuedOn(records: PermitRecord[]): string | null {
  let earliest: string | null = null
  for (const record of records) {
    if (!record.issuedOn) continue
    if (earliest == null || record.issuedOn < earliest) earliest = record.issuedOn
  }
  return earliest
}

function firstFilled(records: PermitRecord[], field: 'pin' | 'address' | 'city' | 'zip'): string | null {
  for (const record of records) {
    const value = record[field]?.trim()
    if (value) return value
  }
  return null
}

function mergeGroup(key: string, records: PermitRecord[], asOfYear: number): UniqueProperty {
  const withInstaller = records.find((r) => Boolean(r.contractorKey)) ?? records[0]
  const issuedOn = earliestIssuedOn(records)
  const permitNumbers = Array.from(
    new Set(records.map((r) => r.permitNumber).filter((n): n is string => Boolean(n))),
  )

  return {
    propertyKey: key,
    sourceCounty: records[0].sourceCounty,
    pin: firstFilled(records, 'pin'),
    address: firstFilled(records, 'address'),
    city: firstFilled(records, 'city'),
    zip: firstFilled(records, 'zip'),
    issuedOn,
    yearsSinceInstall: yearsSinceInstall(issuedOn, asOfYear),
    contractor: withInstaller.contractor,
    contractorKey: withInstaller.contractorKey,
    permitNumbers,
    permitCount: records.length,
    isCommercial: records.every((r) => r.isCommercial),
    hasInstaller: Boolean(withInstaller.contractorKey),
  }
}

export type DedupeResult = {
  properties: UniqueProperty[]
  unkeyable: PermitRecord[]
}

/** Collapse building + electrical + zoning rows to one property. Does not drop missing coords. */
export function dedupePermitsByProperty(records: PermitRecord[], asOfYear: number): DedupeResult {
  const groups = new Map<string, PermitRecord[]>()
  const unkeyable: PermitRecord[] = []

  for (const record of records) {
    const key = propertyKey(record)
    if (!key) {
      unkeyable.push(record)
      continue
    }
    const existing = groups.get(key)
    if (existing) existing.push(record)
    else groups.set(key, [record])
  }

  const properties = Array.from(groups.entries()).map(([key, group]) =>
    mergeGroup(key, group, asOfYear),
  )

  properties.sort((a, b) => {
    const county = a.sourceCounty.localeCompare(b.sourceCounty)
    if (county !== 0) return county
    return (a.issuedOn ?? '9999').localeCompare(b.issuedOn ?? '9999')
  })

  return { properties, unkeyable }
}

function emptyStats(county: string): CountyExtractStats {
  return {
    county,
    rawPermits: 0,
    uniqueProperties: 0,
    uniqueResidential: 0,
    uniqueWithInstaller: 0,
    uniqueWithPin: 0,
    uniqueAddressOnly: 0,
    unkeyable: 0,
  }
}

function addStats(target: CountyExtractStats, add: CountyExtractStats): void {
  target.rawPermits += add.rawPermits
  target.uniqueProperties += add.uniqueProperties
  target.uniqueResidential += add.uniqueResidential
  target.uniqueWithInstaller += add.uniqueWithInstaller
  target.uniqueWithPin += add.uniqueWithPin
  target.uniqueAddressOnly += add.uniqueAddressOnly
  target.unkeyable += add.unkeyable
}

export function summarizeExtract(
  records: PermitRecord[],
  result: DedupeResult,
  asOfYear: number,
): ExtractSummary {
  const counties = Array.from(new Set(records.map((r) => r.sourceCounty))).sort()
  const byCounty = counties.map((county) => {
    const countyRecords = records.filter((r) => r.sourceCounty === county)
    const countyProperties = result.properties.filter((p) => p.sourceCounty === county)
    const stats = emptyStats(county)
    stats.rawPermits = countyRecords.length
    stats.uniqueProperties = countyProperties.length
    stats.uniqueResidential = countyProperties.filter((p) => !p.isCommercial).length
    stats.uniqueWithInstaller = countyProperties.filter((p) => p.hasInstaller).length
    stats.uniqueWithPin = countyProperties.filter((p) => Boolean(normalizePin(p.pin))).length
    stats.uniqueAddressOnly = countyProperties.filter(
      (p) => !normalizePin(p.pin) && Boolean(normalizeAddress(p.address)),
    ).length
    stats.unkeyable = result.unkeyable.filter((r) => r.sourceCounty === county).length
    return stats
  })

  const totals = emptyStats('ALL')
  for (const row of byCounty) addStats(totals, row)
  const { county: _county, ...totalsWithoutCounty } = totals

  return {
    generatedAt: new Date().toISOString(),
    asOfYear,
    totals: totalsWithoutCounty,
    byCounty,
  }
}
