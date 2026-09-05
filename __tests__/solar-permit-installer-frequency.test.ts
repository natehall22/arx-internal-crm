import { installerFrequency, installerFrequencyKey, preferSpacedKey } from '../scripts/solar-permits/installer-frequency'

describe('installer frequency grouping', () => {
  it('collapses LLC / spacing / jammed-together variants of the same name', () => {
    expect(installerFrequencyKey('POWER HOME SOLAR LLC')).toBe('powerhomesolar')
    expect(installerFrequencyKey('POWER HOME SOLAR')).toBe('powerhomesolar')
    expect(installerFrequencyKey('POWERHOME SOLAR')).toBe('powerhomesolar')
  })

  it('prefers the spaced legal-ish key as the display normalized name', () => {
    expect(preferSpacedKey(['powerhomesolar', 'power home solar'])).toBe('power home solar')
  })

  it('counts properties and permits across variants as one installer', () => {
    const rows = installerFrequency([
      {
        contractor: 'POWER HOME SOLAR LLC',
        contractorKey: 'power home solar',
        issuedOn: '2015-01-01',
        sourceCounty: 'Cabarrus',
        pin: '111',
        address: null,
        permitNumber: 'A',
      },
      {
        contractor: 'POWERHOME SOLAR',
        contractorKey: 'powerhome solar',
        issuedOn: '2018-06-02',
        sourceCounty: 'Cabarrus',
        pin: '222',
        address: null,
        permitNumber: 'B',
      },
      {
        contractor: 'POWER HOME SOLAR',
        contractorKey: 'power home solar',
        issuedOn: '2018-06-02',
        sourceCounty: 'Cabarrus',
        pin: '222',
        address: null,
        permitNumber: 'C',
      },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].normalizedInstaller).toBe('power home solar')
    expect(rows[0].propertyCount).toBe(2)
    expect(rows[0].permitCount).toBe(3)
    expect(rows[0].firstPermitDate).toBe('2015-01-01')
    expect(rows[0].lastPermitDate).toBe('2018-06-02')
    expect(rows[0].rawNameVariants).toEqual(
      expect.arrayContaining(['POWER HOME SOLAR LLC', 'POWERHOME SOLAR', 'POWER HOME SOLAR']),
    )
  })

  it('does not treat a generic ENERGY string as an installer', () => {
    expect(installerFrequencyKey('ENERGY')).toBeNull()
  })
})
