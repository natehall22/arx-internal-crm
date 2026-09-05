import { joinDukeRows, buildOwnerIndex, buildLastCityIndex, recoverDukeByUniqueLastCity, type OwnerParcel } from '../scripts/solar-permits/duke-join'
import { parseDukeNmLayoutLine, parseDukeNmLayoutText } from '../scripts/solar-permits/duke-nm'
import {
  countyForMetroCity,
  canonicalCity,
  parseCityZipFromAddress,
  isEastCharlotteCanvass,
  isSouthCharlotteCanvass,
} from '../scripts/solar-permits/metro-cities'
import {
  peopleFromLastFirstName,
  peopleFromTaxRecord,
  peopleFromWesternName,
} from '../scripts/solar-permits/owner-name'

describe('owner name keys', () => {
  it('parses Duke western order and tax last-first onto the same last/first', () => {
    const duke = peopleFromWesternName('Andrew R Copeland')
    const tax = peopleFromLastFirstName('COPELAND ANDREW R')
    expect(duke[0]).toMatchObject({ last: 'COPELAND', first: 'ANDREW R', firstToken: 'ANDREW' })
    expect(tax[0]).toMatchObject({ last: 'COPELAND', first: 'ANDREW R', firstToken: 'ANDREW' })
  })

  it('splits "Thomas J and Marianne Mylet" using the shared surname', () => {
    const people = peopleFromWesternName('Thomas J and Marianne Mylet')
    expect(people).toEqual([
      { last: 'MYLET', first: 'THOMAS J', firstToken: 'THOMAS' },
      { last: 'MYLET', first: 'MARIANNE', firstToken: 'MARIANNE' },
    ])
  })

  it('uses OneMap ownfrst/ownlast when present (Mecklenburg)', () => {
    const people = peopleFromTaxRecord({
      ownname: 'ERIC SAMUEL COHEN',
      ownfrst: 'ERIC SAMUEL',
      ownlast: 'COHEN',
    })
    expect(people[0]).toMatchObject({ last: 'COHEN', first: 'ERIC SAMUEL', firstToken: 'ERIC' })
  })
})

describe('metro city mapping', () => {
  it('maps Charlotte-metro variants to the right county and ignores Triangle cities', () => {
    expect(countyForMetroCity('Charlotte')).toBe('Mecklenburg')
    expect(countyForMetroCity('Mt. Holly')).toBe('Gaston')
    expect(countyForMetroCity('MINT HILL')).toBe('Mecklenburg')
    expect(countyForMetroCity('Denver')).toBe('Lincoln')
    expect(countyForMetroCity('Raleigh')).toBeNull()
    expect(canonicalCity('GASTONIA CITY')).toBe('GASTONIA')
  })

  it('pulls city/zip out of Cabarrus permit addresses', () => {
    expect(parseCityZipFromAddress('1255 ODELL SCHOOL RD, CONCORD, NC 28027')).toEqual({
      city: 'CONCORD',
      zip: '28027',
    })
  })

  it('keeps Cabarrus, Rowan, and east Meck; drops west/north/south metro', () => {
    expect(isEastCharlotteCanvass({ sourceCounty: 'Cabarrus', city: 'Concord', zip: '28027' })).toBe(true)
    expect(isEastCharlotteCanvass({ sourceCounty: 'Rowan', city: 'Salisbury', zip: '28144' })).toBe(true)
    expect(isEastCharlotteCanvass({ sourceCounty: 'Mecklenburg', city: 'Mint Hill', zip: '28227' })).toBe(true)
    expect(isEastCharlotteCanvass({ sourceCounty: 'Mecklenburg', city: 'Charlotte', zip: '28212' })).toBe(true)
    expect(
      isEastCharlotteCanvass({
        sourceCounty: 'Mecklenburg',
        city: 'Charlotte',
        zip: '',
        address: '100 ALBEMARLE RD, CHARLOTTE, NC 28205',
      }),
    ).toBe(true)
    expect(isEastCharlotteCanvass({ sourceCounty: 'Cabarrus', city: 'Huntersville', zip: '28078' })).toBe(false)
    expect(
      isEastCharlotteCanvass({
        sourceCounty: 'Cabarrus',
        city: '',
        zip: '',
        address: '1304 MALDEN ST HUNTERSVILLE NC 28078',
      }),
    ).toBe(false)
    expect(isEastCharlotteCanvass({ sourceCounty: 'Mecklenburg', city: 'Charlotte', zip: '28277' })).toBe(false)
    expect(isEastCharlotteCanvass({ sourceCounty: 'Mecklenburg', city: 'Charlotte', zip: '28269' })).toBe(false)
    expect(isEastCharlotteCanvass({ sourceCounty: 'Mecklenburg', city: 'Huntersville', zip: '28078' })).toBe(false)
    expect(isEastCharlotteCanvass({ sourceCounty: 'Gaston', city: 'Gastonia', zip: '28052' })).toBe(false)
    expect(isEastCharlotteCanvass({ sourceCounty: 'Iredell', city: 'Mooresville', zip: '28115' })).toBe(false)
    expect(isEastCharlotteCanvass({ sourceCounty: 'Union', city: 'Waxhaw', zip: '28173' })).toBe(false)
  })

  it('keeps south Charlotte and Matthews/Pineville; drops Steele Creek and east-side zips', () => {
    expect(isSouthCharlotteCanvass({ sourceCounty: 'Mecklenburg', city: 'Charlotte', zip: '28277' })).toBe(true)
    expect(isSouthCharlotteCanvass({ sourceCounty: 'Mecklenburg', city: 'Charlotte', zip: '28210' })).toBe(true)
    expect(isSouthCharlotteCanvass({ sourceCounty: 'Mecklenburg', city: 'Matthews', zip: '28105' })).toBe(true)
    expect(isSouthCharlotteCanvass({ sourceCounty: 'Mecklenburg', city: 'Pineville', zip: '28134' })).toBe(true)
    expect(
      isSouthCharlotteCanvass({
        sourceCounty: 'Mecklenburg',
        city: 'Charlotte',
        zip: '',
        address: '100 BALLANTYNE COMMONS PKWY, CHARLOTTE, NC 28277',
      }),
    ).toBe(true)
    expect(isSouthCharlotteCanvass({ sourceCounty: 'Mecklenburg', city: 'Charlotte', zip: '28278' })).toBe(false)
    expect(isSouthCharlotteCanvass({ sourceCounty: 'Mecklenburg', city: 'Huntersville', zip: '282078' })).toBe(false)
    expect(isSouthCharlotteCanvass({ sourceCounty: 'Mecklenburg', city: 'Charlotte', zip: '28215' })).toBe(false)
    expect(isSouthCharlotteCanvass({ sourceCounty: 'Mecklenburg', city: 'Charlotte', zip: '28269' })).toBe(false)
    expect(isSouthCharlotteCanvass({ sourceCounty: 'Union', city: 'Waxhaw', zip: '28173' })).toBe(false)
  })
})

