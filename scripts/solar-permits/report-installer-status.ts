#!/usr/bin/env node
/**
 * Join installer-frequency + unique-properties-expanded with researched status catalog.
 *
 *   npm run solar-permits:installer-status
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { installerNameKey } from '../../lib/solar-installers'
import {
  aliasNoteForRow,
  frequencyKeyFromContractor,
  getInstallerStatus,
  isHighConfidenceTerminal,
  resolveCanonicalFrequencyKey,
  toFrequencyKey,
  type InstallerBusinessStatus,
  type InstallerStatusConfidence,
} from './installer-status'

const DATA_DIR = path.join(__dirname, 'data')

type FrequencyRow = {
  normalizedInstaller: string
  rawNameVariants: string
  propertyCount: number
  permitCount: number
  firstPermitDate: string
  lastPermitDate: string
  counties: string
}

type PropertyRow = {
  county: string
  pin: string
  address: string
  city: string
  zip: string
  issuedOn: string
  yearsSinceInstall: number | null
  contractor: string
  hasInstaller: boolean
  isCommercial: boolean
  pvClass: string
  permitCount: number
  permitNumbers: string
  propertyKey: string
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

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.length > 0)
  if (!lines.length) return { headers: [], rows: [] }
  const headers = parseCsvLine(lines[0])
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? ''
    })
    return row
  })
  return { headers, rows }
}

function parseBool(value: string): boolean {
  return value === 'true' || value === 'TRUE'
}

function parseIntOrNull(value: string): number | null {
  if (!value) return null
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : null
}

function ageBucket(years: number | null): '0-5' | '6-10' | '11+' | 'unknown' {
  if (years == null) return 'unknown'
  if (years <= 5) return '0-5'
  if (years <= 10) return '6-10'
  return '11+'
}

function yearOf(issuedOn: string): string {
  return issuedOn ? issuedOn.slice(0, 4) : 'unknown'
}

function increment(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by
}

function percent(count: number, total: number): number {
  if (!total) return 0
  return Math.round((count / total) * 1000) / 10
}

async function loadFrequencyRows(): Promise<FrequencyRow[]> {
  const text = await readFile(path.join(DATA_DIR, 'installer-frequency.csv'), 'utf8')
  const { rows } = parseCsv(text)
  return rows.map((row) => ({
    normalizedInstaller: row.normalizedInstaller,
    rawNameVariants: row.rawNameVariants,
    propertyCount: Number.parseInt(row.propertyCount, 10) || 0,
    permitCount: Number.parseInt(row.permitCount, 10) || 0,
    firstPermitDate: row.firstPermitDate,
    lastPermitDate: row.lastPermitDate,
    counties: row.counties,
  }))
}

async function loadPropertyRows(): Promise<PropertyRow[]> {
  const text = await readFile(path.join(DATA_DIR, 'unique-properties-expanded.csv'), 'utf8')
  const { rows } = parseCsv(text)
  return rows.map((row) => ({
    county: row.county,
    pin: row.pin,
    address: row.address,
    city: row.city,
    zip: row.zip,
    issuedOn: row.issuedOn,
    yearsSinceInstall: parseIntOrNull(row.yearsSinceInstall),
    contractor: row.contractor,
    hasInstaller: parseBool(row.hasInstaller),
    isCommercial: parseBool(row.isCommercial),
    pvClass: row.pvClass,
    permitCount: Number.parseInt(row.permitCount, 10) || 0,
    permitNumbers: row.permitNumbers,
    propertyKey: row.propertyKey,
  }))
}

function resolveNormalizedInstaller(
  contractor: string,
  freqKeyToNormalized: Map<string, string>,
): string {
  const freqKey = frequencyKeyFromContractor(contractor)
  if (freqKey && freqKeyToNormalized.has(freqKey)) {
    return freqKeyToNormalized.get(freqKey)!
  }
  return installerNameKey(contractor) ?? ''
}

async function main(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })

  const frequencyRows = await loadFrequencyRows()
  if (frequencyRows.length !== 186) {
    console.warn(`Expected 186 installer-frequency rows, got ${frequencyRows.length}`)
  }

  const propertyCountByFreqKey = new Map<string, number>()
  const freqKeyToNormalized = new Map<string, string>()
  for (const row of frequencyRows) {
    const freqKey = toFrequencyKey(row.normalizedInstaller)
    propertyCountByFreqKey.set(freqKey, row.propertyCount)
    freqKeyToNormalized.set(freqKey, row.normalizedInstaller)
  }

  const installerStatusRows = frequencyRows.map((row) => {
    const freqKey = toFrequencyKey(row.normalizedInstaller)
    const canonical = resolveCanonicalFrequencyKey(freqKey)
    const status = getInstallerStatus(freqKey, row.normalizedInstaller)
    const aliasNote = aliasNoteForRow(freqKey, propertyCountByFreqKey)
    const notes = [status.notes, aliasNote].filter(Boolean).join(' ')

    return {
      normalized_installer: row.normalizedInstaller,
      raw_variants: row.rawNameVariants,
      status: status.status,
      confidence: status.confidence,
      evidence_summary: status.evidenceSummary,
      source_1: status.source1,
      source_2: status.source2,
      first_permit_date: row.firstPermitDate,
      last_permit_date: row.lastPermitDate,
      property_count: row.propertyCount,
      counties: row.counties,
      successor_company: status.successorCompany,
      successor_still_services_systems: status.successorStillServicesSystems,
      notes,
      _freqKey: freqKey,
      _canonical: canonical,
    }
  })

  await writeFile(
    path.join(DATA_DIR, 'installer-status.csv'),
    toCsv(
      [
        'normalized_installer',
        'raw_variants',
        'status',
        'confidence',
        'evidence_summary',
        'source_1',
        'source_2',
        'first_permit_date',
        'last_permit_date',
        'property_count',
        'counties',
        'successor_company',
        'successor_still_services_systems',
        'notes',
      ],
      installerStatusRows.map(({ _freqKey: _f, _canonical: _c, ...row }) => row),
    ),
  )

  const allProperties = await loadPropertyRows()
  const withInstaller = allProperties.filter((p) => p.hasInstaller)

  const knownPropertyRows = withInstaller.map((p) => {
    const normalizedInstaller = resolveNormalizedInstaller(p.contractor, freqKeyToNormalized)
    const freqKey = frequencyKeyFromContractor(p.contractor) ?? (normalizedInstaller ? toFrequencyKey(normalizedInstaller) : '')
    const status = getInstallerStatus(freqKey, normalizedInstaller)

    return {
      propertyKey: p.propertyKey,
      county: p.county,
      pin: p.pin,
      address: p.address,
      issuedOn: p.issuedOn,
      yearsSinceInstall: p.yearsSinceInstall,
      contractor: p.contractor,
      normalized_installer: normalizedInstaller,
      status: status.status,
      confidence: status.confidence,
      pvClass: p.pvClass,
      permitCount: p.permitCount,
      permitNumbers: p.permitNumbers,
    }
  })

  await writeFile(
    path.join(DATA_DIR, 'installer-known-properties-status.csv'),
    toCsv(
      [
        'propertyKey',
        'county',
        'pin',
        'address',
        'issuedOn',
        'yearsSinceInstall',
        'contractor',
        'normalized_installer',
        'status',
        'confidence',
        'pvClass',
        'permitCount',
        'permitNumbers',
      ],
      knownPropertyRows,
    ),
  )

  const byStatus: Record<string, { count: number; percent: number }> = {}
  const statusOrder: InstallerBusinessStatus[] = [
    'ACTIVE',
    'DEFUNCT',
    'BANKRUPT',
    'DISSOLVED',
    'ACQUIRED',
    'NO_LONGER_SERVICING_MARKET',
    'UNKNOWN',
  ]
  for (const s of statusOrder) {
    byStatus[s] = { count: 0, percent: 0 }
  }
  for (const row of knownPropertyRows) {
    const entry = byStatus[row.status]
    if (entry) entry.count += 1
  }
  const totalKnown = knownPropertyRows.length
  for (const s of statusOrder) {
    byStatus[s].percent = percent(byStatus[s].count, totalKnown)
  }

  const highConfTerminal = knownPropertyRows.filter((row) =>
    isHighConfidenceTerminal({
      status: row.status as InstallerBusinessStatus,
      confidence: row.confidence as InstallerStatusConfidence,
      evidenceSummary: '',
      source1: '',
      source2: '',
      successorCompany: '',
      successorStillServicesSystems: 'unknown',
      notes: '',
    }),
  )

  const byInstaller: Record<string, number> = {}
  const byCounty: Record<string, number> = {}
  const byYear: Record<string, number> = {}
  const byAgeBucket: Record<string, number> = { '0-5': 0, '6-10': 0, '11+': 0, unknown: 0 }

  for (const row of highConfTerminal) {
    const label = row.normalized_installer || row.contractor
    increment(byInstaller, label)
    increment(byCounty, row.county)
    increment(byYear, yearOf(row.issuedOn))
    increment(byAgeBucket, ageBucket(row.yearsSinceInstall))
  }

  const summary = {
    installerKnownProperties: totalKnown,
    byStatus,
    highConfidenceDefunctBankruptDissolved: {
      propertyCount: highConfTerminal.length,
      byInstaller,
      byCounty,
      byYear,
      byAgeBucket,
    },
  }

  await writeFile(
    path.join(DATA_DIR, 'installer-status-summary.json'),
    JSON.stringify(summary, null, 2),
  )

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
