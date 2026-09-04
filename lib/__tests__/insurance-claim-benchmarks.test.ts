import {
  getInsuranceClaimBenchmarkAppendix,
  INSURANCE_CLAIM_BENCHMARKS,
} from '@/lib/ai/insurance-claim-benchmarks'

describe('insurance claim benchmarks', () => {
  it('adds dated, caveated benchmarks for insurance questions', () => {
    const appendix = getInsuranceClaimBenchmarkAppendix(
      'Compare this insurance claim roof measurement with recent carrier estimates'
    )

    expect(appendix).toContain('<crm_insurance_benchmark_data>')
    expect(appendix).toContain('not current carrier pricing')
    expect(appendix).toContain('farm-bureau-three-structure')
  })

  it('does not add benchmark tokens to unrelated CRM navigation questions', () => {
    expect(getInsuranceClaimBenchmarkAppendix('Where do I schedule the crew?')).toBe('')
  })

  it('keeps customer PII out of the runtime benchmark set', () => {
    const serialized = JSON.stringify(INSURANCE_CLAIM_BENCHMARKS)
    for (const pii of [
      'Susan Lloyd',
      'Diana Morales',
      'Jason Wittersheim',
      'Caitlin Kaestner',
      'Denbur',
      'Bostian',
      'Mount Olivet',
      'Spring St',
      '0836911826',
      '01010064621',
    ]) {
      expect(serialized).not.toContain(pii)
    }
  })
})
