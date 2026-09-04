#!/usr/bin/env node
/**
 * Address-first solar census (finished local product).
 *
 * Merges unique-properties-expanded.json with unique Duke NM → tax-roll matches.
 * Installer is an overlay, not a gate. Does not overwrite unique-properties.json.
 *
 *   npm run solar-permits:census
 *
 * Do not: CRM ingest, Accela scrape, EPIC phone/email, commit, original 7,312 files.
 */
import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

import { fetchAllArcGISFeatures } from './arcgis'
import { normalizePin, propertyKey as permitPropertyKey } from './dedupe'
import { buildLastCityIndex, buildOwnerIndex, joinDukeRows, recoverDukeByUniqueLastCity, type OwnerParcel } from './duke-join'
import { loadDukeNmRows } from './duke-nm'
import {
  frequencyKeyFromContractor,
  getInstallerStatus,
  isHighConfidenceTerminal,
  toFrequencyKey,
} from './installer-status'
import { canonicalCity, isEastCharlotteCanvass, isSouthCharlotteCanvass, parseCityZipFromAddress } from './metro-cities'
import type { UniqueProperty } from './schema'

const DATA_DIR = path.join(__dirname, 'data')
const ORIGINAL_UNIQUE = path.join(DATA_DIR, 'unique-properties.json')
const EXPANDED_UNIQUE = path.join(DATA_DIR, 'unique-properties-expanded.json')
const OWNERS_CSV = path.join(DATA_DIR, 'onemap-metro-owners.csv')
const CABARRUS_PARCELS_URL =
  'https://location.cabarruscounty.us/arcgisservices/rest/services/opendata/MapServer/46'

type ExpandedProperty = UniqueProperty & { pvClass?: string; pvEvidence?: string }

export type CensusRow = {
  propertyKey: string
  sourceCounty: string
  pin: string
  address: string
  city: string
  zip: string
  pvClass: string
  evidenceSources: string
  issuedOn: string
  yearsSinceInstall: number | null
  contractor: string
  hasInstaller: boolean
  installerStatus: string
  installerConfidence: string
  isCommercial: boolean
  permitCount: number
  dukeKwDc: string
  canvassReady: boolean
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function installerOverlay(contractor: string | null): { status: string; confidence: string } {
  if (!contractor) return { status: '', confidence: '' }
  const freqKey = frequencyKeyFromContractor(contractor) ?? toFrequencyKey(contractor)
  if (!freqKey) return { status: '', confidence: '' }
  const status = getInstallerStatus(freqKey, contractor)
  return { status: status.status, confidence: status.confidence }
}

function isUsableAddress(address: string | null | undefined): boolean {
  const value = (address || '').trim()
  if (value.length < 8) return false
  if (/^0(\s|,|$)/.test(value)) return false
  if (!/\d/.test(value)) return false
  if (/\bP\.?\s*O\.?\s*BOX\b/i.test(value)) return false
  return true
}

function fromExpanded(property: ExpandedProperty): CensusRow {
  const parsed = parseCityZipFromAddress(property.address)
  const city = property.city || parsed.city || ''
  const zip = property.zip || parsed.zip || ''
  const overlay = installerOverlay(property.contractor)
  const pvClass = property.pvClass || ''
  const address = property.address || ''
  const canvassReady =
    isUsableAddress(address) &&
    !property.isCommercial &&
    (pvClass === 'CONFIRMED_PV' || pvClass === 'LIKELY_PV')
  return {
    propertyKey: property.propertyKey,
    sourceCounty: property.sourceCounty,
    pin: property.pin || '',
    address,
    city,
    zip,
    pvClass,
    evidenceSources: 'permit',
    issuedOn: property.issuedOn || '',
    yearsSinceInstall: property.yearsSinceInstall,
    contractor: property.contractor || '',
    hasInstaller: property.hasInstaller,
    installerStatus: overlay.status,
    installerConfidence: overlay.confidence,
    isCommercial: property.isCommercial,
    permitCount: property.permitCount,
    dukeKwDc: '',
    canvassReady,
  }
}

async function loadOwnersCsv(filePath: string): Promise<OwnerParcel[]> {
  const parcels: OwnerParcel[] = []
  const rl = readline.createInterface({ input: createReadStream(filePath), crlfDelay: Infinity })
  let header: string[] | null = null
  for await (const line of rl) {
    if (!header) {
      header = line.split(',')
      continue
    }
    const cols = parseCsvLine(line)
    const rec: Record<string, string> = {}
    header.forEach((h, i) => {
      rec[h] = cols[i] ?? ''
    })
    const county = rec.cntyname?.trim()
    const pin = rec.parno?.trim()
    const ownerName = rec.ownname?.trim()
    if (!county || !pin || !ownerName || pin === '00000') continue
    parcels.push({
      county,
      pin,
      ownerName,
      ownerFirst: rec.ownfrst?.trim() || '',
      ownerLast: rec.ownlast?.trim() || '',
      address: rec.siteadd?.trim() || '',
      city: rec.scity?.trim() || '',
      zip: rec.szip?.trim() || '',
    })
  }
  return parcels
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
        } else inQuotes = false
      } else cur += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

