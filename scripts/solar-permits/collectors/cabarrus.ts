import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { installerNameKey } from '../../../lib/solar-installers'
import {
  countArcGISFeatures,
  fetchAllArcGISFeatures,
  fetchArcGISFeatures,
  parseArcGisDate,
} from '../arcgis'
import type {
  CabarrusYearStats,
  PermitRecord,
  SolarDetectionMethod,
} from '../schema'

export const CABARRUS_ARCGIS_BASE =
  'https://location.cabarruscounty.us/arcgisservices/rest/services/opendata/MapServer'

export const CABARRUS_SOLAR_WHERE = "UPPER(DetailedDescription) LIKE '%SOLAR%'"

export const CABARRUS_CAMA_CSV_URL =
  'https://cabarruscountync.sharepoint.com/:x:/g/CabarrusCounty/ERNqFGtfcaxKrHNrgdKaTaoBBgVAADJsQVXPezRfkYQ6Xw?e=HJ0xjl&download=1'

export const CABARRUS_YEAR_LAYERS: Array<{
  year: number
  layerId: number
  contractorField: 'AppName' | 'Applicant'
}> = [
  { year: 2015, layerId: 33, contractorField: 'AppName' },
  { year: 2014, layerId: 61, contractorField: 'Applicant' },
  { year: 2013, layerId: 71, contractorField: 'Applicant' },
  { year: 2012, layerId: 87, contractorField: 'Applicant' },
  { year: 2011, layerId: 103, contractorField: 'Applicant' },
  { year: 2010, layerId: 111, contractorField: 'Applicant' },
  { year: 2009, layerId: 138, contractorField: 'Applicant' },
  { year: 2008, layerId: 131, contractorField: 'Applicant' },
  { year: 2007, layerId: 128, contractorField: 'Applicant' },
]

/** Accela-era yearly snapshots that still include a Permits layer. 2019+ do not. */
export const CABARRUS_HISTORICAL_PERMIT_LAYERS: Array<{
  year: number
  url: string
  contractorField: 'AppName' | 'Applicant'
}> = [
  {
    year: 2016,
    url: 'https://location.cabarruscounty.us/arcgisservices/rest/services/opendata/Historical_2016/MapServer/0',
    contractorField: 'AppName',
  },
  {
    year: 2017,
    url: 'https://location.cabarruscounty.us/arcgisservices/rest/services/opendata/Historical_2017/MapServer/16',
    contractorField: 'AppName',
  },
  {
    year: 2018,
    url: 'https://location.cabarruscounty.us/arcgisservices/rest/services/opendata/Historical_2018/MapServer/0',
    contractorField: 'AppName',
  },
]

const SAMPLE_CAP = 25

function layerUrl(layerId: number): string {
  return `${CABARRUS_ARCGIS_BASE}/${layerId}`
}

function str(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s.length ? s : null
}

function normalizePermitNumber(value: string | null): string | null {
  if (!value) return null
  return value.replace(/^BU/i, '').trim()
}

function isCommercialSubtype(subtype: string | null, permitType: string | null): boolean {
  const hay = `${subtype ?? ''} ${permitType ?? ''}`.toUpperCase()
  return hay.includes('COMMERCIAL')
}

export function detectSolarInText(
  text: string | null,
  prefix: 'description' | 'type' | 'notes',
): SolarDetectionMethod[] {
  if (!text) return []
  const upper = text.toUpperCase()
  const hits: SolarDetectionMethod[] = []
  if (upper.includes('SOLAR PANEL')) hits.push(`${prefix}:solar panel`)
  if (upper.includes('PHOTOVOLTAIC')) hits.push(`${prefix}:photovoltaic`)
  if (/\bPV\b/.test(upper)) hits.push(`${prefix}:pv`)
  if (upper.includes('SOLAR')) hits.push(`${prefix}:solar`)
  return hits
}

