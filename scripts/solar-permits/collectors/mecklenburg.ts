import {
  countArcGISFeatures,
  fetchAllArcGISFeatures,
  fetchArcGISFeatures,
  parseArcGisDate,
} from '../arcgis'
import { detectSolarInText } from './cabarrus'
import type { PermitRecord } from '../schema'

/** Legacy / POSSE-era building permits (~482k). Has issue dates, address, PIN. No contractor name. */
export const MECKLENBURG_BUILDING_PERMITS_URL =
  'https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0'

/** Accela-era EPIC permits. Queryable SolarPV subtype (meckgis AccelaAllPermits is count-only). */
export const MECKLENBURG_EPIC_PERMITS_URL =
  'https://services.arcgis.com/BWD3gDuaqc7SQmy7/arcgis/rest/services/EPIC_Accela/FeatureServer/1'

export const MECKLENBURG_LEGACY_SOLAR_WHERE = "UPPER(permitdesc) LIKE '%SOLAR%'"
export const MECKLENBURG_EPIC_SOLAR_PV_WHERE = "permit_subtype = 'SolarPV'"

const MECKLENBURG_LEGACY_OUT_FIELDS = [
  'permitnum',
  'permitdesc',
  'permittype',
  'projadd',
  'zipcode',
  'parcelnum',
  'issuedate',
  'compldate',
  'bldgcost',
  'worktype',
  'workdesc',
  'ownname',
  'taxjuris',
].join(',')

const MECKLENBURG_EPIC_OUT_FIELDS = [
  'permit_number',
  'permit_type',
  'permit_subtype',
  'permit_issued_date',
  'description_of_work',
  'full_address',
  'address',
  'municipality',
  'tax_parcel_id',
  'gis_parcel_id',
  'owner_name',
  'total_cost',
  'construction_cost',
].join(',')

const LEGACY_SAMPLE_CAP = 10
const ACCELA_SAMPLE_CAP = 5

