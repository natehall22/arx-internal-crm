import { isPlaceholderVisionFacet, isStackedBandVisionTrace } from '@/lib/roof-vision-quality'

describe('roof vision quality gates', () => {
  it('rejects stacked placeholder band traces', () => {
    const facets = [
      { vertices: [[100, 100], [300, 100], [300, 145], [200, 145], [100, 145]] as [number, number][] },
      { vertices: [[100, 150], [305, 150], [305, 195], [200, 195], [100, 195]] as [number, number][] },
      { vertices: [[95, 200], [302, 200], [302, 245], [200, 245], [95, 245]] as [number, number][] },
    ]

    expect(isStackedBandVisionTrace(facets)).toBe(true)
  })

  it('does not reject sloped, distinct roof-plane polygons', () => {
    const facets = [
      { vertices: [[120, 120], [220, 95], [280, 145], [245, 205], [150, 190], [105, 155]] as [number, number][] },
      { vertices: [[230, 110], [325, 135], [350, 205], [285, 245], [245, 205], [280, 145]] as [number, number][] },
      { vertices: [[145, 195], [245, 210], [285, 255], [230, 300], [130, 270], [105, 225]] as [number, number][] },
    ]

    expect(isStackedBandVisionTrace(facets)).toBe(false)
    expect(facets.some((facet) => isPlaceholderVisionFacet(facet))).toBe(false)
  })

  it('rejects a padded rectangle disguised with a fifth vertex', () => {
    const facet = {
      vertices: [[80, 80], [220, 80], [220, 160], [150, 160], [80, 160]] as [number, number][],
    }

    expect(isPlaceholderVisionFacet(facet)).toBe(true)
  })
})