function mapArcgisAttributes(
  attrs: Record<string, unknown>,
  sourceUrl: string,
  contractorField: 'AppName' | 'Applicant',
): PermitRecord {
  const contractor = str(attrs[contractorField])
  const applicant =
    contractorField === 'Applicant' ? contractor : str(attrs.Applicant)
  const description = str(attrs.DetailedDescription)
  const permitType = str(attrs.PermitType)
  const permitSubtype = str(attrs.PermitSubtype)
  const detectedBy = [
    ...detectSolarInText(description, 'description'),
    ...detectSolarInText(permitType, 'type'),
    ...detectSolarInText(permitSubtype, 'type'),
  ]
  const contractorForKey = contractor ?? applicant

  return {
    sourceJurisdiction: 'cabarrus-county',
    sourceCounty: 'Cabarrus',
    sourceUrl: `${sourceUrl}/query`,
    permitNumber: str(attrs.PermitNumber),
    permitType,
    permitSubtype,
    issuedOn: parseArcGisDate(attrs.IssueDate) ?? parseArcGisDate(attrs.FileDate),
    description,
    address: str(attrs.Address),
    city: null,
    zip: null,
    pin: str(attrs.PIN14),
    applicant,
    contractor,
    contractorKey: installerNameKey(contractorForKey),
    ownerNamePermitEra: str(attrs.OwnerName),
    projectValue: null,
    latitude: null,
    longitude: null,
    detectedBy: Array.from(new Set(detectedBy)),
    isCommercial: isCommercialSubtype(permitSubtype, permitType),
    raw: attrs,
  }
}

async function countElectricalSubtype(
  layerId: number,
  totalSolar: number,
): Promise<number | null> {
  if (totalSolar === 0) return 0
  const where = `${CABARRUS_SOLAR_WHERE} AND UPPER(PermitSubtype) LIKE '%ELECTRICAL%'`
  try {
    return await countArcGISFeatures(layerUrl(layerId), where)
  } catch {
    return null
  }
}

async function countCommercial(layerId: number): Promise<number> {
  const where = `${CABARRUS_SOLAR_WHERE} AND UPPER(PermitSubtype) LIKE '%COMMERCIAL%'`
  try {
    return await countArcGISFeatures(layerUrl(layerId), where)
  } catch {
    return 0
  }
}

export type CabarrusArcgisAuditResult = {
  yearStats: CabarrusYearStats[]
  samples: PermitRecord[]
}

export async function auditCabarrusArcgis(sampleCap = SAMPLE_CAP): Promise<CabarrusArcgisAuditResult> {
  const yearStats: CabarrusYearStats[] = []
  const samples: PermitRecord[] = []

  for (const layer of CABARRUS_YEAR_LAYERS) {
    const url = layerUrl(layer.layerId)
    process.stdout.write(`  Cabarrus ArcGIS ${layer.year} (layer ${layer.layerId})… `)

    const totalSolarMatches = await countArcGISFeatures(url, CABARRUS_SOLAR_WHERE)
    const electricalSubtypeCount = await countElectricalSubtype(layer.layerId, totalSolarMatches)
    const commercialCount = await countCommercial(layer.layerId)

    let sampleCount = 0
    if (totalSolarMatches > 0) {
      const features = await fetchArcGISFeatures(
        url,
        CABARRUS_SOLAR_WHERE,
        Math.min(sampleCap, totalSolarMatches),
      )
      for (const feature of features) {
        samples.push(mapArcgisAttributes(feature.attributes, url, layer.contractorField))
      }
      sampleCount = features.length
    }

    yearStats.push({
      year: layer.year,
      layerId: layer.layerId,
      totalSolarMatches,
      electricalSubtypeCount,
      commercialCount,
      sampleCount,
    })

    console.log(`${totalSolarMatches} solar (${sampleCount} sampled)`)
  }

  return { yearStats, samples }
}

/** Full Cabarrus ArcGIS pull — every SOLAR match across yearly layers. No CAMA. */
export async function extractCabarrusPermits(): Promise<PermitRecord[]> {
  const records: PermitRecord[] = []

  for (const layer of CABARRUS_YEAR_LAYERS) {
    const url = layerUrl(layer.layerId)
    process.stdout.write(`  Cabarrus ${layer.year} (layer ${layer.layerId})… `)
    const features = await fetchAllArcGISFeatures(url, CABARRUS_SOLAR_WHERE, '*')
    for (const feature of features) {
      records.push(mapArcgisAttributes(feature.attributes, url, layer.contractorField))
    }
    console.log(`${features.length} permits`)
  }

  return records
}

