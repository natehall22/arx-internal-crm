/** @jest-environment node */
import { canonicalDevelopment } from '@/lib/developments-db'
import { parseLots, placeholderLotAddress } from '@/lib/lots'
import { cleanPropertyInput, developmentKey, lotLabel } from '@/lib/properties'

describe('lotLabel', () => {
  it('shows "Lot 14 · Oak Ridge", either half alone, and nothing for a normal property', () => {
    expect(lotLabel({ community: 'Oak Ridge', lot: '14' })).toBe('Lot 14 · Oak Ridge')
    expect(lotLabel({ community: 'Oak Ridge', lot: null })).toBe('Oak Ridge')
    expect(lotLabel({ community: null, lot: '14' })).toBe('Lot 14')
    expect(lotLabel({ community: 'Oak Ridge', lot: 'Lot 14' })).toBe('Lot 14 · Oak Ridge')
    expect(lotLabel({ community: 'Oak Ridge', lot: '#14' })).toBe('#14 · Oak Ridge')
    expect(lotLabel({ community: null, lot: null })).toBeNull()
    expect(lotLabel(null)).toBeNull()
  })
})

describe('development names', () => {
  it('"Oak Ridge" and "oak  ridge " are one development', () => {
    expect(developmentKey('Oak Ridge')).toBe(developmentKey(' oak   ridge '))
    expect(canonicalDevelopment(' oak  ridge ', [{ name: 'Oak Ridge', key: 'oak ridge' }])).toBe('Oak Ridge')
    expect(canonicalDevelopment('  New   Place ', [{ name: 'Oak Ridge', key: 'oak ridge' }])).toBe('New Place')
    expect(canonicalDevelopment('   ', [])).toBeNull()
  })
  it('a property accepts a development and lot, with length limits', () => {
    const ok = cleanPropertyInput({ address_line1: '1 A St', community: 'Oak Ridge', lot: '14' }, 'create')
    expect(ok.ok && ok.value).toMatchObject({ community: 'Oak Ridge', lot: '14' })
    expect(cleanPropertyInput({ address_line1: '1 A St', lot: 'x'.repeat(41) }, 'create').ok).toBe(false)
    const clear = cleanPropertyInput({ community: '' }, 'edit')
    expect(clear.ok && clear.value).toEqual({ community: null })
  })
})

describe('parseLots', () => {
  it('lot numbers alone, one per line', () => {
    expect(parseLots('1\n2\n3').rows.map((r) => r.lot)).toEqual(['1', '2', '3'])
  })
  it('positional columns: lot, address, city, state, zip (commas or tabs)', () => {
    const r = parseLots('1, 120 Oak Ridge Dr, Concord, NC, 28027\n2\t124 Oak Ridge Dr').rows
    expect(r[0]).toEqual({ lot: '1', address: '120 Oak Ridge Dr', city: 'Concord', state: 'NC', zip: '28027' })
    expect(r[1]).toMatchObject({ lot: '2', address: '124 Oak Ridge Dr' })
  })
  it('a header row in any column order, quoted addresses with commas', () => {
    const r = parseLots('Address,Lot #,City\n"12 Oak St, Unit 2",14,Concord').rows
    expect(r).toEqual([{ lot: '14', address: '12 Oak St, Unit 2', city: 'Concord', state: '', zip: '' }])
  })
  it('reports blank lot numbers and duplicates, keeps the first duplicate', () => {
    const p = parseLots('1, A\n, B\n1, C')
    expect(p.rows).toHaveLength(1)
    expect(p.rows[0].address).toBe('A')
    expect(p.problems).toHaveLength(2)
  })
  it('caps the list', () => {
    const big = Array.from({ length: 1005 }, (_, i) => String(i + 1)).join('\n')
    const p = parseLots(big)
    expect(p.rows).toHaveLength(1000)
    expect(p.problems.join(' ')).toMatch(/first 1000/)
  })
  it('placeholder address is unique per development', () => {
    expect(placeholderLotAddress('14', 'Oak Ridge')).toBe('Lot 14, Oak Ridge')
    expect(placeholderLotAddress('Lot 14', 'Oak Ridge')).toBe('Lot 14, Oak Ridge')
  })
})
