import { calculateRoofWaste } from '@/lib/roof-waste-model'
import { ridgeHipCapOrderSummary } from '@/lib/hip-ridge-cap-squares'

describe('roof measure downstream (waste + cap)', () => {
  it('raises waste when hip LF is substantial (P-00093 class fix)', () => {
    const lowHip = calculateRoofWaste({
      baseSquares: 30,
      facetCount: 6,
      valleys_lf: 0,
      hips_lf: 15,
      ridges_lf: 40,
      avgPitchMultiplier: 1.12,
    })
    const highHip = calculateRoofWaste({
      baseSquares: 30,
      facetCount: 6,
      valleys_lf: 40,
      hips_lf: 80,
      ridges_lf: 40,
      avgPitchMultiplier: 1.12,
    })
    expect(highHip.wastePercent).toBeGreaterThan(lowHip.wastePercent)
    expect(highHip.wastePercent).toBeGreaterThanOrEqual(15)
  })

  it('computes cap order squares from ridge + hip LF', () => {
    const cap = ridgeHipCapOrderSummary({ ridges_lf: 100, hips_lf: 60 })
    expect(cap).not.toBeNull()
    expect(cap!.ridgeCapSq).toBe(1)
    expect(cap!.hipCapSq).toBe(0.6)
    expect(cap!.combinedCapSq).toBe(1.6)
  })

  it('valley LF adds measurable waste squares', () => {
    const base = calculateRoofWaste({
      baseSquares: 25,
      facetCount: 5,
      valleys_lf: 0,
      hips_lf: 50,
      ridges_lf: 50,
      avgPitchMultiplier: 1.05,
    })
    const withValleys = calculateRoofWaste({
      baseSquares: 25,
      facetCount: 5,
      valleys_lf: 50,
      hips_lf: 50,
      ridges_lf: 50,
      avgPitchMultiplier: 1.05,
    })
    expect(withValleys.breakdown.valleySq).toBeGreaterThan(base.breakdown.valleySq)
  })
})
