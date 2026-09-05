#!/usr/bin/env node
/**
 * Solar permit source audit — probes open bulk paths and writes local coverage artifacts.
 *
 * Usage:
 *   npx tsx scripts/solar-permits/audit.ts
 *   npx tsx scripts/solar-permits/audit.ts --with-cama
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  auditCabarrusArcgis,
  downloadCabarrusCamaCsv,
  parseCabarrusCamaCsv,
} from './collectors/cabarrus'
import { auditMecklenburgArcgis } from './collectors/mecklenburg'
import { auditRowanArcgis } from './collectors/rowan'
import { blankCoverageRows } from './sources'
import type { AuditOutput, JurisdictionCoverage, PermitRecord } from './schema'

const DATA_DIR = path.join(__dirname, 'data')
const WITH_CAMA = process.argv.includes('--with-cama')

type MatrixCell = 'Yes' | 'Partial' | 'No' | 'Unknown'

type MatrixRow = {
  county: string
  years: string
  bulkSource: string
  solarSearchable: MatrixCell
  address: MatrixCell
  pin: MatrixCell
  contractor: MatrixCell
  recordsRequestNeeded: MatrixCell
}

const MATRIX_HEADERS = [
  'County',
  'Years',
  'Bulk source',
  'Solar searchable',
  'Address',
  'PIN',
  'Contractor',
  'Records request needed',
] as const

/** Static field-availability matrix (honest Yes/Partial/No). Live counts come from collectors. */
const STATIC_MATRIX: MatrixRow[] = [
  {
    county: 'Cabarrus',
    years: '2007–2015 ArcGIS; CAMA ~1986–2025',
    bulkSource: 'ArcGIS yearly layers + CAMA CSV',
    solarSearchable: 'Yes',
    address: 'Yes',
    pin: 'Yes',
    contractor: 'Partial',
    recordsRequestNeeded: 'No', // 2011–15 ArcGIS is enough for Phase 1; 2016+ installer names would still need PRA
  },
  {
    county: 'Mecklenburg',
    years: '1997–2023 BuildingPermits; 2024–present Accela SolarPV',
    bulkSource: 'meckgis BuildingPermits + EPIC Accela SolarPV',
    solarSearchable: 'Yes',
    address: 'Yes',
    pin: 'Yes',
    contractor: 'No',
    recordsRequestNeeded: 'Partial',
  },
  {
    county: 'Rowan',
    years: '2014–2026 (Electrical Solar PV sampled)',
    bulkSource: 'ArcGIS Building_Permits MapServer/6',
    solarSearchable: 'Yes',
    address: 'Yes',
    pin: 'Yes',
    contractor: 'Partial',
    recordsRequestNeeded: 'Partial',
  },
  {
    county: 'Union',
    years: 'Unknown',
    bulkSource: 'None (Evolve portal only)',
    solarSearchable: 'Unknown',
    address: 'Unknown',
    pin: 'Unknown',
    contractor: 'Unknown',
    recordsRequestNeeded: 'Yes',
  },
  {
    county: 'Gaston',
    years: 'Unknown',
    bulkSource: 'None (EnerGov GIS token-gated; Gastonia building is county since 2022-08-29; Kings Mountain separate)',
    solarSearchable: 'Unknown',
    address: 'Unknown',
    pin: 'Unknown',
    contractor: 'Unknown',
    recordsRequestNeeded: 'Yes',
  },
  {
    county: 'Iredell',
    years: 'Unknown',
    bulkSource: 'None (EnerGov CSS; Mooresville GeoCivix separate)',
    solarSearchable: 'Unknown',
    address: 'Unknown',
    pin: 'Unknown',
    contractor: 'Unknown',
    recordsRequestNeeded: 'Yes',
  },
  {
    county: 'Lincoln',
    years: 'Unknown',
    bulkSource: 'None (eTRAKiT search only; GIS has no permit layers)',
    solarSearchable: 'Unknown',
    address: 'Unknown',
    pin: 'Unknown',
    contractor: 'Unknown',
    recordsRequestNeeded: 'Yes',
  },
]