/** Cabarrus Historical_2016–2018 Permits layers. Does not replace the 2007–2015 yearly extract. */
export async function extractCabarrusHistoricalPermits(): Promise<PermitRecord[]> {
  const records: PermitRecord[] = []

  for (const layer of CABARRUS_HISTORICAL_PERMIT_LAYERS) {
    process.stdout.write(`  Cabarrus Historical ${layer.year}… `)
    const features = await fetchAllArcGISFeatures(layer.url, CABARRUS_SOLAR_WHERE, '*')
    for (const feature of features) {
      records.push(mapArcgisAttributes(feature.attributes, layer.url, layer.contractorField))
    }
    console.log(`${features.length} permits`)
  }

  return records
}

/** Strip Excel-style formula quoting: ="12345" → 12345 */
export function unwrapExcelCell(value: string): string {
  const trimmed = value.trim()
  const m = trimmed.match(/^="(.*)"$/)
  if (m) return m[1]
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

function mapCamaRow(row: Record<string, string>): PermitRecord | null {
  const notes = row.PermitNotes ?? null
  const workType = row.WorkType ?? null
  const permitType = row.PermitType ?? null
  const detectedBy = [
    ...detectSolarInText(notes, 'notes'),
    ...detectSolarInText(workType, 'type'),
    ...detectSolarInText(permitType, 'type'),
  ]
  if (detectedBy.length === 0) return null

  const amountRaw = row.PermitAmount?.replace(/[$,]/g, '')
  const projectValue = amountRaw && !Number.isNaN(Number(amountRaw)) ? Number(amountRaw) : null

  return {
    sourceJurisdiction: 'cabarrus-county',
    sourceCounty: 'Cabarrus',
    sourceUrl: CABARRUS_CAMA_CSV_URL,
    permitNumber: row.PermitNumber ?? null,
    permitType,
    permitSubtype: workType,
    issuedOn: row.PermitDate ?? null,
    description: notes,
    address: null,
    city: null,
    zip: null,
    pin: row.ParcelNumber ?? row.ParcelID ?? null,
    applicant: null,
    contractor: null,
    contractorKey: null,
    ownerNamePermitEra: null,
    projectValue,
    latitude: null,
    longitude: null,
    detectedBy: Array.from(new Set(detectedBy)),
    isCommercial: isCommercialSubtype(workType, permitType),
    raw: row,
  }
}

export async function downloadCabarrusCamaCsv(destPath: string): Promise<void> {
  await mkdir(path.dirname(destPath), { recursive: true })
  const res = await fetch(CABARRUS_CAMA_CSV_URL, {
    headers: { 'User-Agent': 'ARX-permit-audit/0.1' },
    redirect: 'follow',
  })
  if (!res.ok) {
    throw new Error(`CAMA CSV download failed: HTTP ${res.status}`)
  }

  await writeFile(destPath, Buffer.from(await res.arrayBuffer()))
}

export async function parseCabarrusCamaCsv(filePath: string): Promise<PermitRecord[]> {
  const text = await readFile(filePath, 'utf8')
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0]).map(unwrapExcelCell)
  const records: PermitRecord[] = []

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]).map(unwrapExcelCell)
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? ''
    })
    const mapped = mapCamaRow(row)
    if (mapped) records.push(mapped)
  }

  return records
}

export function joinArcgisAndCama(
  arcgis: PermitRecord[],
  cama: PermitRecord[],
): Array<{ arcgis: PermitRecord; cama: PermitRecord | null }> {
  const camaByNumber = new Map<string, PermitRecord>()
  for (const row of cama) {
    const key = normalizePermitNumber(row.permitNumber)
    if (key) camaByNumber.set(key, row)
  }

  return arcgis.map((a) => {
    const key = normalizePermitNumber(a.permitNumber)
    return { arcgis: a, cama: key ? camaByNumber.get(key) ?? null : null }
  })
}

export { normalizePermitNumber, SAMPLE_CAP }
