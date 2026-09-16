/**
 * Consolidate Solar API detections into a canvass/mail candidate list.
 *
 *   npx tsx --env-file=.env.local scripts/solar-permits/solar-candidates.ts
 *
 * Reads every solar-api-discover-*.csv, keeps the ARRAY_DETECTED rows, matches
 * each back to its Cabarrus parcel, and attaches owner name + mailing address
 * from the county's public parcel layer.
 *
 * These are CANDIDATES, not records. Google's terms allow 30 days of caching, so
 * this writes a dated file and never a row in solar_installs. A candidate becomes
 * a permanent record only when a rep confirms panels at the door — that
 * observation is ours and doesn't expire.
 *
 * Owner name and mailing address come from the COUNTY parcel layer, not Google,
 * so those fields carry no such restriction.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetchAllArcGISFeatures } from './arcgis'

const CABARRUS_PARCELS_URL =
  'https://location.cabarruscounty.us/arcgisservices/rest/services/views/landrecords_view/MapServer/4'
const DATA = join(__dirname, 'data')
const PARCEL_CACHE = join(DATA, 'cabarrus-parcel-centroids.json')
const CACHE_DAYS = 30

type Parcel = { pin: string; lat: number; lng: number }
type Hit = { lat: number; lng: number; captureDate: string; nearestKnownM: string }

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function loadHits(): Hit[] {
  const byKey = new Map<string, Hit>()
  for (const f of readdirSync(DATA)) {
    if (!/^solar-api-discover-.*\.csv$/.test(f)) continue
    for (const line of readFileSync(join(DATA, f), 'utf8').split('\n').slice(2)) {
      const c = line.split(',')
      if (c.length < 6 || c[4] !== 'ARRAY_DETECTED') continue
      const lat = Number(c[2])
      const lng = Number(c[3])
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      // Same parcel can appear in two runs (a clobbered file was re-scanned);
      // dedupe on rounded coordinates.
      const key = `${lat.toFixed(6)}|${lng.toFixed(6)}`
      if (!byKey.has(key)) {
        byKey.set(key, {
          lat,
          lng,
          captureDate: c[5] ?? '',
          nearestKnownM: (c[0] ?? '').replace(/^near-solar-/, '').replace(/m$/, ''),
        })
      }
    }
  }
  return Array.from(byKey.values())
}

async function main() {
  if (!existsSync(PARCEL_CACHE)) {
    console.error('Missing cabarrus-parcel-centroids.json — run the discover mode first.')
    process.exit(1)
  }
  const parcels: Parcel[] = JSON.parse(readFileSync(PARCEL_CACHE, 'utf8'))
  const hits = loadHits()
  console.log(`detected arrays (deduped): ${hits.length}`)

  // Exact coordinate match: both sides are the same computed parcel centroid.
  const pinByCoord = new Map(parcels.map((p) => [`${p.lat.toFixed(6)}|${p.lng.toFixed(6)}`, p.pin]))
  const withPin = hits
    .map((h) => ({ ...h, pin: pinByCoord.get(`${h.lat.toFixed(6)}|${h.lng.toFixed(6)}`) ?? null }))
    .filter((h) => h.pin)
  console.log(`matched to a parcel PIN: ${withPin.length}`)

  const pins = Array.from(new Set(withPin.map((h) => h.pin!)))
  const info = new Map<string, Record<string, unknown>>()
  // 40, not 150: PIN14 values are 14 chars each, and an IN() clause of 150 pushes
  // the GET URL past the server's length limit — it answers 404, which reads like
  // a dead endpoint rather than an oversized request.
  const CH = 40
  for (let i = 0; i < pins.length; i += CH) {
    const chunk = pins.slice(i, i + CH)
    const where = `PIN14 IN (${chunk.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')})`
    try {
      const feats = await fetchAllArcGISFeatures(
        CABARRUS_PARCELS_URL,
        where,
        'PIN14,AcctName1,AcctName2,MailAddr1,MailAddr2,MailAddr3,MailCity,MailState,MailZipCode,SUBDIV_NAME,VacantOrImproved,BuildingValue',
      )
      for (const f of feats) {
        const pin = String(f.attributes.PIN14 ?? '').trim()
        if (pin) info.set(pin, f.attributes)
      }
    } catch (err) {
      console.warn(`  parcel lookup chunk ${i} failed: ${(err as Error).message}`)
    }
  }
  console.log(`parcel detail resolved: ${info.size}/${pins.length}`)

  const rows = withPin.map((h) => {
    const a = info.get(h.pin!) ?? {}
    const mail = [a.MailAddr1, a.MailAddr2, a.MailAddr3].map((v) => String(v ?? '').trim()).filter(Boolean).join(' ')
    return {
      pin: h.pin,
      owner: String(a.AcctName1 ?? '').trim(),
      owner_2: String(a.AcctName2 ?? '').trim(),
      mailing_address: mail,
      mailing_city: String(a.MailCity ?? '').trim(),
      mailing_state: String(a.MailState ?? '').trim(),
      mailing_zip: String(a.MailZipCode ?? '').trim(),
      subdivision: String(a.SUBDIV_NAME ?? '').trim(),
      improved: String(a.VacantOrImproved ?? '').trim(),
      building_value: a.BuildingValue ?? '',
      lat: h.lat,
      lng: h.lng,
      imagery_date: h.captureDate,
      meters_to_nearest_known_solar: h.nearestKnownM,
      source: 'google_solar_api_detected',
      verified_by_rep: '',
    }
  })

  // A vacant parcel with a "detected array" is a snap onto something else —
  // there is no roof there to sell.
  const improved = rows.filter((r) => !/^V/i.test(r.improved))
  const dropped = rows.length - improved.length
  if (dropped) console.log(`dropped ${dropped} vacant parcels (no structure)`)

  const expires = new Date(Date.now() + CACHE_DAYS * 864e5).toISOString().slice(0, 10)
  const headers = Object.keys(improved[0] ?? { pin: '' })
  const csv = [
    `# Solar candidates from Google Solar API detection. NOT permit-confirmed.`,
    `# DELETE BY ${expires} — Google allows 30 days of caching. Rep-confirmed rows can be kept permanently.`,
    headers.join(','),
    ...improved.map((r) => headers.map((h) => csvEscape((r as Record<string, unknown>)[h])).join(',')),
  ].join('\n')

  const out = join(DATA, `solar-candidates-cabarrus-${new Date().toISOString().slice(0, 10)}.csv`)
  writeFileSync(out, `${csv}\n`)

  console.log(`\nwritten: ${out}`)
  console.log(`candidates: ${improved.length}`)
  console.log(`  with owner name:      ${improved.filter((r) => r.owner).length}`)
  console.log(`  with mailing address: ${improved.filter((r) => r.mailing_address).length}`)
  console.log('\nsample:')
  improved.slice(0, 8).forEach((r) =>
    console.log(`  ${String(r.owner).slice(0, 28).padEnd(28)} ${String(r.mailing_address).slice(0, 34).padEnd(34)} ${r.mailing_city}`),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
