import { dedupeByProperty, toFeature, toStatus, type InstallRow } from '@/lib/solar-installs'

const base: InstallRow = {
  pin: null,
  address: null,
  lat: 35.4088,
  lng: -80.5795,
  issued_on: null,
  installer_name_raw: null,
  owner_is_original: null,
  solar_installers: null,
}

const row = (over: Partial<InstallRow>): InstallRow => ({ ...base, ...over })

const defunct = { status: 'defunct', display_name: 'Verified Defunct Co' }

describe('dedupeByProperty', () => {
  it('collapses several permits for one property into a single marker', () => {
    const out = dedupeByProperty([
      row({ pin: '5620123456', issued_on: '2012-05-14' }),
      row({ pin: '5620123456', issued_on: '2012-06-02' }),
      row({ pin: '5620123456', issued_on: '2012-06-20' }),
    ])
    expect(out).toHaveLength(1)
  })

  it('keeps the earliest permit — that is when the array went up', () => {
    const out = dedupeByProperty([
      row({ pin: '5620123456', issued_on: '2012-06-02' }),
      row({ pin: '5620123456', issued_on: '2012-05-14' }),
    ])
    expect(out[0].issued_on).toBe('2012-05-14')
  })

  it('prefers a row that resolved an installer over an earlier one that did not', () => {
    const out = dedupeByProperty([
      row({ pin: '5620123456', issued_on: '2012-05-14' }),
      row({ pin: '5620123456', issued_on: '2012-06-02', solar_installers: defunct }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].solar_installers).toEqual(defunct)
  })

  it('falls back to address when no parcel id is present', () => {
    const out = dedupeByProperty([
      row({ address: '100 Verify St', issued_on: '2012-05-14' }),
      row({ address: '100 verify st', issued_on: '2012-06-02' }),
    ])
    expect(out).toHaveLength(1)
  })

  it('keeps distinct properties apart', () => {
    const out = dedupeByProperty([
      row({ pin: '5620123456' }),
      row({ pin: '5620999999' }),
    ])
    expect(out).toHaveLength(2)
  })

  it('drops rows with no coordinates — they cannot be mapped', () => {
    const out = dedupeByProperty([
      row({ pin: '5620123456', lat: null }),
      row({ pin: '5620999999', lng: null }),
    ])
    expect(out).toHaveLength(0)
  })

  it('drops rows that identify no property at all', () => {
    expect(dedupeByProperty([row({ pin: null, address: null })])).toHaveLength(0)
    expect(dedupeByProperty([row({ pin: '   ', address: '  ' })])).toHaveLength(0)
  })

  it('does not treat a null issue date as earlier than a real one', () => {
    const out = dedupeByProperty([
      row({ pin: '5620123456', issued_on: '2012-05-14' }),
      row({ pin: '5620123456', issued_on: null }),
    ])
    expect(out[0].issued_on).toBe('2012-05-14')
  })

  it('returns an empty list for empty input', () => {
    expect(dedupeByProperty([])).toEqual([])
  })
})

describe('toStatus', () => {
  it('passes through the two statuses we can actually confirm', () => {
    expect(toStatus('defunct')).toBe('defunct')
    expect(toStatus('active')).toBe('active')
  })

  it('never infers defunct from missing or unexpected data', () => {
    for (const raw of [null, undefined, '', 'DEFUNCT', 'closed', 'out of business']) {
      expect(toStatus(raw)).toBe('unknown')
    }
  })
})

describe('toFeature', () => {
  const CURRENT_YEAR = 2026

  it('derives system age from the permit year', () => {
    const f = toFeature(row({ pin: '1', issued_on: '2012-05-14' }), CURRENT_YEAR)
    expect(f?.properties.installedYear).toBe(2012)
    expect(f?.properties.systemAge).toBe(14)
  })

  it('leaves age undefined rather than guessing when there is no date', () => {
    const f = toFeature(row({ pin: '1', issued_on: null }), CURRENT_YEAR)
    expect(f?.properties.installedYear).toBeUndefined()
    expect(f?.properties.systemAge).toBeUndefined()
  })

  it('rejects implausible and future permit years', () => {
    expect(toFeature(row({ pin: '1', issued_on: '1899-01-01' }), CURRENT_YEAR)?.properties.systemAge)
      .toBeUndefined()
    expect(toFeature(row({ pin: '1', issued_on: '2030-01-01' }), CURRENT_YEAR)?.properties.systemAge)
      .toBeUndefined()
  })

  it('emits GeoJSON lng,lat order', () => {
    const f = toFeature(row({ pin: '1', lat: 35.4088, lng: -80.5795 }), CURRENT_YEAR)
    expect(f?.geometry?.coordinates).toEqual([-80.5795, 35.4088])
  })

  it('exposes only a resolved installer name, never the raw permit string', () => {
    const f = toFeature(
      row({ pin: '1', installer_name_raw: 'SOME UNMATCHED OUTFIT LLC' }),
      CURRENT_YEAR
    )
    expect(f?.properties.installerName).toBeNull()
    expect(f?.properties.installerStatus).toBe('unknown')
    expect(JSON.stringify(f)).not.toContain('UNMATCHED')
  })

  it('returns null when the row cannot be placed on a map', () => {
    expect(toFeature(row({ pin: '1', lat: null }), CURRENT_YEAR)).toBeNull()
    expect(toFeature(row({ pin: '1', lng: null }), CURRENT_YEAR)).toBeNull()
  })
})
