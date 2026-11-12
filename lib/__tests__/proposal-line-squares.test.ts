import {
  findStaleSquareLines,
  keepLinesWhenRoofingTypeChanges,
} from '@/lib/proposal-line-squares'
import {
  inferSoldRoofSquaresFromLineItems,
  resolveContractTotalSquares,
  resolveProposalSoldRoofSquares,
} from '@/lib/sold-roof-squares'

const install = (q: number, extra = {}) => ({
  id: 'abc',
  category: 'Roofing',
  name: 'Asphalt Shingles Installation',
  description: '11.75 sq + 12% waste = 13.16 sq (order rec: 14 sq)',
  unit: 'square',
  quantity: q,
  is_adder: false,
  ...extra,
})
const labor = { category: 'roofing', name: 'Sub Labor', description: '', unit: 'square', quantity: 3275.01, is_adder: false }
const dump = { category: 'roofing', name: 'Dump Fee', description: '', unit: 'square', quantity: 3275.01, is_adder: false }
const cap = { category: 'Roofing', name: 'Ridge Cap Shingles', description: '1.07 sq cap order', unit: 'square', quantity: 1.07, is_adder: false }

describe('resolveProposalSoldRoofSquares', () => {
  it('ignores per-square labor, dump and cap lines', () => {
    expect(resolveProposalSoldRoofSquares({ sold_squares: null }, [labor, dump, cap])).toBeNull()
    expect(resolveProposalSoldRoofSquares({ sold_squares: 13.16 }, [labor, dump, cap])).toBe(13.16)
    expect(resolveProposalSoldRoofSquares({ sold_squares: 13.16 }, [labor, dump, install(13.16)])).toBe(13.16)
  })
  it('uses the roofing line when nothing is stored, reading its quantity not its text', () => {
    expect(resolveProposalSoldRoofSquares({}, [labor, install(13.16), dump])).toBe(13.16)
    expect(inferSoldRoofSquaresFromLineItems([install(28.19, { description: '25 sq + 12% waste = 28.2 sq' })])).toBe(28.19)
  })
  it('keeps a manual bump of the roofing line above the stored value', () => {
    expect(resolveProposalSoldRoofSquares({ sold_squares: 28.56 }, [install(33)])).toBe(33)
  })
  it('stored value wins over a smaller roofing line', () => {
    expect(resolveProposalSoldRoofSquares({ sold_squares: 29.56 }, [install(26)])).toBe(29.56)
  })
  it('recognises the builder line by id before it is saved', () => {
    expect(resolveProposalSoldRoofSquares({}, [{ ...install(10), id: 'roofing-x', description: '' }])).toBe(10)
  })
  it('contract total squares is not inflated by labor lines', () => {
    expect(resolveContractTotalSquares({ sold_squares: 13.16, recommended_order_squares: 14 }, [labor, dump])).toBe(13.16)
  })
})

describe('findStaleSquareLines', () => {
  const l = (id: string, quantity: number, extra = {}) => ({ id, name: 'Sub Labor', unit: 'square', quantity, ...extra })
  it('flags a per-square line more than 10% off the sold squares', () => {
    expect(findStaleSquareLines([l('a', 3275.01)], 13.16)).toEqual([{ id: 'a', name: 'Sub Labor', quantity: 3275.01, soldSquares: 13.16 }])
    expect(findStaleSquareLines([l('a', 11.75)], 13.16)).toHaveLength(1)
  })
  it('leaves lines within 10%, non-square lines and cap lines alone', () => {
    expect(findStaleSquareLines([l('a', 13.16), l('b', 12.0)], 13.16)).toEqual([])
    expect(findStaleSquareLines([l('c', 500, { unit: 'each' })], 13.16)).toEqual([])
    expect(findStaleSquareLines([l('d', 1.07, { name: 'Ridge Cap Shingles' }), l('hip-cap-auto', 0.7)], 13.16)).toEqual([])
  })
  it('flags nothing without a usable sold-squares figure', () => {
    expect(findStaleSquareLines([l('a', 5)], 0)).toEqual([])
    expect(findStaleSquareLines([l('a', 5)], NaN)).toEqual([])
  })
})

describe('keepLinesWhenRoofingTypeChanges', () => {
  it('keeps adders and other lines, drops only roofing/installation lines', () => {
    const prev = [
      { name: 'Asphalt Shingles Installation', is_adder: false },
      { name: 'Ridge Cap Shingles', is_adder: false },
      { name: 'Tear-off', is_adder: true },
      { name: 'Seamless Gutters', is_adder: true },
      { name: 'Roofing adder', is_adder: true },
    ]
    expect(keepLinesWhenRoofingTypeChanges(prev).map((i) => i.name)).toEqual([
      'Ridge Cap Shingles',
      'Tear-off',
      'Seamless Gutters',
      'Roofing adder',
    ])
  })
})
