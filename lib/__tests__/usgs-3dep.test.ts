import {
  qualityRank,
  selectBestLidarCollection,
  type UsgsLidarCollection,
} from '@/lib/usgs-3dep'

function collection(
  overrides: Partial<UsgsLidarCollection> = {},
): UsgsLidarCollection {
  return {
    workunit: 'unit',
    project: 'project',
    collectStart: '2020-01-01',
    collectEnd: '2020-02-01',
    qualityLevel: 'QL 2',
    specification: 'spec',
    category: 'Meets',
    reason: '',
    pointCloudUrl: null,
    metadataUrl: null,
    ...overrides,
  }
}

describe('USGS 3DEP collection selection', () => {
  it('ranks QL0 through QL3 in quality order', () => {
    expect(['QL 0', 'QL 1', 'QL 2', 'QL 3'].map(qualityRank)).toEqual([4, 3, 2, 1])
    expect(qualityRank('Other')).toBe(0)
  })

  it('prefers a conforming collection over newer legacy data', () => {
    const selected = selectBestLidarCollection([
      collection({
        workunit: 'legacy',
        collectEnd: '2025-01-01',
        qualityLevel: 'Other',
        category: 'Does not meet',
      }),
      collection({ workunit: 'usable', collectEnd: '2020-01-01', qualityLevel: 'QL 1' }),
    ])
    expect(selected?.workunit).toBe('usable')
  })

  it('uses quality, then acquisition date, among equally conforming collections', () => {
    const selected = selectBestLidarCollection([
      collection({ workunit: 'newer-ql2', collectEnd: '2024-01-01' }),
      collection({ workunit: 'older-ql1', collectEnd: '2022-01-01', qualityLevel: 'QL 1' }),
    ])
    expect(selected?.workunit).toBe('older-ql1')
  })
})
