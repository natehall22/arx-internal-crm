import { classifyPermitRecord, classifyPvText, strongerPvClass } from '../scripts/solar-permits/classify-pv'

describe('classifyPvText', () => {
  it('confirms kW PV arrays', () => {
    const out = classifyPvText(['Luchey 5.76kW PV Solar ArraySolar PV1 | Luchey 5.76kW PV Solar Array'])
    expect(out.pvClass).toBe('CONFIRMED_PV')
    expect(out.evidence).toEqual(expect.arrayContaining(['kW capacity']))
  })

  it('confirms RES-SOLAR permit numbers', () => {
    expect(classifyPermitRecord({ permitNumber: 'RES-SOLAR-25-000002' }).pvClass).toBe('CONFIRMED_PV')
  })

  it('confirms roof-mounted solar even without kW', () => {
    expect(classifyPvText(['ROOF MOUNTED SOLAR PANELS']).pvClass).toBe('CONFIRMED_PV')
  })

  it('treats Skylight/Solar Panel work-type alone as ambiguous', () => {
    const out = classifyPvText(['Repair/Replace. Exterior Roof Addition(Skylight/Solar Panel).'])
    expect(out.pvClass).toBe('AMBIGUOUS_SOLAR')
  })

  it('upgrades a skylight boilerplate row that also says Solar Panels', () => {
    const out = classifyPvText([
      'Solar Panels 1827 CAVENDISH CT CHARLOTTE Repair/Replace. Exterior Roof Addition(Skylight/Solar Panel). | Solar Panels',
    ])
    expect(out.pvClass).toBe('LIKELY_PV')
  })

  it('does not treat solar-ready new construction as PV', () => {
    expect(classifyPvText(['New home — solar-ready wiring']).pvClass).toBe('NON_PV')
  })

  it('does not treat solar farms as residential rooftop PV', () => {
    expect(classifyPvText(['interested in developing a solar farm on the property']).pvClass).toBe('NON_PV')
  })

  it('does not treat solar water heaters as PV', () => {
    expect(classifyPvText(['install solar water heater']).pvClass).toBe('NON_PV')
  })

  it('confirms EPIC SolarPV subtype', () => {
    expect(classifyPermitRecord({ permitSubtype: 'SolarPV', description: 'roof work' }).pvClass).toBe(
      'CONFIRMED_PV',
    )
  })

  it('rolls property class up to the strongest permit', () => {
    expect(strongerPvClass('AMBIGUOUS_SOLAR', 'CONFIRMED_PV')).toBe('CONFIRMED_PV')
    expect(strongerPvClass('LIKELY_PV', 'NON_PV')).toBe('LIKELY_PV')
  })
})