async function loadCabarrusTaxAddresses(): Promise<Map<string, { address: string; city: string; zip: string }>> {
  const features = await fetchAllArcGISFeatures(
    CABARRUS_PARCELS_URL,
    '1=1',
    'PIN14,AcctName1,MailAddr1,MailCity,MailZipCode',
    { pageSize: 1000, delayMs: 50 },
  )
  const map = new Map<string, { address: string; city: string; zip: string }>()
  for (const feature of features) {
    const pin = normalizePin(String(feature.attributes.PIN14 ?? ''))
    if (!pin) continue
    map.set(pin, {
      address: String(feature.attributes.MailAddr1 ?? '').trim(),
      city: String(feature.attributes.MailCity ?? '').trim(),
      zip: String(feature.attributes.MailZipCode ?? '').trim(),
    })
  }
  return map
}

function mergeEvidence(existing: string, add: string): string {
  const set = new Set(existing.split('|').filter(Boolean))
  set.add(add)
  return Array.from(set).join('|')
}

async function main(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  if (!(await fileExists(EXPANDED_UNIQUE))) {
    throw new Error('Run npm run solar-permits:expand first (unique-properties-expanded.json missing)')
  }
  if (!(await fileExists(ORIGINAL_UNIQUE))) {
    throw new Error('Original unique-properties.json missing — refusing to run')
  }

  const expanded = JSON.parse(await readFile(EXPANDED_UNIQUE, 'utf8')) as ExpandedProperty[]
  const originalCount = (JSON.parse(await readFile(ORIGINAL_UNIQUE, 'utf8')) as UniqueProperty[]).length
  if (originalCount !== 7312) {
    console.warn(`Original unique-properties.json count is ${originalCount}, expected 7312`)
  }

  const byKey = new Map<string, CensusRow>()
  for (const property of expanded) {
    byKey.set(property.propertyKey, fromExpanded(property))
  }

  const dukeRows = await loadDukeNmRows(DATA_DIR)
  if (!(await fileExists(OWNERS_CSV))) {
    throw new Error(
      `Missing ${OWNERS_CSV}. Wait for the OneMap owner download or re-run it.`,
    )
  }
  const parcels = await loadOwnersCsv(OWNERS_CSV)
  let cabarrusTax = new Map<string, { address: string; city: string; zip: string }>()
  const cabarrusNeedsAddress = parcels.some(
    (parcel) => parcel.county === 'Cabarrus' && (!parcel.address || !parcel.city),
  )
  if (cabarrusNeedsAddress) {
    console.log('Cabarrus OneMap rows lack site address — loading county tax MailAddr…')
    cabarrusTax = await loadCabarrusTaxAddresses()
    for (const parcel of parcels) {
      if (parcel.county !== 'Cabarrus') continue
      const tax = cabarrusTax.get(normalizePin(parcel.pin) ?? '')
      if (!tax) continue
      if (!parcel.address) parcel.address = tax.address
      if (!parcel.city) parcel.city = tax.city
      if (!parcel.zip) parcel.zip = tax.zip
    }
  }
  const index = buildOwnerIndex(parcels)
  const joined = joinDukeRows(dukeRows, index)
  const recovered = recoverDukeByUniqueLastCity(
    joined.unmatchedRows,
    buildLastCityIndex(parcels.filter((p) => p.county === 'Cabarrus' || p.county === 'Rowan')),
  )
  const dukeHits = [...joined.hits, ...recovered]

  let dukeNew = 0
  let dukeOverlay = 0
  for (const hit of dukeHits) {
    let address = hit.parcel.address
    let city = hit.parcel.city || hit.row.city
    let zip = hit.parcel.zip
    if (!address && hit.parcel.county === 'Cabarrus') {
      const tax = cabarrusTax.get(normalizePin(hit.parcel.pin) ?? '')
      if (tax) {
        address = tax.address
        city = city || tax.city
        zip = zip || tax.zip
      }
    }
    const key =
      permitPropertyKey({
        sourceCounty: hit.parcel.county,
        pin: hit.parcel.pin,
        address: address || null,
      }) ?? `${hit.parcel.county.toLowerCase()}|pin:${hit.parcel.pin}`
    const existing = byKey.get(key)
    if (existing) {
      existing.evidenceSources = mergeEvidence(existing.evidenceSources, 'duke_nm')
      existing.dukeKwDc = String(hit.row.kwDc)
      if (!existing.address && address) existing.address = address
      if (!existing.city && city) existing.city = city
      dukeOverlay += 1
      if (
        existing.address &&
        !existing.isCommercial &&
        (existing.pvClass === 'CONFIRMED_PV' || existing.pvClass === 'LIKELY_PV' || existing.evidenceSources.includes('duke_nm'))
      ) {
        existing.canvassReady = existing.pvClass !== 'NON_PV' && existing.pvClass !== 'AMBIGUOUS_SOLAR'
          ? true
          : existing.canvassReady
      }
      if (existing.pvClass === 'AMBIGUOUS_SOLAR' || existing.pvClass === 'NON_PV' || !existing.pvClass) {
        existing.pvClass = 'LIKELY_PV'
        existing.canvassReady = isUsableAddress(existing.address) && !existing.isCommercial
      }
      continue
    }
    if (!isUsableAddress(address)) continue
    dukeNew += 1
    byKey.set(key, {
      propertyKey: key,
      sourceCounty: hit.parcel.county,
      pin: hit.parcel.pin,
      address,
      city,
      zip,
      pvClass: 'LIKELY_PV',
      evidenceSources: 'duke_nm',
      issuedOn: '',
      yearsSinceInstall: null,
      contractor: '',
      hasInstaller: false,
      installerStatus: '',
      installerConfidence: '',
      isCommercial: false,
      permitCount: 0,
      dukeKwDc: String(hit.row.kwDc),
      canvassReady: true,
    })
  }

  const rows = Array.from(byKey.values()).sort((a, b) => {
    const county = a.sourceCounty.localeCompare(b.sourceCounty)
    if (county !== 0) return county
    return a.address.localeCompare(b.address)
  })
  const canvass = rows.filter((row) => row.canvassReady)
  const canvassEast = canvass.filter((row) => isEastCharlotteCanvass(row))
  const canvassSouth = canvass.filter((row) => isSouthCharlotteCanvass(row))
  const canvassCabarrus = canvass.filter((row) => row.sourceCounty === 'Cabarrus')
  const headers = [
    'propertyKey',
    'sourceCounty',
    'pin',
    'address',
    'city',
    'zip',
    'pvClass',
    'evidenceSources',
    'issuedOn',
    'yearsSinceInstall',
    'contractor',
    'hasInstaller',
    'installerStatus',
    'installerConfidence',
    'isCommercial',
    'permitCount',
    'dukeKwDc',
    'canvassReady',
  ]

  await writeFile(path.join(DATA_DIR, 'census-properties.csv'), toCsv(headers, rows))
  await writeFile(path.join(DATA_DIR, 'census-canvass.csv'), toCsv(headers, canvass))
  await writeFile(path.join(DATA_DIR, 'census-canvass-east.csv'), toCsv(headers, canvassEast))
  await writeFile(path.join(DATA_DIR, 'census-canvass-south.csv'), toCsv(headers, canvassSouth))
  await writeFile(path.join(DATA_DIR, 'census-canvass-cabarrus.csv'), toCsv(headers, canvassCabarrus))

  const byCounty: Record<string, number> = {}
  const byCountyEast: Record<string, number> = {}
  const byCountySouth: Record<string, number> = {}
  const byPv: Record<string, number> = {}
  const byEvidence: Record<string, number> = {}
  let orphaned = 0
  let orphanedEast = 0
  let orphanedSouth = 0
  let orphanedCabarrus = 0
  const byCityCabarrus: Record<string, number> = {}
  for (const row of canvass) {
    byCounty[row.sourceCounty] = (byCounty[row.sourceCounty] || 0) + 1
    byPv[row.pvClass] = (byPv[row.pvClass] || 0) + 1
    byEvidence[row.evidenceSources] = (byEvidence[row.evidenceSources] || 0) + 1
    const status = row.hasInstaller
      ? getInstallerStatus(
          frequencyKeyFromContractor(row.contractor) ?? toFrequencyKey(row.contractor),
          row.contractor,
        )
      : null
    if (status && isHighConfidenceTerminal(status)) orphaned += 1
  }
  for (const row of canvassEast) {
    byCountyEast[row.sourceCounty] = (byCountyEast[row.sourceCounty] || 0) + 1
    if (row.hasInstaller) {
      const status = getInstallerStatus(
        frequencyKeyFromContractor(row.contractor) ?? toFrequencyKey(row.contractor),
        row.contractor,
      )
      if (isHighConfidenceTerminal(status)) orphanedEast += 1
    }
  }

  for (const row of canvassSouth) {
    byCountySouth[row.sourceCounty] = (byCountySouth[row.sourceCounty] || 0) + 1
    if (row.hasInstaller) {
      const status = getInstallerStatus(
        frequencyKeyFromContractor(row.contractor) ?? toFrequencyKey(row.contractor),
        row.contractor,
      )
      if (isHighConfidenceTerminal(status)) orphanedSouth += 1
    }
  }

  for (const row of canvassCabarrus) {
    const city = canonicalCity(row.city) || '(blank)'
    byCityCabarrus[city] = (byCityCabarrus[city] || 0) + 1
    if (row.hasInstaller) {
      const status = getInstallerStatus(
        frequencyKeyFromContractor(row.contractor) ?? toFrequencyKey(row.contractor),
        row.contractor,
      )
      if (isHighConfidenceTerminal(status)) orphanedCabarrus += 1
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    originalUniqueUntouched: originalCount,
    expandedPermitProperties: expanded.length,
    censusProperties: rows.length,
    canvassReady: canvass.length,
    canvassEast: canvassEast.length,
    canvassSouth: canvassSouth.length,
    canvassCabarrus: canvassCabarrus.length,
    dukePdfRows: dukeRows.length,
    dukeMetroRows: joined.metroRows,
    dukeUniqueJoins: joined.hits.length,
    dukeLastCityRecovered: recovered.length,
    dukeOverlayExisting: dukeOverlay,
    dukeNewAddresses: dukeNew,
    dukeUnmatched: joined.unmatched,
    ownerParcelsIndexed: parcels.length,
    canvassByCounty: byCounty,
    canvassEastByCounty: byCountyEast,
    canvassSouthByCounty: byCountySouth,
    canvassByPvClass: byPv,
    highConfidenceOrphanedInstaller: orphaned,
    highConfidenceOrphanedInstallerEast: orphanedEast,
    highConfidenceOrphanedInstallerSouth: orphanedSouth,
    highConfidenceOrphanedInstallerCabarrus: orphanedCabarrus,
    canvassCabarrusByCity: byCityCabarrus,
  }
  await writeFile(path.join(DATA_DIR, 'census-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  await writeFile(
    path.join(DATA_DIR, 'census-summary.md'),
    [
      '# Solar address census',
      '',
      `Generated ${summary.generatedAt}. Original unique-properties.json left at **${originalCount}**.`,
      '',
      `| Slice | Count |`,
      `|---|---:|`,
      `| Permit properties (expanded) | ${expanded.length} |`,
      `| Census rows (permit + Duke unique joins) | ${rows.length} |`,
      `| **Canvass-ready** (address + CONFIRMED/LIKELY or Duke NM) | **${canvass.length}** |`,
      `| **East Charlotte** (Cabarrus + Rowan + east Meck) | **${canvassEast.length}** |`,
      `| **South Charlotte** (Ballantyne / SouthPark / Providence / Matthews / Pineville) | **${canvassSouth.length}** |`,
      `| **Cabarrus County** | **${canvassCabarrus.length}** |`,
      `| Duke NM PDF rows (DEC+DEP) | ${dukeRows.length} |`,
      `| Duke metro-city rows | ${joined.metroRows} |`,
      `| Duke unique tax-roll joins | ${joined.hits.length} |`,
      `| Duke overlay on existing PIN | ${dukeOverlay} |`,
      `| Duke **new** addresses | ${dukeNew} |`,
      `| High-confidence bankrupt/defunct installer (canvass) | ${orphaned} |`,
      `| High-confidence bankrupt/defunct installer (east) | ${orphanedEast} |`,
      `| High-confidence bankrupt/defunct installer (south) | ${orphanedSouth} |`,
      `| High-confidence bankrupt/defunct installer (Cabarrus) | ${orphanedCabarrus} |`,
      '',
      'Installer is overlay only. UNKNOWN / blank installer still canvasses.',
      '',
      '## Canvass by county',
      '',
      ...Object.entries(byCounty)
        .sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `- ${c}: ${n}`),
      '',
      '## East Charlotte canvass',
      '',
      'Cabarrus + Rowan + Mint Hill / Matthews / east Charlotte ZIPs. Not Gaston, Lincoln, Iredell, Union, or north/south Charlotte.',
      '',
      ...Object.entries(byCountyEast)
        .sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `- ${c}: ${n}`),
      '',
      '## South Charlotte canvass',
      '',
      '28210 / 28226 / 28270 / 28277 (SouthPark, Carmel, Providence, Ballantyne), 28203 / 28207 / 28209 (South End / Myers Park), Matthews, Pineville. Steele Creek 28273/78/17 is southwest and not in this file.',
      '',
      ...Object.entries(byCountySouth)
        .sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `- ${c}: ${n}`),
      '',
      '## Cabarrus County canvass',
      '',
      'All Cabarrus canvass-ready streets (Concord, Kannapolis, Harrisburg, Midland, Locust, Mt Pleasant). Includes Duke unique-joins that GIS through 2018 missed. Concord Electric is not in this file.',
      '',
      ...Object.entries(byCityCabarrus)
        .sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `- ${c}: ${n}`),
      '',
      `High-confidence bankrupt/defunct installer (Cabarrus): ${orphanedCabarrus}`,
      '',
    ].join('\n'),
  )

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
