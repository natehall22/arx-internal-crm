import {
  addUniqueIndex,
  isCompanyName,
  lookupUnique,
  matchKeysForPerson,
  peopleFromTaxRecord,
  peopleFromWesternName,
  type UniqueIndexHit,
} from './owner-name'
import { canonicalCity, countyForMetroCity } from './metro-cities'
import type { DukeNmRow } from './duke-nm'

export type OwnerParcel = {
  county: string
  pin: string
  ownerName: string
  ownerFirst: string
  ownerLast: string
  address: string
  city: string
  zip: string
}

export type DukeJoinHit = {
  row: DukeNmRow
  parcel: OwnerParcel
  matchKey: string
}

function sameParcel(a: OwnerParcel, b: OwnerParcel): boolean {
  return a.county === b.county && a.pin === b.pin
}

export function buildOwnerIndex(parcels: OwnerParcel[]): Map<string, UniqueIndexHit<OwnerParcel>> {
  const index = new Map<string, UniqueIndexHit<OwnerParcel>>()
  for (const parcel of parcels) {
    if (!parcel.pin || !parcel.ownerName) continue
    const people = peopleFromTaxRecord({
      ownname: parcel.ownerName,
      ownfrst: parcel.ownerFirst,
      ownlast: parcel.ownerLast,
    })
    const city = canonicalCity(parcel.city) || null
    for (const person of people) {
      for (const key of matchKeysForPerson(person, parcel.county, city)) {
        addUniqueIndex(index, key, parcel, sameParcel)
      }
    }
    if (isCompanyName(parcel.ownerName)) {
      addUniqueIndex(
        index,
        `${parcel.county.trim().toLowerCase()}|co|${parcel.ownerName.trim().toUpperCase()}`,
        parcel,
        sameParcel,
      )
    }
  }
  return index
}

export function joinDukeRows(
  rows: DukeNmRow[],
  index: Map<string, UniqueIndexHit<OwnerParcel>>,
): {
  hits: DukeJoinHit[]
  unmatchedRows: DukeNmRow[]
  metroRows: number
  unmatched: number
  companiesSkipped: number
} {
  const hits: DukeJoinHit[] = []
  const unmatchedRows: DukeNmRow[] = []
  let metroRows = 0
  let unmatched = 0
  let companiesSkipped = 0

  for (const row of rows) {
    const county = row.county ?? countyForMetroCity(row.city)
    if (!county) continue
    metroRows += 1
    if (isCompanyName(row.accountName)) {
      companiesSkipped += 1
      const parcel = lookupUnique(index, [
        `${county.trim().toLowerCase()}|co|${row.accountName.trim().toUpperCase()}`,
      ])
      if (parcel) hits.push({ row, parcel, matchKey: 'company-exact' })
      else {
        unmatched += 1
        unmatchedRows.push(row)
      }
      continue
    }
    const people = peopleFromWesternName(row.accountName)
    let matched: OwnerParcel | null = null
    let matchKey = ''
    for (const person of people) {
      const keys = matchKeysForPerson(person, county, canonicalCity(row.city))
      const parcel = lookupUnique(index, keys)
      if (parcel) {
        matched = parcel
        matchKey = keys[0]
        break
      }
    }
    if (matched) hits.push({ row, parcel: matched, matchKey })
    else {
      unmatched += 1
      unmatchedRows.push(row)
    }
  }

  return { hits, unmatchedRows, metroRows, unmatched, companiesSkipped }
}

const CABARRUS_DUKE_CITIES = new Set([
  'CONCORD',
  'KANNAPOLIS',
  'HARRISBURG',
  'MIDLAND',
  'LOCUST',
  'MOUNT PLEASANT',
])

function lastCityKey(county: string, last: string, city: string): string {
  return `${county.trim().toLowerCase()}|lastonly|${last}|${city}`
}

/** Last name unique in that city — recovers Duke rows the first-name unique join refused. */
export function buildLastCityIndex(parcels: OwnerParcel[]): Map<string, UniqueIndexHit<OwnerParcel>> {
  const index = new Map<string, UniqueIndexHit<OwnerParcel>>()
  for (const parcel of parcels) {
    if (!parcel.pin || !parcel.ownerName) continue
    const city = canonicalCity(parcel.city)
    if (!city) continue
    const people = peopleFromTaxRecord({
      ownname: parcel.ownerName,
      ownfrst: parcel.ownerFirst,
      ownlast: parcel.ownerLast,
    })
    for (const person of people) {
      if (!person.last || person.last.length < 5) continue
      addUniqueIndex(index, lastCityKey(parcel.county, person.last, city), parcel, sameParcel)
    }
  }
  return index
}

export function recoverDukeByUniqueLastCity(
  unmatchedRows: DukeNmRow[],
  lastCityIndex: Map<string, UniqueIndexHit<OwnerParcel>>,
): DukeJoinHit[] {
  const hits: DukeJoinHit[] = []
  for (const row of unmatchedRows) {
    const city = canonicalCity(row.city)
    if (!CABARRUS_DUKE_CITIES.has(city)) continue
    if (isCompanyName(row.accountName)) continue
    const people = peopleFromWesternName(row.accountName)
    let matched: OwnerParcel | null = null
    let matchKey = ''
    for (const person of people) {
      if (!person.last || person.last.length < 5) continue
      const counties = city === 'KANNAPOLIS' ? ['Cabarrus', 'Rowan'] : ['Cabarrus']
      for (const county of counties) {
        const key = lastCityKey(county, person.last, city)
        const parcel = lookupUnique(lastCityIndex, [key])
        if (parcel) {
          matched = parcel
          matchKey = key
          break
        }
      }
      if (matched) break
    }
    if (matched) hits.push({ row, parcel: matched, matchKey })
  }
  return hits
}
