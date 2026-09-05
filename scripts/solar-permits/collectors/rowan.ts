import { installerNameKey } from '../../../lib/solar-installers'
import {
  countArcGISFeatures,
  fetchAllArcGISFeatures,
  fetchArcGISFeatures,
  parseArcGisDate,
} from '../arcgis'
import { detectSolarInText } from './cabarrus'
import type { PermitRecord } from '../schema'

export const ROWAN_LAYER_URL =
  'https://gis.rowancountync.gov/arcgis/rest/services/Public/Building_Permits/MapServer/6'

export const ROWAN_WORKCLASSES = ['Solar', 'Solar PV', 'Solar Water'] as const

export const ROWAN_ELECTRICAL_SOLAR_PV_WHERE =
  "sName_Workclass = 'Solar PV' AND UPPER(PermitType) LIKE '%ELECTRICAL%'"

/** PV arrays only — excludes Solar Water (thermal). */
export const ROWAN_PV_WHERE = "sName_Workclass = 'Solar PV' OR sName_Workclass = 'Solar'"

const SAMPLE_CAP = 25

const OUT_FIELDS = [
  'TypeName',
  'dIssued',
  'sPermitNum',
  'sCompanyName_Parc',
  'sFirstName_',
  'sLastName_',
  'sAddress1',
  'sPreDirection',
  'sAddress2',
  'sStreetT',
  'sName_Workclass',
  'sSqFeet',
  'AppDate',
  'sName',
  'ExpDate',
  'sPacelNum',
  'dtFinaled',
  'PermitType',
  'PERMIT_WEB',
].join(',')

function str(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s.length ? s : null
}

export function buildRowanAddress(attrs: Record<string, unknown>): string | null {
  const parts = [
    str(attrs.sAddress1),
    str(attrs.sPreDirection),
    str(attrs.sAddress2),
    str(attrs.sStreetT),
  ].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

function mapRowanAttributes(attrs: Record<string, unknown>): PermitRecord {
  const contractor = str(attrs.sCompanyName_Parc)
  const permitType = str(attrs.PermitType)
  const workclass = str(attrs.sName_Workclass)
  const typeName = str(attrs.TypeName)

  return {
    sourceJurisdiction: 'rowan-county',
    sourceCounty: 'Rowan',
    sourceUrl: `${ROWAN_LAYER_URL}/query`,
    permitNumber: str(attrs.sPermitNum),
    permitType,
    permitSubtype: workclass,
    issuedOn: parseArcGisDate(attrs.dIssued),
    description: [typeName, workclass].filter(Boolean).join(' — ') || null,
    address: buildRowanAddress(attrs),
    city: null,
    zip: null,
    pin: str(attrs.sPacelNum),
    // sName is permit status (Final/Active), not the applicant.
    applicant: [str(attrs.sFirstName_), str(attrs.sLastName_)].filter(Boolean).join(' ') || null,
    contractor,
    contractorKey: installerNameKey(contractor),
    ownerNamePermitEra: null,
    projectValue: null,
    latitude: null,
    longitude: null,
    detectedBy: Array.from(
      new Set([
        ...detectSolarInText(workclass, 'type'),
        ...detectSolarInText(typeName, 'type'),
      ]),
    ),
    isCommercial: /^COMMERCIAL$/i.test(permitType ?? ''),
    raw: attrs,
  }
}

export type RowanWorkclassCounts = {
  workclass: string
  count: number
}

export type RowanAuditResult = {
  workclassCounts: RowanWorkclassCounts[]
  electricalSolarPvCount: number
  samples: PermitRecord[]
}

export async function auditRowanArcgis(sampleCap = SAMPLE_CAP): Promise<RowanAuditResult> {
  process.stdout.write('  Rowan GIS Building_Permits/6… ')

  const workclassCounts: RowanWorkclassCounts[] = []
  for (const workclass of ROWAN_WORKCLASSES) {
    const where = `sName_Workclass = '${workclass}'`
    const count = await countArcGISFeatures(ROWAN_LAYER_URL, where)
    workclassCounts.push({ workclass, count })
  }

  const electricalSolarPvCount = await countArcGISFeatures(
    ROWAN_LAYER_URL,
    ROWAN_ELECTRICAL_SOLAR_PV_WHERE,
  )

  const samples: PermitRecord[] = []
  if (electricalSolarPvCount > 0) {
    const features = await fetchArcGISFeatures(
      ROWAN_LAYER_URL,
      ROWAN_ELECTRICAL_SOLAR_PV_WHERE,
      Math.min(sampleCap, electricalSolarPvCount),
      OUT_FIELDS,
    )
    for (const feature of features) {
      samples.push(mapRowanAttributes(feature.attributes))
    }
  }

  const totalSolar = workclassCounts.reduce((sum, w) => sum + w.count, 0)
  console.log(
    `${totalSolar} solar workclass (${electricalSolarPvCount} electrical Solar PV; ${samples.length} sampled)`,
  )

  return { workclassCounts, electricalSolarPvCount, samples }
}

export { SAMPLE_CAP as ROWAN_SAMPLE_CAP }

/** Full Rowan pull — Solar + Solar PV workclass. No Solar Water. */
export async function extractRowanPermits(): Promise<PermitRecord[]> {
  process.stdout.write('  Rowan GIS Building_Permits/6 (Solar + Solar PV)… ')
  const features = await fetchAllArcGISFeatures(ROWAN_LAYER_URL, ROWAN_PV_WHERE, OUT_FIELDS)
  console.log(`${features.length} permits`)
  return features.map((f) => mapRowanAttributes(f.attributes))
}
