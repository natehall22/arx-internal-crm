#!/usr/bin/env node
/**
 * Full extract + property dedupe for Cabarrus, Mecklenburg, and Rowan.
 *
 * No Supabase ingest, no migrations, no canvass wiring.
 *
 * Usage:
 *   npm run solar-permits:extract
 *   npx tsx scripts/solar-permits/extract.ts --county cabarrus
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { extractCabarrusPermits } from './collectors/cabarrus'
import { extractMecklenburgPermits } from './collectors/mecklenburg'
import { extractRowanPermits } from './collectors/rowan'
import { dedupePermitsByProperty, summarizeExtract } from './dedupe'
import type { CountyExtractStats, ExtractSummary, PermitRecord, UniqueProperty } from './schema'

const DATA_DIR = path.join(__dirname, 'data')
const VALID_COUNTIES = ['cabarrus', 'mecklenburg', 'rowan'] as const
type CountyArg = (typeof VALID_COUNTIES)[number]

function requestedCounties(): CountyArg[] {
  const flags: CountyArg[] = []
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--county') {
      const value = process.argv[i + 1]?.toLowerCase()
      if (!value || !VALID_COUNTIES.includes(value as CountyArg)) {
        throw new Error(`--county must be one of ${VALID_COUNTIES.join(', ')}`)
      }
      flags.push(value as CountyArg)
    }
  }
  return flags.length ? Array.from(new Set(flags)) : [...VALID_COUNTIES]
}

function stripRaw(records: PermitRecord[]): PermitRecord[] {
  return records.map((record) => ({ ...record, raw: {} }))
}

function csvEscape(value: string | number | boolean | null): string {
  const s = value == null ? '' : String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function uniquePropertiesCsv(properties: UniqueProperty[]): string {
  const headers = [
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
    'permitCount',
    'permitNumbers',
    'propertyKey',
  ]
  const lines = [headers.join(',')]
  for (const p of properties) {
    lines.push(
      [
        csvEscape(p.sourceCounty),
        csvEscape(p.pin),
        csvEscape(p.address),
        csvEscape(p.city),
        csvEscape(p.zip),
        csvEscape(p.issuedOn),
        csvEscape(p.yearsSinceInstall),
        csvEscape(p.contractor),
        csvEscape(p.hasInstaller),
        csvEscape(p.isCommercial),
        csvEscape(p.permitCount),
        csvEscape(p.permitNumbers.join('|')),
        csvEscape(p.propertyKey),
      ].join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

function formatStats(stats: CountyExtractStats | (ExtractSummary['totals'] & { county?: string })): string {
  const label = 'county' in stats && stats.county ? stats.county : 'ALL'
  return [
    `| ${label} | ${stats.rawPermits} | ${stats.uniqueProperties} | ${stats.uniqueResidential} | ${stats.uniqueWithInstaller} | ${stats.uniqueWithPin} | ${stats.uniqueAddressOnly} | ${stats.unkeyable} |`,
  ].join('\n')
}

function summaryMarkdown(summary: ExtractSummary): string {
  const header =
    '| County | Raw permits | Unique properties | Unique residential | With installer | With PIN | Address-only | Unkeyable |'
  const sep = '|---|---:|---:|---:|---:|---:|---:|---:|'
  const rows = [
    ...summary.byCounty.map((row) => formatStats(row)),
    formatStats({ county: 'ALL', ...summary.totals }),
  ]
  return [
    '# Solar permit extract (Cabarrus / Mecklenburg / Rowan)',
    '',
    `Generated ${summary.generatedAt}. Age calculated as of ${summary.asOfYear}.`,
    '',
    'Staging only — no CRM ingest, no migrations, no canvass overlay.',
    '',
    header,
    sep,
    ...rows,
    '',
    'Dedupe: county + PIN (preferred) or normalized address. Earliest `issuedOn`; installer copied from any row that has one. Rows without lat/lng are kept. Mecklenburg `%SOLAR%` includes Skylight/Solar Panel work-type boilerplate, not only PV arrays.',
    '',
  ].join('\n')
}

async function main(): Promise<void> {
  const counties = requestedCounties()
  const asOfYear = new Date().getFullYear()
  await mkdir(DATA_DIR, { recursive: true })

  const records: PermitRecord[] = []

  console.log(`Extracting ${counties.join(', ')} (as-of ${asOfYear})\n`)

  if (counties.includes('cabarrus')) {
    console.log('Cabarrus ArcGIS yearly layers')
    const cabarrus = await extractCabarrusPermits()
    records.push(...cabarrus)
    await writeFile(
      path.join(DATA_DIR, 'permits-cabarrus.json'),
      JSON.stringify(stripRaw(cabarrus), null, 2),
    )
  }

  if (counties.includes('mecklenburg')) {
    console.log('Mecklenburg BuildingPermits + EPIC SolarPV')
    const meck = await extractMecklenburgPermits()
    const combined = [...meck.legacy, ...meck.epic]
    records.push(...combined)
    await writeFile(
      path.join(DATA_DIR, 'permits-mecklenburg.json'),
      JSON.stringify(stripRaw(combined), null, 2),
    )
    await writeFile(
      path.join(DATA_DIR, 'permits-mecklenburg-legacy.json'),
      JSON.stringify(stripRaw(meck.legacy), null, 2),
    )
    await writeFile(
      path.join(DATA_DIR, 'permits-mecklenburg-epic.json'),
      JSON.stringify(stripRaw(meck.epic), null, 2),
    )
  }

  if (counties.includes('rowan')) {
    console.log('Rowan Solar + Solar PV')
    const rowan = await extractRowanPermits()
    records.push(...rowan)
    await writeFile(path.join(DATA_DIR, 'permits-rowan.json'), JSON.stringify(stripRaw(rowan), null, 2))
  }

  const deduped = dedupePermitsByProperty(records, asOfYear)
  const summary = summarizeExtract(records, deduped, asOfYear)

  await writeFile(path.join(DATA_DIR, 'unique-properties.json'), JSON.stringify(deduped.properties, null, 2))
  await writeFile(path.join(DATA_DIR, 'unique-properties.csv'), uniquePropertiesCsv(deduped.properties))
  await writeFile(path.join(DATA_DIR, 'extract-summary.json'), JSON.stringify(summary, null, 2))
  await writeFile(path.join(DATA_DIR, 'extract-unkeyable.json'), JSON.stringify(stripRaw(deduped.unkeyable), null, 2))
  await writeFile(path.join(DATA_DIR, 'extract-summary.md'), summaryMarkdown(summary))

  console.log('\nUnique-property counts\n')
  console.log(summaryMarkdown(summary))
  console.log(`Wrote ${DATA_DIR}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