function csvEscape(value: string | number | boolean | null | undefined): string {
  if (value == null) return ''
  const s = String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function recordsToCsv(records: PermitRecord[]): string {
  const headers = [
    'sourceJurisdiction',
    'sourceCounty',
    'permitNumber',
    'permitType',
    'permitSubtype',
    'issuedOn',
    'description',
    'address',
    'pin',
    'applicant',
    'contractor',
    'contractorKey',
    'ownerNamePermitEra',
    'isCommercial',
    'detectedBy',
  ]
  const lines = [headers.join(',')]
  for (const r of records) {
    lines.push(
      [
        r.sourceJurisdiction,
        r.sourceCounty,
        r.permitNumber,
        r.permitType,
        r.permitSubtype,
        r.issuedOn,
        r.description,
        r.address,
        r.pin,
        r.applicant,
        r.contractor,
        r.contractorKey,
        r.ownerNamePermitEra,
        r.isCommercial,
        r.detectedBy.join('|'),
      ]
        .map(csvEscape)
        .join(','),
    )
  }
  return lines.join('\n')
}

function matrixToCsv(rows: MatrixRow[]): string {
  const lines = [MATRIX_HEADERS.join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.county,
        row.years,
        row.bulkSource,
        row.solarSearchable,
        row.address,
        row.pin,
        row.contractor,
        row.recordsRequestNeeded,
      ]
        .map(csvEscape)
        .join(','),
    )
  }
  return lines.join('\n')
}

function matrixToMarkdown(rows: MatrixRow[]): string {
  const header = `| ${MATRIX_HEADERS.join(' | ')} |`
  const separator = `| ${MATRIX_HEADERS.map(() => '---').join(' | ')} |`
  const body = rows.map(
    (row) =>
      `| ${row.county} | ${row.years} | ${row.bulkSource} | ${row.solarSearchable} | ${row.address} | ${row.pin} | ${row.contractor} | ${row.recordsRequestNeeded} |`,
  )
  return [header, separator, ...body].join('\n')
}

function printCoverageTable(rows: JurisdictionCoverage[]): void {
  const cols = ['County', 'Access', 'Solar count', 'Samples', 'Bulk source']
  const widths = [12, 14, 12, 10, 48]

  const pad = (s: string, w: number) => s.slice(0, w).padEnd(w)

  console.log('')
  console.log('Solar permit source coverage')
  console.log('─'.repeat(widths.reduce((a, b) => a + b + 2, 0)))
  console.log(cols.map((c, i) => pad(c, widths[i])).join('  '))
  console.log('─'.repeat(widths.reduce((a, b) => a + b + 2, 0)))

  for (const row of rows) {
    console.log(
      [
        pad(row.county, widths[0]),
        pad(row.access, widths[1]),
        pad(row.solarPermitCount != null ? String(row.solarPermitCount) : '—', widths[2]),
        pad(row.sampleCount != null ? String(row.sampleCount) : '—', widths[3]),
        pad((row.bulkSource ?? row.notes).slice(0, widths[4]), widths[4]),
      ].join('  '),
    )
  }
  console.log('')
}

function printSampleSummary(label: string, samples: PermitRecord[]): void {
  const withAddress = samples.filter((s) => s.address)
  const withPin = samples.filter((s) => s.pin)
  const withContractor = samples.filter((s) => s.contractor)
  console.log('')
  console.log(`${label}: ${samples.length} samples (${withAddress.length} with address, ${withPin.length} with PIN, ${withContractor.length} with contractor)`)
  if (samples.length > 0) {
    for (const s of samples.slice(0, 5)) {
      console.log(
        `  ${s.permitNumber ?? '?'} — ${s.address ?? '(no address)'} — PIN ${s.pin ?? '?'} — ${s.contractor ?? '(no contractor)'}`,
      )
    }
  }
}

