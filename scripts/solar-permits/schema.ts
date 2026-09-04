/**
 * Normalized permit row — same column names regardless of source jurisdiction.
 *
 * This is the AUDIT/ingest-staging shape. It is richer than the canvass tables,
 * which are not migrated yet. When ingest lands, map as:
 *
 *   solar_installs: pin, address, lat, lng, issued_on ← issuedOn,
 *     installer_name_raw ← contractor ?? applicant, owner_is_original (tax join, not permit-era owner)
 *   solar_installers: name_key ← contractorKey, display_name, status ('active'|'defunct'|'unknown')
 *
 * Keep every permit row at ingest (building + electrical + zoning). Dedupe per
 * property at read time in lib/solar-installs.ts.
 */

export type SolarDetectionMethod =
  | 'description:solar'
  | 'description:photovoltaic'
  | 'description:pv'
  | 'description:solar panel'
  | 'type:solar'
  | 'type:photovoltaic'
  | 'type:pv'
  | 'type:solar panel'
  | 'notes:solar'
  | 'notes:photovoltaic'
  | 'notes:pv'
  | 'notes:solar panel'

export type PermitRecord = {
  sourceJurisdiction: string
  sourceCounty: string
  sourceUrl: string
  permitNumber: string | null
  permitType: string | null
  permitSubtype: string | null
  issuedOn: string | null
  description: string | null
  address: string | null
  city: string | null
  zip: string | null
  pin: string | null
  applicant: string | null
  contractor: string | null
  /** Normalized installer key when contractor/applicant looks like a company. */
  contractorKey: string | null
  ownerNamePermitEra: string | null
  projectValue: number | null
  latitude: number | null
  longitude: number | null
  /** How this row was flagged as solar-related (audit trail for false positives). */
  detectedBy: SolarDetectionMethod[]
  /** True when PermitSubtype / WorkType indicates commercial scope. */
  isCommercial: boolean
  raw: Record<string, unknown>
}

export type JurisdictionAccess = 'bulk_open' | 'partial_open' | 'portal_only' | 'pra_recommended'

export type JurisdictionCoverage = {
  id: string
  name: string
  county: string
  access: JurisdictionAccess
  bulkSource: string | null
  portalUrl: string | null
  notes: string
  /** Populated when a collector ran against live data. */
  solarPermitCount: number | null
  sampleCount: number | null
  yearsAvailable: string | null
  lastAuditedAt: string | null
}

export type UniqueProperty = {
  propertyKey: string
  sourceCounty: string
  pin: string | null
  address: string | null
  city: string | null
  zip: string | null
  issuedOn: string | null
  yearsSinceInstall: number | null
  contractor: string | null
  contractorKey: string | null
  permitNumbers: string[]
  permitCount: number
  /** True only when every permit on the property is commercial. */
  isCommercial: boolean
  hasInstaller: boolean
}

export type CountyExtractStats = {
  county: string
  rawPermits: number
  uniqueProperties: number
  uniqueResidential: number
  uniqueWithInstaller: number
  uniqueWithPin: number
  uniqueAddressOnly: number
  unkeyable: number
}

export type ExtractSummary = {
  generatedAt: string
  asOfYear: number
  totals: Omit<CountyExtractStats, 'county'>
  byCounty: CountyExtractStats[]
}

export type CabarrusYearStats = {
  year: number
  layerId: number
  totalSolarMatches: number
  electricalSubtypeCount: number | null
  commercialCount: number
  sampleCount: number
}

export type AuditOutput = {
  generatedAt: string
  jurisdictions: JurisdictionCoverage[]
  cabarrus?: {
    arcgisCounts: CabarrusYearStats[]
    camaSolarCount?: number
  }
  mecklenburg?: {
    legacySolarCount: number
    accelaSolarPvCount: number
  }
  rowan?: {
    workclassCounts: Array<{ workclass: string; count: number }>
    electricalSolarPvCount: number
  }
}