function str(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s.length ? s : null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function mapLegacyAttributes(attrs: Record<string, unknown>): PermitRecord {
  const description = str(attrs.permitdesc)
  const workdesc = str(attrs.workdesc)
  const permitType = str(attrs.permittype)

  return {
    sourceJurisdiction: 'mecklenburg-county',
    sourceCounty: 'Mecklenburg',
    sourceUrl: `${MECKLENBURG_BUILDING_PERMITS_URL}/query`,
    permitNumber: str(attrs.permitnum),
    permitType,
    permitSubtype: str(attrs.worktype),
    issuedOn: parseArcGisDate(attrs.issuedate),
    description: [description, workdesc].filter(Boolean).join(' | ') || null,
    address: str(attrs.projadd),
    city: str(attrs.taxjuris),
    zip: str(attrs.zipcode),
    pin: str(attrs.parcelnum),
    applicant: null,
    contractor: null,
    contractorKey: null,
    ownerNamePermitEra: str(attrs.ownname),
    projectValue: num(attrs.bldgcost),
    latitude: null,
    longitude: null,
    detectedBy: Array.from(
      new Set([
        ...detectSolarInText(description, 'description'),
        ...detectSolarInText(workdesc, 'notes'),
      ]),
    ),
    isCommercial: /COMMERCIAL/i.test(permitType ?? ''),
    raw: attrs,
  }
}

function mapEpicAttributes(attrs: Record<string, unknown>): PermitRecord {
  const description = str(attrs.description_of_work)
  const subtype = str(attrs.permit_subtype)

  return {
    sourceJurisdiction: 'mecklenburg-county',
    sourceCounty: 'Mecklenburg',
    sourceUrl: `${MECKLENBURG_EPIC_PERMITS_URL}/query`,
    permitNumber: str(attrs.permit_number),
    permitType: str(attrs.permit_type),
    permitSubtype: subtype,
    issuedOn: parseArcGisDate(attrs.permit_issued_date),
    description,
    address: str(attrs.full_address) ?? str(attrs.address),
    city: str(attrs.municipality),
    zip: null,
    pin: str(attrs.tax_parcel_id) ?? str(attrs.gis_parcel_id),
    applicant: null,
    contractor: null,
    contractorKey: null,
    ownerNamePermitEra: str(attrs.owner_name),
    projectValue: num(attrs.total_cost) ?? num(attrs.construction_cost),
    latitude: null,
    longitude: null,
    detectedBy: Array.from(
      new Set([...detectSolarInText(description, 'description'), ...detectSolarInText(subtype, 'type')]),
    ),
    isCommercial: /COMMERCIAL/i.test(str(attrs.permit_type) ?? ''),
    raw: attrs,
  }
}

export type MecklenburgAuditResult = {
  legacySolarCount: number
  accelaSolarPvCount: number
  samples: PermitRecord[]
}

export async function auditMecklenburgArcgis(): Promise<MecklenburgAuditResult> {
  process.stdout.write('  Mecklenburg BuildingPermits (legacy)… ')
  const legacySolarCount = await countArcGISFeatures(
    MECKLENBURG_BUILDING_PERMITS_URL,
    MECKLENBURG_LEGACY_SOLAR_WHERE,
  )
  const legacyFeatures = await fetchArcGISFeatures(
    MECKLENBURG_BUILDING_PERMITS_URL,
    MECKLENBURG_LEGACY_SOLAR_WHERE,
    Math.min(LEGACY_SAMPLE_CAP, legacySolarCount),
  )
  console.log(`${legacySolarCount} solar (${legacyFeatures.length} sampled)`)

  process.stdout.write('  Mecklenburg EPIC Accela SolarPV… ')
  const accelaSolarPvCount = await countArcGISFeatures(
    MECKLENBURG_EPIC_PERMITS_URL,
    MECKLENBURG_EPIC_SOLAR_PV_WHERE,
  )
  const accelaFeatures = await fetchArcGISFeatures(
    MECKLENBURG_EPIC_PERMITS_URL,
    MECKLENBURG_EPIC_SOLAR_PV_WHERE,
    Math.min(ACCELA_SAMPLE_CAP, accelaSolarPvCount),
  )
  console.log(`${accelaSolarPvCount} SolarPV (${accelaFeatures.length} sampled)`)

  const samples = [
    ...legacyFeatures.map((f) => mapLegacyAttributes(f.attributes)),
    ...accelaFeatures.map((f) => mapEpicAttributes(f.attributes)),
  ]

  return { legacySolarCount, accelaSolarPvCount, samples }
}

export type MecklenburgExtractResult = {
  legacy: PermitRecord[]
  epic: PermitRecord[]
}

/** Full Mecklenburg pull — legacy BuildingPermits SOLAR + EPIC SolarPV. */
export async function extractMecklenburgPermits(): Promise<MecklenburgExtractResult> {
  process.stdout.write('  Mecklenburg BuildingPermits (legacy)… ')
  const legacyFeatures = await fetchAllArcGISFeatures(
    MECKLENBURG_BUILDING_PERMITS_URL,
    MECKLENBURG_LEGACY_SOLAR_WHERE,
    MECKLENBURG_LEGACY_OUT_FIELDS,
  )
  console.log(`${legacyFeatures.length} permits`)

  process.stdout.write('  Mecklenburg EPIC Accela SolarPV… ')
  const epicFeatures = await fetchAllArcGISFeatures(
    MECKLENBURG_EPIC_PERMITS_URL,
    MECKLENBURG_EPIC_SOLAR_PV_WHERE,
    MECKLENBURG_EPIC_OUT_FIELDS,
  )
  console.log(`${epicFeatures.length} permits`)

  return {
    legacy: legacyFeatures.map((f) => mapLegacyAttributes(f.attributes)),
    epic: epicFeatures.map((f) => mapEpicAttributes(f.attributes)),
  }
}