describe('Duke NM layout parse', () => {
  it('reads a pdftotext -layout data line', () => {
    const row = parseDukeNmLayoutLine(
      'Phoebe N Coddington                   Charlotte               NC               9.12',
      'DEC',
    )
    expect(row).toMatchObject({
      accountName: 'Phoebe N Coddington',
      city: 'Charlotte',
      kwDc: 9.12,
      county: 'Mecklenburg',
    })
  })

  it('skips header lines', () => {
    const rows = parseDukeNmLayoutText(
      'Customer Account Name                 City                    State\nRecord Count: 19144\n',
      'DEC',
    )
    expect(rows).toEqual([])
  })
})

describe('Duke unique tax join', () => {
  const parcels: OwnerParcel[] = [
    {
      county: 'Mecklenburg',
      pin: '111',
      ownerName: 'PHOEBE N CODDINGTON',
      ownerFirst: 'PHOEBE N',
      ownerLast: 'CODDINGTON',
      address: '1 MAIN ST',
      city: 'CHARLOTTE',
      zip: '28202',
    },
    {
      county: 'Mecklenburg',
      pin: '222',
      ownerName: 'MICHAEL TAYLOR',
      ownerFirst: 'MICHAEL',
      ownerLast: 'TAYLOR',
      address: '2 MAIN ST',
      city: 'CHARLOTTE',
      zip: '28202',
    },
    {
      county: 'Mecklenburg',
      pin: '223',
      ownerName: 'MICHAEL TAYLOR',
      ownerFirst: 'MICHAEL',
      ownerLast: 'TAYLOR',
      address: '3 MAIN ST',
      city: 'CHARLOTTE',
      zip: '28203',
    },
  ]

  it('joins a unique owner and refuses an ambiguous Michael Taylor', () => {
    const index = buildOwnerIndex(parcels)
    const { hits, unmatched } = joinDukeRows(
      [
        {
          utility: 'DEC',
          accountName: 'Phoebe N Coddington',
          city: 'Charlotte',
          kwDc: 9.12,
          county: 'Mecklenburg',
        },
        {
          utility: 'DEC',
          accountName: 'Michael Taylor',
          city: 'Charlotte',
          kwDc: 9.12,
          county: 'Mecklenburg',
        },
      ],
      index,
    )
    expect(hits).toHaveLength(1)
    expect(hits[0].parcel.pin).toBe('111')
    expect(unmatched).toBe(1)
  })

  it('recovers a Cabarrus Duke row when the last name is unique in that city', () => {
    const cabarrusParcels: OwnerParcel[] = [
      {
        county: 'Cabarrus',
        pin: 'pin-y',
        ownerName: 'YARBOROUGH TOMMY W',
        ownerFirst: 'TOMMY W',
        ownerLast: 'YARBOROUGH',
        address: '10 MAIN ST',
        city: 'CONCORD',
        zip: '28025',
      },
      {
        county: 'Cabarrus',
        pin: 'pin-s1',
        ownerName: 'SMITH JOHN',
        ownerFirst: 'JOHN',
        ownerLast: 'SMITH',
        address: '11 MAIN ST',
        city: 'CONCORD',
        zip: '28025',
      },
      {
        county: 'Cabarrus',
        pin: 'pin-s2',
        ownerName: 'SMITH JANE',
        ownerFirst: 'JANE',
        ownerLast: 'SMITH',
        address: '12 MAIN ST',
        city: 'CONCORD',
        zip: '28025',
      },
    ]
    const lastCity = buildLastCityIndex(cabarrusParcels)
    const recovered = recoverDukeByUniqueLastCity(
      [
        {
          utility: 'DEC',
          accountName: 'Tommy W Yarborough',
          city: 'Concord',
          kwDc: 1.55,
          county: 'Cabarrus',
        },
        {
          utility: 'DEC',
          accountName: 'John Smith',
          city: 'Concord',
          kwDc: 5,
          county: 'Cabarrus',
        },
      ],
      lastCity,
    )
    expect(recovered).toHaveLength(1)
    expect(recovered[0].parcel.pin).toBe('pin-y')
  })
})
