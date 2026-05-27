import { hipRidgeCapFromLinearFt } from '@/lib/hip-ridge-cap-squares'

function wasteFromHipsValleys(hipLength: number, valleyLength: number, facetCount: number, totalArea: number) {
  let baseWaste = 10
  if (facetCount <= 4) baseWaste = 10
  else if (facetCount <= 8) baseWaste = 12
  else baseWaste = 15

  let adjustments = 0
  if (valleyLength > 20) adjustments += Math.min(3, Math.floor(valleyLength / 30))
  if (hipLength > 20) adjustments += Math.max(2, Math.min(5, Math.ceil(hipLength / 50)))
  const avgFacetSize = totalArea / Math.max(facetCount, 1)
  if (avgFacetSize < 200) adjustments += 2

  let finalWaste = Math.min(baseWaste + adjustments, 25)
  if (hipLength > 60 && valleyLength > 40) finalWaste = Math.max(finalWaste, 17)
  else if (hipLength > 60) finalWaste = Math.max(finalWaste, 15)
  return finalWaste
}

describe('roof measure downstream (waste + cap)', () => {
  it('raises waste when hip LF is substantial (P-00093 class fix)', () => {
    const lowHip = wasteFromHipsValleys(15, 0, 6, 3000)
    const highHip = wasteFromHipsValleys(80, 40, 6, 3000)
    expect(highHip).toBeGreaterThan(lowHip)
    expect(highHip).toBeGreaterThanOrEqual(15)
  })

  it('computes cap squares from ridge + hip LF', () => {
    const cap = hipRidgeCapFromLinearFt({ ridges_lf: 100, hips_lf: 60 })
    expect(cap).not.toBeNull()
    expect(cap!.combinedLf).toBe(160)
    expect(cap!.capSq).toBeGreaterThan(0)
  })
})
