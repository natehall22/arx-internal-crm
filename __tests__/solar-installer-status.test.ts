import {
  ALIAS_GROUPS,
  getInstallerStatus,
  resolveCanonicalFrequencyKey,
  toFrequencyKey,
} from '../scripts/solar-permits/installer-status'

describe('solar-permits installer alias grouping', () => {
  const pinkEnergyGroup = ALIAS_GROUPS.find((g) => g.canonical === 'powerhomesolar')!

  it('merges power home solar / pink energy / p0wer typo aliases to one canonical key', () => {
    const members = [
      'power home solar',
      'power home solar roofing',
      'p0wer home solar',
      'power home solars',
      'ge ec power home solar',
    ]

    const freqKeys = members.map((name) => toFrequencyKey(name))
    expect(freqKeys).toEqual([
      'powerhomesolar',
      'powerhomesolarroofing',
      'p0werhomesolar',
      'powerhomesolars',
      'geecpowerhomesolar',
    ])

    for (const key of freqKeys) {
      expect(pinkEnergyGroup.members).toContain(key)
      expect(resolveCanonicalFrequencyKey(key)).toBe('powerhomesolar')
    }

    const status = getInstallerStatus('p0werhomesolar', 'p0wer home solar')
    expect(status.status).toBe('BANKRUPT')
    expect(status.confidence).toBe('HIGH')
    expect(status.evidenceSummary).toMatch(/Pink Energy/i)
  })
})
