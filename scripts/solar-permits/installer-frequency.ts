import { installerNameKey } from '../../lib/solar-installers'

/**
 * Frequency grouping for installer research later.
 * Uses installerNameKey, then collapses keys that differ only by spaces
 * (POWER HOME SOLAR vs POWERHOME SOLAR). Does not research active/defunct.
 */
export function installerFrequencyKey(raw: string | null | undefined): string | null {
  const key = installerNameKey(raw)
  if (!key) return null
  return key.replace(/\s+/g, '')
}

export function preferSpacedKey(keys: string[]): string {
  const unique = Array.from(new Set(keys.filter(Boolean)))
  unique.sort((a, b) => {
    const space = Number(b.includes(' ')) - Number(a.includes(' '))
    if (space !== 0) return space
    return b.length - a.length
  })
  return unique[0] ?? ''
}

export type InstallerFrequencyRow = {
  normalizedInstaller: string
  rawNameVariants: string[]
  propertyCount: number
  permitCount: number
  firstPermitDate: string | null
  lastPermitDate: string | null
  counties: string[]
}

export function installerFrequency(
  permits: Array<{
    contractor: string | null
    contractorKey: string | null
    issuedOn: string | null
    sourceCounty: string
    pin: string | null
    address: string | null
    permitNumber: string | null
  }>,
): InstallerFrequencyRow[] {
  type Acc = {
    keys: Set<string>
    variants: Set<string>
    properties: Set<string>
    permitCount: number
    first: string | null
    last: string | null
    counties: Set<string>
  }
  const groups = new Map<string, Acc>()

  for (const permit of permits) {
    const freq = installerFrequencyKey(permit.contractor) ?? installerFrequencyKey(permit.contractorKey)
    if (!freq) continue
    const nameKey = installerNameKey(permit.contractor) ?? permit.contractorKey
    if (!nameKey) continue

    const acc = groups.get(freq) ?? {
      keys: new Set<string>(),
      variants: new Set<string>(),
      properties: new Set<string>(),
      permitCount: 0,
      first: null,
      last: null,
      counties: new Set<string>(),
    }
    acc.keys.add(nameKey)
    if (permit.contractor) acc.variants.add(permit.contractor)
    const propertyId = `${permit.sourceCounty}|${(permit.pin ?? permit.address ?? permit.permitNumber ?? '').toUpperCase()}`
    acc.properties.add(propertyId)
    acc.permitCount += 1
    if (permit.issuedOn) {
      if (acc.first == null || permit.issuedOn < acc.first) acc.first = permit.issuedOn
      if (acc.last == null || permit.issuedOn > acc.last) acc.last = permit.issuedOn
    }
    acc.counties.add(permit.sourceCounty)
    groups.set(freq, acc)
  }

  return Array.from(groups.values())
    .map((acc) => ({
      normalizedInstaller: preferSpacedKey(Array.from(acc.keys)),
      rawNameVariants: Array.from(acc.variants).sort(),
      propertyCount: acc.properties.size,
      permitCount: acc.permitCount,
      firstPermitDate: acc.first,
      lastPermitDate: acc.last,
      counties: Array.from(acc.counties).sort(),
    }))
    .sort((a, b) => b.propertyCount - a.propertyCount || a.normalizedInstaller.localeCompare(b.normalizedInstaller))
}
