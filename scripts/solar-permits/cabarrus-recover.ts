#!/usr/bin/env node
/**
 * Cabarrus-only: recover Duke NM rows whose last name is unique in that city.
 * Does not scrape Accela. Does not overwrite unique-properties.json.
 *
 *   npx tsx scripts/solar-permits/cabarrus-recover.ts
 */
import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

import { fetchAllArcGISFeatures } from './arcgis'
import { normalizePin, propertyKey as permitPropertyKey } from './dedupe'
import {
  buildLastCityIndex,
  buildOwnerIndex,
  joinDukeRows,
  recoverDukeByUniqueLastCity,
  type OwnerParcel,
} from './duke-join'
import { loadDukeNmRows } from './duke-nm'
import { canonicalCity } from './metro-cities'

const DATA_DIR = path.join(__dirname, 'data')
const OWNERS_CSV = path.join(DATA_DIR, 'onemap-metro-owners.csv')
const CANVASS = path.join(DATA_DIR, 'census-canvass-cabarrus.csv')
const CABARRUS_PARCELS_URL =
  'https://location.cabarruscounty.us/arcgisservices/rest/services/opendata/MapServer/46'

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

function csvEscape(value: string | number | boolean | null | undefined): string {
  const s = value == null ? '' : String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function isUsableAddress(address: string | null | undefined): boolean {
  const value = (address || '').trim()
  if (value.length < 8) return false
  if (/^0(\s|,|$)/.test(value)) return false
  if (!/\d/.test(value)) return false
  if (/\bP\.?\s*O\.?\s*BOX\b/i.test(value)) return false
  return true
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
    if (county !== 'Cabarrus' && county !== 'Rowan') continue
    const pin = rec.parno?.trim()
    const ownerName = rec.ownname?.trim()
    if (!pin || !ownerName || pin === '00000') continue
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

async function main(): Promise<void> {
  const dukeRows = await loadDukeNmRows(DATA_DIR, { download: false })
  const parcels = await loadOwnersCsv(OWNERS_CSV)
  console.log('Cabarrus OneMap rows lack site city/address — loading county tax MailAddr…')
  const cabarrusTax = await loadCabarrusTaxAddresses()
  for (const parcel of parcels) {
    if (parcel.county !== 'Cabarrus') continue
    const tax = cabarrusTax.get(normalizePin(parcel.pin) ?? '')
    if (!tax) continue
    if (!parcel.address) parcel.address = tax.address
    if (!parcel.city) parcel.city = tax.city
    if (!parcel.zip) parcel.zip = tax.zip
  }
  const joined = joinDukeRows(dukeRows, buildOwnerIndex(parcels))
  const recovered = recoverDukeByUniqueLastCity(joined.unmatchedRows, buildLastCityIndex(parcels))

  const cabarrusCities = new Set(['CONCORD', 'KANNAPOLIS', 'HARRISBURG', 'MIDLAND', 'LOCUST', 'MOUNT PLEASANT'])
  const dukeCabarrus = dukeRows.filter((row) => cabarrusCities.has(canonicalCity(row.city)))
  const standardCabarrus = joined.hits.filter((hit) => cabarrusCities.has(canonicalCity(hit.row.city)))

  const existing = await readFile(CANVASS, 'utf8')
  const existingLines = existing.trim().split('\n')
  const header = existingLines[0]
  const existingPins = new Set(
    existingLines.slice(1).map((line) => parseCsvLine(line)[2]).filter(Boolean),
  )

  const newRows: string[] = []
  let skippedNoAddress = 0
  let alreadyHave = 0
  for (const hit of recovered) {
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
    if (existingPins.has(hit.parcel.pin)) {
      alreadyHave += 1
      continue
    }
    if (!isUsableAddress(address)) {
      skippedNoAddress += 1
      continue
    }
    const key =
      permitPropertyKey({
        sourceCounty: hit.parcel.county,
        pin: hit.parcel.pin,
        address,
      }) ?? `${hit.parcel.county.toLowerCase()}|pin:${hit.parcel.pin}`
    newRows.push(
      [
        key,
        hit.parcel.county,
        hit.parcel.pin,
        csvEscape(address),
        csvEscape(city),
        csvEscape(zip),
        'LIKELY_PV',
        'duke_nm_lastcity',
        '',
        '',
        '',
        false,
        '',
        '',
        false,
        0,
        hit.row.kwDc,
        true,
      ].join(','),
    )
    existingPins.add(hit.parcel.pin)
  }

  await writeFile(path.join(DATA_DIR, 'census-canvass-cabarrus-recovered.csv'), `${header}\n${newRows.join('\n')}\n`)
  if (newRows.length) {
    await writeFile(CANVASS, `${existing.trimEnd()}\n${newRows.join('\n')}\n`)
  }

  const summary = {
    dukeCabarrusCityRows: dukeCabarrus.length,
    standardUniqueJoinsInThoseCities: standardCabarrus.length,
    unmatchedAfterStandard: joined.unmatchedRows.filter((row) =>
      cabarrusCities.has(canonicalCity(row.city)),
    ).length,
    lastCityRecovered: recovered.length,
    newCanvassStreets: newRows.length,
    alreadyOnCabarrusFile: alreadyHave,
    skippedNoAddress,
  }
  await writeFile(path.join(DATA_DIR, 'cabarrus-recover-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
