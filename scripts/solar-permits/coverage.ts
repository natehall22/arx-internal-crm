#!/usr/bin/env node
/**
 * Coverage gap analysis from the existing extract (plus Cabarrus 2016–2018
 * historical layers discovered after the extract). No CRM ingest.
 *
 *   npx tsx scripts/solar-permits/coverage.ts
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { classifyPermitRecord, strongerPvClass, type PvClass } from './classify-pv'
import { propertyKey } from './dedupe'
import { EXTERNAL_SOURCES, JURISDICTION_ROWS } from './coverage-data'
import type { PermitRecord } from './schema'

const DATA_DIR = path.join(__dirname, 'data')
const YEARS = Array.from({ length: 16 }, (_, i) => 2011 + i)

type CoverageStatus =
  | 'ZERO_RECORDS'
  | 'NO_SOURCE_COVERAGE'
  | 'PARTIAL_SOURCE_COVERAGE'
  | 'FULL_SOURCE_COVERAGE'

type ClassifiedPermit = PermitRecord & { pvClass: PvClass; pvEvidence: string[] }

type PropertyRow = {
  sourceCounty: string
  pin: string | null
  address: string | null
  issuedOn: string | null
  year: number | null
  hasInstaller: boolean
  isCommercial: boolean
  pvClass: PvClass
  pvEvidence: string[]
  permitCount: number
  permitNumbers: string[]
  inCurrentExtract: boolean
}

function csvEscape(value: string | number | boolean | null | undefined): string {
  const s = value == null ? '' : String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toCsv(headers: string[], rows: Array<Record<string, string | number | boolean | null | undefined>>): string {
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','))
  }
  return `${lines.join('\n')}\n`
}

function issueYear(issuedOn: string | null | undefined): number | null {
  if (!issuedOn) return null
  const year = Number(String(issuedOn).slice(0, 4))
  return Number.isFinite(year) ? year : null
}

function parseArcDate(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10)
  }
  const s = String(value).trim()
  if (!s) return null
  const m = s.match(/^(\d{4})[./-](\d{2})[./-](\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s.slice(0, 10) : d.toISOString().slice(0, 10)
}

async function loadJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(DATA_DIR, name), 'utf8')) as T
}

function classifyRecords(records: PermitRecord[]): ClassifiedPermit[] {
  return records.map((record) => {
    const { pvClass, evidence } = classifyPermitRecord(record)
    return { ...record, pvClass, pvEvidence: evidence }
  })
}

function toProperties(records: ClassifiedPermit[], inCurrentExtract: boolean): PropertyRow[] {
  const groups = new Map<string, ClassifiedPermit[]>()
  for (const record of records) {
    const key = propertyKey(record)
    if (!key) continue
    const existing = groups.get(key)
    if (existing) existing.push(record)
    else groups.set(key, [record])
  }

  const rows: PropertyRow[] = []
  for (const group of Array.from(groups.values())) {
    let pvClass: PvClass = 'NON_PV'
    const evidence = new Set<string>()
    let issuedOn: string | null = null
    let hasInstaller = false
    const permitNumbers: string[] = []
    for (const record of group) {
      pvClass = strongerPvClass(pvClass, record.pvClass)
      for (const e of record.pvEvidence) evidence.add(e)
      if (record.issuedOn && (issuedOn == null || record.issuedOn < issuedOn)) issuedOn = record.issuedOn
      if (record.contractorKey) hasInstaller = true
      if (record.permitNumber) permitNumbers.push(record.permitNumber)
    }
    rows.push({
      sourceCounty: group[0].sourceCounty,
      pin: group[0].pin,
      address: group.find((r: ClassifiedPermit) => r.address)?.address ?? group[0].address,
      issuedOn,
      year: issueYear(issuedOn),
      hasInstaller,
      isCommercial: group.every((r: ClassifiedPermit) => r.isCommercial),
      pvClass,
      pvEvidence: Array.from(evidence),
      permitCount: group.length,
      permitNumbers,
      inCurrentExtract,
    })
  }
  return rows
}

function cabarrusHistoricalToRecords(byYear: Record<string, Array<Record<string, unknown>>>): PermitRecord[] {
  const records: PermitRecord[] = []
  for (const [year, rows] of Object.entries(byYear)) {
    for (const attrs of rows) {
      const contractor = (attrs.AppName as string | null) || (attrs.Applicant as string | null) || null
      records.push({
        sourceJurisdiction: 'cabarrus-county-historical',
        sourceCounty: 'Cabarrus',
        sourceUrl: `opendata/Historical_${year}/Permits`,
        permitNumber: (attrs.PermitNumber as string) ?? null,
        permitType: (attrs.PermitType as string) ?? null,
        permitSubtype: (attrs.PermitSubtype as string) ?? null,
        issuedOn: parseArcDate(attrs.IssueDate ?? attrs.FileDate),
        description: (attrs.DetailedDescription as string) ?? null,
        address: (attrs.Address as string) ?? null,
        city: null,
        zip: null,
        pin: (attrs.PIN14 as string) ?? null,
        applicant: (attrs.Applicant as string) ?? null,
        contractor: contractor ? String(contractor).trim() || null : null,
        contractorKey: contractor ? String(contractor).trim().toLowerCase() : null,
        ownerNamePermitEra: (attrs.OwnerName as string) ?? null,
        projectValue: null,
        latitude: null,
        longitude: null,
        detectedBy: ['description:solar'],
        isCommercial: /COMMERCIAL/i.test(`${attrs.PermitSubtype ?? ''} ${attrs.PermitType ?? ''}`),
        raw: {},
      })
    }
  }
  return records
}

function coverageStatus(
  county: string,
  year: number,
  raw: number,
  inExtract: boolean,
): { status: CoverageStatus; source: string; notes: string } {
  if (county === 'Cabarrus') {
    if (year <= 2015) {
      return {
        status: raw === 0 ? 'ZERO_RECORDS' : 'FULL_SOURCE_COVERAGE',
        source: 'opendata yearly Permits layers (2007–2015)',
        notes: inExtract ? 'in current extract' : 'layer exists',
      }
    }
    if (year >= 2016 && year <= 2018) {
      return {
        status: 'FULL_SOURCE_COVERAGE',
        source: `opendata/Historical_${year} Permits`,
        notes: inExtract ? 'in current extract' : 'discovered after extract; not in 7,312',
      }
    }
    return {
      status: 'NO_SOURCE_COVERAGE',
      source: 'none (Accela Citizen Access portal only; CAMA notes partial/no contractor)',
      notes: 'Do not read 0 as zero installs. County still issues permits for Concord/Kannapolis/Harrisburg.',
    }
  }
  if (county === 'Mecklenburg') {
    if (year <= 2023) {
      return {
        status: raw === 0 ? 'ZERO_RECORDS' : 'PARTIAL_SOURCE_COVERAGE',
        source: 'meckgis BuildingPermits FeatureServer/0 (no contractor names)',
        notes: 'County is the building/electrical AHJ for Charlotte and the towns. Address+PIN+dates yes; installer no.',
      }
    }
    return {
      status: raw === 0 ? 'ZERO_RECORDS' : 'PARTIAL_SOURCE_COVERAGE',
      source: 'EPIC Accela FeatureServer/1 SolarPV + residual BuildingPermits (no contractor names)',
      notes: 'SolarPV subtype is clean; legacy %SOLAR% still mixed.',
    }
  }
  // Rowan
  if (year < 2014) {
    return {
      status: raw === 0 ? 'ZERO_RECORDS' : 'PARTIAL_SOURCE_COVERAGE',
      source: 'GIS Building_Permits MapServer/6 (sparse before 2014)',
      notes: 'Workclass Solar/Solar PV exists but volume is thin before 2014.',
    }
  }
  return {
    status: raw === 0 ? 'ZERO_RECORDS' : 'FULL_SOURCE_COVERAGE',
    source: 'GIS Building_Permits MapServer/6 Solar + Solar PV',
    notes: 'County issues building/electrical for Salisbury and listed towns. Contractor ~32% of unique properties.',
  }
}

function countByClass(rows: PropertyRow[]): Record<PvClass, number> {
  const out: Record<PvClass, number> = {
    CONFIRMED_PV: 0,
    LIKELY_PV: 0,
    AMBIGUOUS_SOLAR: 0,
    NON_PV: 0,
  }
  for (const row of rows) out[row.pvClass] += 1
  return out
}

async function main(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })

  const cabarrus = await loadJson<PermitRecord[]>('permits-cabarrus.json')
  const meck = await loadJson<PermitRecord[]>('permits-mecklenburg.json')
  const rowan = await loadJson<PermitRecord[]>('permits-rowan.json')
  const historical = await loadJson<Record<string, Array<Record<string, unknown>>>>(
    'cabarrus-historical-2016-2018.json',
  )

  const extractPermits = classifyRecords([...cabarrus, ...meck, ...rowan])
  const extractProperties = toProperties(extractPermits, true)
  const historicalRecords = classifyRecords(cabarrusHistoricalToRecords(historical))
  const historicalProperties = toProperties(historicalRecords, false)

  const extractPins = new Set(
    extractProperties.filter((p) => p.sourceCounty === 'Cabarrus' && p.pin).map((p) => p.pin as string),
  )
  const historicalNew = historicalProperties.filter(
    (p) => p.sourceCounty === 'Cabarrus' && p.pin && !extractPins.has(p.pin),
  )

  const meckProps = extractProperties.filter((p) => p.sourceCounty === 'Mecklenburg' && !p.isCommercial)
  const meckClassCsv = toCsv(
    [
      'pin',
      'address',
      'issuedOn',
      'year',
      'pvClass',
      'evidence',
      'permitCount',
      'permitNumbers',
      'isCommercial',
    ],
    extractProperties
      .filter((p) => p.sourceCounty === 'Mecklenburg')
      .sort((a, b) => (a.issuedOn ?? '').localeCompare(b.issuedOn ?? ''))
      .map((p) => ({
        pin: p.pin,
        address: p.address,
        issuedOn: p.issuedOn,
        year: p.year,
        pvClass: p.pvClass,
        evidence: p.pvEvidence.join('|'),
        permitCount: p.permitCount,
        permitNumbers: p.permitNumbers.join('|'),
        isCommercial: p.isCommercial,
      })),
  )
  await writeFile(path.join(DATA_DIR, 'mecklenburg-pv-classification.csv'), meckClassCsv)

  const yearRows: Array<Record<string, string | number | boolean | null>> = []
  for (const county of ['Cabarrus', 'Mecklenburg', 'Rowan']) {
    for (const year of YEARS) {
      const permits = extractPermits.filter((r) => r.sourceCounty === county && issueYear(r.issuedOn) === year)
      const props = extractProperties.filter((p) => p.sourceCounty === county && p.year === year)
      const classes = countByClass(props)
      let raw = permits.length
      let unique = props.length
      let confirmed = classes.CONFIRMED_PV
      let likely = classes.LIKELY_PV
      let ambiguous = classes.AMBIGUOUS_SOLAR
      let nonPv = classes.NON_PV
      let installer = props.filter((p) => p.hasInstaller).length
      let inCurrentExtract = county !== 'Cabarrus' || year <= 2015 ? true : raw > 0

      if (county === 'Cabarrus' && year >= 2016 && year <= 2018) {
        const histPermits = historicalRecords.filter((r) => issueYear(r.issuedOn) === year)
        const histProps = historicalProperties.filter((p) => p.year === year)
        const histClasses = countByClass(histProps)
        raw = histPermits.length
        unique = histProps.length
        confirmed = histClasses.CONFIRMED_PV
        likely = histClasses.LIKELY_PV
        ambiguous = histClasses.AMBIGUOUS_SOLAR
        nonPv = histClasses.NON_PV
        installer = histProps.filter((p) => p.hasInstaller).length
        inCurrentExtract = false
      }

      const meta = coverageStatus(county, year, raw, inCurrentExtract)
      if (county === 'Cabarrus' && year >= 2019) {
        raw = 0
        unique = 0
        confirmed = 0
        likely = 0
        ambiguous = 0
        nonPv = 0
        installer = 0
        inCurrentExtract = false
      }

      yearRows.push({
        county,
        year,
        raw_solar_permits: meta.status === 'NO_SOURCE_COVERAGE' ? '' : raw,
        unique_pins: meta.status === 'NO_SOURCE_COVERAGE' ? '' : unique,
        confirmed_pv: meta.status === 'NO_SOURCE_COVERAGE' ? '' : confirmed,
        likely_pv: meta.status === 'NO_SOURCE_COVERAGE' ? '' : likely,
        ambiguous_pv: meta.status === 'NO_SOURCE_COVERAGE' ? '' : ambiguous,
        non_pv: meta.status === 'NO_SOURCE_COVERAGE' ? '' : nonPv,
        installer_populated: meta.status === 'NO_SOURCE_COVERAGE' ? '' : installer,
        source_dataset: meta.source,
        coverage_status: meta.status,
        in_current_extract: inCurrentExtract,
        notes: meta.notes,
      })
    }
  }
  await writeFile(
    path.join(DATA_DIR, 'coverage-by-year.csv'),
    toCsv(
      [
        'county',
        'year',
        'raw_solar_permits',
        'unique_pins',
        'confirmed_pv',
        'likely_pv',
        'ambiguous_pv',
        'non_pv',
        'installer_populated',
        'source_dataset',
        'coverage_status',
        'in_current_extract',
        'notes',
      ],
      yearRows,
    ),
  )

  await writeFile(
    path.join(DATA_DIR, 'jurisdiction-coverage.csv'),
    toCsv(
      [
        'county',
        'municipality',
        'permitting_authority',
        'county_or_city',
        'historical_years',
        'public_search',
        'bulk_source',
        'api',
        'solar_identifiable',
        'address_available',
        'parcel_available',
        'contractor_available',
        'currently_in_existing_extract',
        'potential_gap',
        'notes',
        'source_url',
      ],
      JURISDICTION_ROWS,
    ),
  )

  await writeFile(
    path.join(DATA_DIR, 'external-sources.csv'),
    toCsv(
      [
        'name',
        'url',
        'access_method',
        'geography',
        'has_address',
        'has_parcel',
        'has_zip',
        'has_county',
        'has_date',
        'has_installer',
        'has_capacity',
        'residential_focus',
        'usable_for_volume',
        'notes',
      ],
      EXTERNAL_SOURCES,
    ),
  )

  const extractClasses = countByClass(extractProperties)
  const extractRes = extractProperties.filter((p) => !p.isCommercial)
  const extractResClasses = countByClass(extractRes)
  const meckResClasses = countByClass(meckProps)
  const histNewClasses = countByClass(historicalNew)

  const stats = {
    extractUnique: extractProperties.length,
    extractResidential: extractRes.length,
    extractClasses,
    extractResClasses,
    meckResClasses,
    cabarrusExtract: extractProperties.filter((p) => p.sourceCounty === 'Cabarrus').length,
    cabarrusHistoricalNewPins: historicalNew.length,
    histNewClasses,
    rowanExtract: extractProperties.filter((p) => p.sourceCounty === 'Rowan').length,
    meckExtract: extractProperties.filter((p) => p.sourceCounty === 'Mecklenburg').length,
  }
  await writeFile(path.join(DATA_DIR, 'coverage-stats.json'), JSON.stringify(stats, null, 2))
  console.log(JSON.stringify(stats, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