async function main(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })

  const now = new Date().toISOString()
  const jurisdictions = blankCoverageRows()

  console.log('Running Cabarrus ArcGIS solar permit audit (live)…')
  const { yearStats, samples: cabarrusSamples } = await auditCabarrusArcgis()

  const cabarrusTotal = yearStats.reduce((sum, y) => sum + y.totalSolarMatches, 0)
  const cabarrusIdx = jurisdictions.findIndex((j) => j.id === 'cabarrus-county')
  if (cabarrusIdx >= 0) {
    jurisdictions[cabarrusIdx] = {
      ...jurisdictions[cabarrusIdx],
      solarPermitCount: cabarrusTotal,
      sampleCount: cabarrusSamples.length,
      yearsAvailable: '2007–2015 (ArcGIS yearly layers); CAMA CSV ~1986–2025',
      lastAuditedAt: now,
    }
  }

  console.log('Running Mecklenburg GIS solar permit audit (live)…')
  const {
    legacySolarCount: meckLegacyCount,
    accelaSolarPvCount: meckAccelaCount,
    samples: meckSamples,
  } = await auditMecklenburgArcgis()
  const meckSolarCount = meckLegacyCount + meckAccelaCount

  const meckIdx = jurisdictions.findIndex((j) => j.id === 'mecklenburg-county')
  if (meckIdx >= 0) {
    jurisdictions[meckIdx] = {
      ...jurisdictions[meckIdx],
      solarPermitCount: meckSolarCount,
      sampleCount: meckSamples.length,
      yearsAvailable: '1997–2023 BuildingPermits; 2024–present Accela SolarPV',
      lastAuditedAt: now,
    }
  }

  console.log('Running Rowan GIS solar permit audit (live)…')
  const {
    workclassCounts,
    electricalSolarPvCount,
    samples: rowanSamples,
  } = await auditRowanArcgis()

  const rowanTotal = workclassCounts.reduce((sum, w) => sum + w.count, 0)
  const rowanIdx = jurisdictions.findIndex((j) => j.id === 'rowan-county')
  if (rowanIdx >= 0) {
    jurisdictions[rowanIdx] = {
      ...jurisdictions[rowanIdx],
      solarPermitCount: rowanTotal,
      sampleCount: rowanSamples.length,
      yearsAvailable: '2014–2026 (Electrical Solar PV on GIS layer)',
      lastAuditedAt: now,
    }
  }

  let camaSamples: PermitRecord[] = []
  let camaSolarCount: number | undefined

  if (WITH_CAMA) {
    const camaPath = path.join(DATA_DIR, 'cabarrus-cama-permit.csv')
    console.log('Downloading Cabarrus CAMA Real Property Permit CSV…')
    try {
      await downloadCabarrusCamaCsv(camaPath)
      camaSamples = await parseCabarrusCamaCsv(camaPath)
      camaSolarCount = camaSamples.length
      await writeFile(
        path.join(DATA_DIR, 'cabarrus-cama-solar.json'),
        JSON.stringify(camaSamples.slice(0, 50), null, 2),
      )
      console.log(`  CAMA: ${camaSolarCount} solar-ish rows parsed`)
    } catch (err) {
      console.warn('  CAMA download/parse skipped:', (err as Error).message)
    }
  } else {
    console.log('Skipping CAMA CSV (pass --with-cama to download ~9.3MB SharePoint export)')
  }

  const auditOutput: AuditOutput = {
    generatedAt: now,
    jurisdictions,
    cabarrus: {
      arcgisCounts: yearStats,
      ...(camaSolarCount != null ? { camaSolarCount } : {}),
    },
    mecklenburg: {
      legacySolarCount: meckLegacyCount,
      accelaSolarPvCount: meckAccelaCount,
    },
    rowan: { workclassCounts, electricalSolarPvCount },
  }

  await writeFile(path.join(DATA_DIR, 'coverage.json'), JSON.stringify(auditOutput, null, 2))
  await writeFile(
    path.join(DATA_DIR, 'cabarrus-arcgis-samples.json'),
    JSON.stringify(cabarrusSamples, null, 2),
  )
  await writeFile(
    path.join(DATA_DIR, 'cabarrus-arcgis-counts.json'),
    JSON.stringify(yearStats, null, 2),
  )
  await writeFile(
    path.join(DATA_DIR, 'mecklenburg-samples.json'),
    JSON.stringify(meckSamples, null, 2),
  )
  await writeFile(path.join(DATA_DIR, 'rowan-samples.json'), JSON.stringify(rowanSamples, null, 2))
  await writeFile(path.join(DATA_DIR, 'samples.csv'), recordsToCsv(cabarrusSamples))
  await writeFile(path.join(DATA_DIR, 'matrix.csv'), matrixToCsv(STATIC_MATRIX))
  await writeFile(path.join(DATA_DIR, 'matrix.md'), matrixToMarkdown(STATIC_MATRIX))

  console.log('')
  console.log('Cabarrus ArcGIS solar counts by year:')
  for (const y of yearStats) {
    const elec =
      y.electricalSubtypeCount != null ? `, ${y.electricalSubtypeCount} electrical` : ''
    const comm = y.commercialCount ? `, ${y.commercialCount} commercial` : ''
    console.log(`  ${y.year}: ${y.totalSolarMatches} total${elec}${comm}`)
  }

  console.log('')
  console.log(
    `Mecklenburg: ${meckLegacyCount} legacy BuildingPermits SOLAR + ${meckAccelaCount} Accela SolarPV`,
  )
  console.log(`Rowan GIS workclass counts:`)
  for (const w of workclassCounts) {
    console.log(`  ${w.workclass}: ${w.count}`)
  }
  console.log(`  Electrical Solar PV: ${electricalSolarPvCount}`)

  printSampleSummary('Cabarrus', cabarrusSamples)
  printSampleSummary('Mecklenburg', meckSamples)
  printSampleSummary('Rowan', rowanSamples)

  printCoverageTable(jurisdictions)

  console.log(`Artifacts: ${DATA_DIR}/`)
  console.log(
    '  coverage.json, matrix.csv, matrix.md, cabarrus-arcgis-counts.json, cabarrus-arcgis-samples.json, mecklenburg-samples.json, rowan-samples.json, samples.csv',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
