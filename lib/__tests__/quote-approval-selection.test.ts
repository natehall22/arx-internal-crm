/** @jest-environment node */
jest.mock('@/app/api/contracts/sign/route', () => ({ POST: jest.fn() }))
import { cleanTypedName, validateSelection } from '@/lib/quotes/approve'

const ctx = { lines: [{ id: 'a', line_total: 1 }, { id: 'o1', line_total: 1, is_optional: true }, { id: 'o2', line_total: 1, is_optional: true }] } as never

describe('approval input', () => {
  it('accepts only unique ids of this quote’s optional lines', () => {
    expect(validateSelection(ctx, ['o1', 'o1'])).toEqual({ ids: ['o1'] })
    expect(validateSelection(ctx, [])).toEqual({ ids: [] })
    expect('error' in validateSelection(ctx, ['a'])).toBe(true)
    expect('error' in validateSelection(ctx, ['zzz'])).toBe(true)
    expect('error' in validateSelection(ctx, 'o1')).toBe(true)
  })
  it('cleans the typed name and refuses markup or empties', () => {
    expect(cleanTypedName('  Ann   Lee ')).toBe('Ann Lee')
    expect(cleanTypedName('<b>x</b>')).toBeNull()
    expect(cleanTypedName('A')).toBeNull()
    expect(cleanTypedName(5)).toBeNull()
  })
})
