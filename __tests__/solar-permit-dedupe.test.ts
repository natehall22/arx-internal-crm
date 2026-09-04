import {
  dedupePermitsByProperty,
  normalizeAddress,
  normalizePin,
  propertyKey,
  summarizeExtract,
  yearsSinceInstall,
} from '../scripts/solar-permits/dedupe'
import type { PermitRecord } from '../scripts/solar-permits/schema'

const base: PermitRecord = {
  sourceJurisdiction: 'test',
  sourceCounty: 'Cabarrus',
  sourceUrl: 'https://example.test',
  permitNumber: 'BU2015-00001',
  permitType: 'Residential',
  permitSubtype: 'Electrical',
  issuedOn: '2015-04-01',
  description: 'SOLAR PV',
  address: '100 Verify St',
  city: null,
  zip: null,
  pin: '55301234567890',
  applicant: null,
  contractor: null,
  contractorKey: null,
  ownerNamePermitEra: null,
  projectValue: null,
  latitude: null,
  longitude: null,
  detectedBy: ['description:solar'],
  isCommercial: false,
  raw: {},
}

const row = (over: Partial<PermitRecord>): PermitRecord => ({ ...base, ...over })

describe('solar permit extract dedupe', () => {
  it('collapses several permits for one PIN into a single property', () => {
    const { properties } = dedupePermitsByProperty(
      [
        row({ permitNumber: 'BU2015-1' }),
        row({ permitNumber: 'EL2015-2', issuedOn: '2015-05-01' }),
        row({ permitNumber: 'ZN2015-3', issuedOn: '2015-06-01' }),
      ],
      2026,
    )
    expect(properties).toHaveLength(1)
    expect(properties[0].permitCount).toBe(3)
    expect(properties[0].permitNumbers).toEqual(['BU2015-1', 'EL2015-2', 'ZN2015-3'])
  })

  it('keeps the earliest issuedOn even when the installer is on a later row', () => {
    const { properties } = dedupePermitsByProperty(
      [
        row({ permitNumber: 'A', issuedOn: '2012-05-14', contractor: null, contractorKey: null }),
        row({
          permitNumber: 'B',
          issuedOn: '2012-06-02',
          contractor: 'POWER HOME SOLAR',
          contractorKey: 'power home solar',
        }),
      ],
      2026,
    )
    expect(properties[0].issuedOn).toBe('2012-05-14')
    expect(properties[0].contractor).toBe('POWER HOME SOLAR')
    expect(properties[0].hasInstaller).toBe(true)
    expect(properties[0].yearsSinceInstall).toBe(14)
  })

  it('falls back to normalized address when no PIN is present', () => {
    const { properties } = dedupePermitsByProperty(
      [
        row({ pin: null, address: '100 Verify St', permitNumber: 'A' }),
        row({ pin: null, address: '100 verify st.', permitNumber: 'B' }),
      ],
      2026,
    )
    expect(properties).toHaveLength(1)
  })

  it('does not merge the same PIN across counties', () => {
    const { properties } = dedupePermitsByProperty(
      [
        row({ sourceCounty: 'Cabarrus', pin: '001011' }),
        row({ sourceCounty: 'Rowan', pin: '001 011', address: 'Catawba College' }),
      ],
      2026,
    )
    expect(properties).toHaveLength(2)
  })

  it('keeps rows that have no coordinates', () => {
    const { properties } = dedupePermitsByProperty(
      [row({ latitude: null, longitude: null })],
      2026,
    )
    expect(properties).toHaveLength(1)
  })

  it('counts unkeyable rows instead of inventing a property', () => {
    const result = dedupePermitsByProperty([row({ pin: null, address: null })], 2026)
    expect(result.properties).toHaveLength(0)
    expect(result.unkeyable).toHaveLength(1)
  })

  it('treats a property as residential unless every permit is commercial', () => {
    const { properties } = dedupePermitsByProperty(
      [
        row({ permitNumber: 'R', isCommercial: false }),
        row({ permitNumber: 'C', isCommercial: true }),
      ],
      2026,
    )
    expect(properties[0].isCommercial).toBe(false)
  })

  it('normalizes Rowan map-lot PINs that differ only by spaces', () => {
    expect(normalizePin('001 011')).toBe('001011')
    expect(propertyKey(row({ sourceCounty: 'Rowan', pin: '001 011' }))).toBe(
      propertyKey(row({ sourceCounty: 'Rowan', pin: '001011' })),
    )
  })

  it('does not treat a null issue date as earlier than a real one', () => {
    const { properties } = dedupePermitsByProperty(
      [
        row({ permitNumber: 'A', issuedOn: '2012-05-14' }),
        row({ permitNumber: 'B', issuedOn: null }),
      ],
      2026,
    )
    expect(properties[0].issuedOn).toBe('2012-05-14')
  })

  it('summarizes installer vs PIN vs unkeyable counts by county', () => {
    const records = [
      row({
        sourceCounty: 'Cabarrus',
        pin: '111',
        contractor: 'NC SOLAR NOW',
        contractorKey: 'nc solar now',
      }),
      row({ sourceCounty: 'Cabarrus', pin: '111', permitNumber: 'EL' }),
      row({ sourceCounty: 'Mecklenburg', pin: null, address: '9 Missing Pin Rd', contractorKey: null }),
      row({ sourceCounty: 'Mecklenburg', pin: null, address: null, permitNumber: 'LOST' }),
    ]
    const result = dedupePermitsByProperty(records, 2026)
    const summary = summarizeExtract(records, result, 2026)
    const cabarrus = summary.byCounty.find((c) => c.county === 'Cabarrus')
    const meck = summary.byCounty.find((c) => c.county === 'Mecklenburg')
    expect(cabarrus?.rawPermits).toBe(2)
    expect(cabarrus?.uniqueProperties).toBe(1)
    expect(cabarrus?.uniqueWithInstaller).toBe(1)
    expect(meck?.uniqueAddressOnly).toBe(1)
    expect(meck?.unkeyable).toBe(1)
    expect(summary.totals.uniqueProperties).toBe(2)
    expect(summary.totals.unkeyable).toBe(1)
  })
})

describe('normalize helpers', () => {
  it('strips punctuation from addresses', () => {
    expect(normalizeAddress('100 Verify St.')).toBe('100 VERIFY ST')
  })

  it('rejects install years outside a plausible range', () => {
    expect(yearsSinceInstall('1980-01-01', 2026)).toBeNull()
    expect(yearsSinceInstall('2027-01-01', 2026)).toBeNull()
    expect(yearsSinceInstall('2015-06-02', 2026)).toBe(11)
  })
})
