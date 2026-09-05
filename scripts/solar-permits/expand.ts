#!/usr/bin/env node
/**
 * Expand the existing local extract with Cabarrus Historical_2016–2018.
 * Does not overwrite permits-cabarrus.json / unique-properties.json.
 *
 *   npm run solar-permits:expand
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { classifyPermitRecord, strongerPvClass, type PvClass } from './classify-pv'
import { extractCabarrusHistoricalPermits } from './collectors/cabarrus'
import { dedupePermitsByProperty, normalizePin, propertyKey } from './dedupe'
import { installerFrequency } from './installer-frequency'
import type { PermitRecord, UniqueProperty } from './schema'

const DATA_DIR = path.join(__dirname, 'data')
const ORIGINAL_FILES = [
  'permits-cabarrus.json',
  'permits-mecklenburg.json',
  'permits-rowan.json',
] as const

type ExpandedProperty = UniqueProperty & { pvClass: PvClass; pvEvidence: string }

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

function stripRaw(records: PermitRecord[]): PermitRecord[] {
  return records.map((record) => ({ ...record, raw: {} }))
}

async function loadJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(DATA_DIR, name), 'utf8')) as T
}

function classifyProperties(records: PermitRecord[], properties: UniqueProperty[]): ExpandedProperty[] {
  const byKey = new Map<string, PermitRecord[]>()
  for (const record of records) {
    const key = propertyKey(record)
    if (!key) continue
    const existing = byKey.get(key)
    if (existing) existing.push(record)
    else byKey.set(key, [record])
  }

  return properties.map((property) => {
    const group = byKey.get(property.propertyKey) ?? []
    let pvClass: PvClass = 'NON_PV'
    const evidence = new Set<string>()
    for (const record of group) {
      const classified = classifyPermitRecord(record)
      pvClass = strongerPvClass(pvClass, classified.pvClass)
      for (const item of classified.evidence) evidence.add(item)
    }
    return { ...property, pvClass, pvEvidence: Array.from(evidence).join('|') }
  })
}

function yearOf(issuedOn: string | null | undefined): string {
  return issuedOn ? issuedOn.slice(0, 4) : 'unknown'
}

function countByYear(rows: Array<{ issuedOn: string | null }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) {
    const year = yearOf(row.issuedOn)
    out[year] = (out[year] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort())
}

async function main(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })

  const original: PermitRecord[] = []
  for (const file of ORIGINAL_FILES) {
    original.push(...(await loadJson<PermitRecord[]>(file)))
  }

  console.log('Cabarrus Historical 2016–2018 (original extract left in place)\n')
  const historical = await extractCabarrusHistoricalPermits()
  await writeFile(
    path.join(DATA_DIR, 'permits-cabarrus-2016-2018.json'),
    JSON.stringify(stripRaw(historical), null, 2),
  )

  const asOfYear = new Date().getFullYear()
  const originalCabarrus = original.filter((r) => r.sourceCounty === 'Cabarrus')
  const originalDedupe = dedupePermitsByProperty(original, asOfYear)
  const originalCabarrusProps = originalDedupe.properties.filter((p) => p.sourceCounty === 'Cabarrus')
  const originalPins = new Set(
    originalCabarrusProps.map((p) => normalizePin(p.pin)).filter((pin): pin is string => Boolean(pin)),
  )

  const historicalDedupe = dedupePermitsByProperty(historical, asOfYear)
  const historicalPins = new Set(
    historicalDedupe.properties.map((p) => normalizePin(p.pin)).filter((pin): pin is string => Boolean(pin)),
  )
  const overlapPins = Array.from(historicalPins).filter((pin) => originalPins.has(pin))
  const newPins = Array.from(historicalPins).filter((pin) => !originalPins.has(pin))

  const combined = [...original, ...historical]
  const expanded = dedupePermitsByProperty(combined, asOfYear)
  const classified = classifyProperties(combined, expanded.properties)
  const classifiedOriginal = classifyProperties(original, originalDedupe.properties)
  const classifiedHistorical = classifyProperties(historical, historicalDedupe.properties)

  const newProperties = classified.filter((p) => {
    const pin = normalizePin(p.pin)
    return p.sourceCounty === 'Cabarrus' && pin != null && newPins.includes(pin)
  })

  await writeFile(path.join(DATA_DIR, 'unique-properties-expanded.json'), JSON.stringify(classified, null, 2))
  await writeFile(
    path.join(DATA_DIR, 'unique-properties-expanded.csv'),
    toCsv(
      [
        'county',
        'pin',
        'address',
        'city',
        'zip',
        'issuedOn',
        'yearsSinceInstall',
        'contractor',
        'hasInstaller',
        'isCommercial',
        'pvClass',
        'permitCount',
        'permitNumbers',
        'propertyKey',
      ],
      classified.map((p) => ({
        county: p.sourceCounty,
        pin: p.pin,
        address: p.address,
        city: p.city,
        zip: p.zip,
        issuedOn: p.issuedOn,
        yearsSinceInstall: p.yearsSinceInstall,
        contractor: p.contractor,
        hasInstaller: p.hasInstaller,
        isCommercial: p.isCommercial,
        pvClass: p.pvClass,
        permitCount: p.permitCount,
        permitNumbers: p.permitNumbers.join('|'),
        propertyKey: p.propertyKey,
      })),
    ),
  )

  const freq = installerFrequency(combined)
  await writeFile(
    path.join(DATA_DIR, 'installer-frequency.csv'),
    toCsv(
      [
        'normalizedInstaller',
        'rawNameVariants',
        'propertyCount',
        'permitCount',
        'firstPermitDate',
        'lastPermitDate',
        'counties',
      ],
      freq.map((row) => ({
        normalizedInstaller: row.normalizedInstaller,
        rawNameVariants: row.rawNameVariants.join(' | '),
        propertyCount: row.propertyCount,
        permitCount: row.permitCount,
        firstPermitDate: row.firstPermitDate,
        lastPermitDate: row.lastPermitDate,
        counties: row.counties.join('|'),
      })),
    ),
  )

  const histRes = classifiedHistorical.filter((p) => !p.isCommercial)
  const newRes = newProperties.filter((p) => !p.isCommercial)
  const histWithInstaller = classifiedHistorical.filter((p) => p.hasInstaller)
  const newWithInstaller = newProperties.filter((p) => p.hasInstaller)

  const topInstallers = installerFrequency(historical)
    .slice(0, 15)
    .map((row) => `- ${row.normalizedInstaller}: ${row.propertyCount} properties (${row.rawNameVariants.join('; ')})`)

  const yearRaw = countByYear(historical)
  const yearUnique = countByYear(classifiedHistorical)

  const classCount = (rows: ExpandedProperty[]) => ({
    CONFIRMED_PV: rows.filter((p) => p.pvClass === 'CONFIRMED_PV').length,
    LIKELY_PV: rows.filter((p) => p.pvClass === 'LIKELY_PV').length,
    AMBIGUOUS_SOLAR: rows.filter((p) => p.pvClass === 'AMBIGUOUS_SOLAR').length,
    NON_PV: rows.filter((p) => p.pvClass === 'NON_PV').length,
  })

  const expandedClasses = classCount(classified)
  const originalClasses = classCount(classifiedOriginal)

  const summary = [
    '# Cabarrus 2016–2018 historical GIS extract',
    '',
    `Generated ${new Date().toISOString()}. Original 2007–2015 extract files were not overwritten.`,
    '',
    '## Added from Historical_2016 / 2017 / 2018',
    '',
    `| Metric | Count |`,
    `|---|---:|`,
    `| Raw permits added | ${historical.length} |`,
    `| Unique PINs in 2016–2018 layers | ${historicalDedupe.properties.length} |`,
    `| Overlap with 2011–2015 extract PINs | ${overlapPins.length} |`,
    `| **Unique properties added** (new PINs) | **${newProperties.length}** |`,
    `| Residential properties added | ${newRes.length} |`,
    `| New properties with installer | ${newWithInstaller.length} |`,
    `| 2016–2018 unique with installer (incl. overlap) | ${histWithInstaller.length} |`,
    '',
    '## Year distribution (2016–2018 layers)',
    '',
    '| Year | Raw permits | Unique PINs |',
    '|---|---:|---:|',
    ...Object.keys({ ...yearRaw, ...yearUnique })
      .sort()
      .map((year) => `| ${year} | ${yearRaw[year] ?? 0} | ${yearUnique[year] ?? 0} |`),
    '',
    '## PV class on newly added properties',
    '',
    `- CONFIRMED_PV: ${newProperties.filter((p) => p.pvClass === 'CONFIRMED_PV').length}`,
    `- LIKELY_PV: ${newProperties.filter((p) => p.pvClass === 'LIKELY_PV').length}`,
    `- AMBIGUOUS_SOLAR: ${newProperties.filter((p) => p.pvClass === 'AMBIGUOUS_SOLAR').length}`,
    `- NON_PV: ${newProperties.filter((p) => p.pvClass === 'NON_PV').length}`,
    '',
    '## Top installer names (2016–2018 rows, formatting variants collapsed)',
    '',
    ...topInstallers,
    '',
    '## Expanded three-county file',
    '',
    `| | Original extract | After 2016–2018 |`,
    `|---|---:|---:|`,
    `| Unique properties | ${originalDedupe.properties.length} | ${classified.length} |`,
    `| CONFIRMED_PV | ${originalClasses.CONFIRMED_PV} | ${expandedClasses.CONFIRMED_PV} |`,
    `| LIKELY_PV | ${originalClasses.LIKELY_PV} | ${expandedClasses.LIKELY_PV} |`,
    `| AMBIGUOUS_SOLAR | ${originalClasses.AMBIGUOUS_SOLAR} | ${expandedClasses.AMBIGUOUS_SOLAR} |`,
    `| With installer | ${originalDedupe.properties.filter((p) => p.hasInstaller).length} | ${classified.filter((p) => p.hasInstaller).length} |`,
    `| Distinct normalized installers | — | ${freq.length} |`,
    '',
    'Cabarrus 2019+ is still missing. Completing 2016–2018 does not close that gap.',
    '',
  ].join('\n')

  await writeFile(path.join(DATA_DIR, 'cabarrus-2016-2018-summary.md'), summary)
  await writeFile(
    path.join(DATA_DIR, 'expand-stats.json'),
    JSON.stringify(
      {
        historicalRaw: historical.length,
        historicalUnique: historicalDedupe.properties.length,
        overlapWith2011_2015: overlapPins.length,
        uniquePropertiesAdded: newProperties.length,
        residentialAdded: newRes.length,
        installerOnNew: newWithInstaller.length,
        originalUnique: originalDedupe.properties.length,
        expandedUnique: classified.length,
        expandedClasses,
        originalClasses,
        expandedWithInstaller: classified.filter((p) => p.hasInstaller).length,
        distinctInstallers: freq.length,
        originalCabarrusRaw: originalCabarrus.length,
        histRes: histRes.length,
        yearRaw,
        yearUnique,
      },
      null,
      2,
    ),
  )

  console.log(summary)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
