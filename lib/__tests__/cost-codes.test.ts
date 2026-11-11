import { buildBudgetView, budgetState, codeForLine, costTypeForCode, DEFAULT_COST_CODES, parseBudgetAmount, resolveCostCodes, slugifyCostCode } from '@/lib/cost-codes'

describe('cost codes', () => {
  it('defaults when a company has not set its own', () => {
    expect(resolveCostCodes([]).map((c) => c.label)).toEqual(['Materials', 'Labor', 'Sub', 'Permit', 'Dump', 'Equipment', 'Other'])
    expect(resolveCostCodes(null)).toHaveLength(DEFAULT_COST_CODES.length)
  })
  it('a company list replaces the defaults, skips bad/duplicate rows and keeps order', () => {
    const codes = resolveCostCodes([{ code: 'framing', label: ' Framing ' }, { code: 'Bad Code', label: 'x' }, { code: 'framing', label: 'dup' }, { code: 'slab', label: 'Slab', active: false }])
    expect(codes.map((c) => [c.code, c.label, c.active])).toEqual([['framing', 'Framing', true], ['slab', 'Slab', false]])
  })
  it('a line without a code falls under its cost_type default', () => {
    expect(codeForLine({ cost_type: 'material' })).toBe('materials')
    expect(codeForLine({ cost_type: 'subcontractor' })).toBe('sub')
    expect(codeForLine({ cost_type: 'misc' })).toBe('other')
    expect(codeForLine({ cost_type: 'other', cost_code: 'dump' })).toBe('dump')
  })
  it('a code maps back to a ledger cost_type so Materials/Labor rollups stay right', () => {
    expect(costTypeForCode('materials', DEFAULT_COST_CODES)).toBe('material')
    expect(costTypeForCode('dump', DEFAULT_COST_CODES)).toBe('other')
    expect(costTypeForCode('unknown', DEFAULT_COST_CODES)).toBe('other')
  })
  it('slugs', () => expect(slugifyCostCode('Site Work / Grading')).toBe('site_work_grading'))
  it('parses budget amounts', () => {
    expect(parseBudgetAmount('$1,250.5')).toBe(1250.5)
    expect(parseBudgetAmount('-1')).toBeNull()
    expect(parseBudgetAmount('abc')).toBeNull()
    expect(parseBudgetAmount(0)).toBe(0)
  })
})

describe('budget vs actual', () => {
  it('colors: green under 90%, amber 90-100%, red over, gray without a budget', () => {
    expect(budgetState(1000, 500)).toBe('under')
    expect(budgetState(1000, 900)).toBe('near')
    expect(budgetState(1000, 1000)).toBe('near')
    expect(budgetState(1000, 1000.01)).toBe('over')
    expect(budgetState(null, 500)).toBe('none')
    expect(budgetState(null, 0)).toBe('none')
    expect(budgetState(0, 50)).toBe('over')
  })
  it('variance = budget - actual per code; actual from ledger lines; null cost_code uses cost_type', () => {
    const v = buildBudgetView({
      codes: resolveCostCodes([]),
      budgets: [{ cost_code: 'materials', amount: 5000 }, { cost_code: 'labor', amount: 2000 }],
      lines: [
        { amount: 1200, cost_type: 'material' },
        { amount: 800, cost_type: 'material', cost_code: 'materials' },
        { amount: 2500, cost_type: 'labor' },
        { amount: 300, cost_type: 'other', cost_code: 'dump' },
      ],
    })
    const by = (c: string) => v.rows.find((r) => r.code === c)!
    expect(by('materials')).toMatchObject({ budget: 5000, actual: 2000, variance: 3000, state: 'under' })
    expect(by('labor')).toMatchObject({ budget: 2000, actual: 2500, variance: -500, state: 'over' })
    expect(by('dump')).toMatchObject({ budget: null, actual: 300, variance: null, state: 'none' })
    expect(v.totalBudget).toBe(7000)
    expect(v.totalActual).toBe(4800)
    expect(v.totalVariance).toBe(2200)
  })
  it('credits net off, the dealer-fee system line is never job cost, and a removed code with spend still shows', () => {
    const v = buildBudgetView({
      codes: resolveCostCodes([{ code: 'framing', label: 'Framing' }]),
      budgets: [{ cost_code: 'framing', amount: 1000 }],
      lines: [
        { amount: 900, cost_type: 'other', cost_code: 'framing' },
        { amount: -100, cost_type: 'other', cost_code: 'framing' },
        { amount: 500, cost_type: 'other', description: 'Lender / dealer fee' },
        { amount: 75, cost_type: 'permit' },
      ],
    })
    expect(v.rows.find((r) => r.code === 'framing')).toMatchObject({ actual: 800, variance: 200 })
    expect(v.rows.find((r) => r.code === 'permit')).toMatchObject({ actual: 75, active: false, label: 'Permit' })
    expect(v.rows.find((r) => r.code === 'other')).toBeUndefined()
    expect(v.totalActual).toBe(875)
  })
  it('inactive codes with nothing on them are hidden', () => {
    const v = buildBudgetView({ codes: resolveCostCodes([{ code: 'a', label: 'A' }, { code: 'b', label: 'B', active: false }]), budgets: [], lines: [] })
    expect(v.rows.map((r) => r.code)).toEqual(['a'])
  })
})
