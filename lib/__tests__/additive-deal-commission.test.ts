import {
  ADDITIVE_DEAL_COMMISSION_ROLES,
  poolKey,
  resolveAdditiveParticipantAmount,
  scaleCommissionsToPool,
  type DealCommissionRoleParticipant,
} from '@/lib/payroll-export'
import { roundMoney } from '@/lib/money'

function participant(
  overrides: Partial<DealCommissionRoleParticipant> = {}
): DealCommissionRoleParticipant {
  return {
    userId: 'user-1',
    role: 'inspector',
    overrideAmount: null,
    overridePercent: null,
    premierPricingAmount: null,
    ...overrides,
  }
}

describe('resolveAdditiveParticipantAmount', () => {
  it('pays a percent of the commission base', () => {
    // The published inspection line: 1.5% of a $14,000 base.
    expect(resolveAdditiveParticipantAmount(participant({ overridePercent: 1.5 }), 14000)).toEqual({
      amount: 210,
      basis: 'percent',
    })
  })

  it('rounds percent results to cents', () => {
    const result = resolveAdditiveParticipantAmount(participant({ overridePercent: 1.5 }), 13333.33)
    expect(result.basis).toBe('percent')
    expect(result.amount).toBe(200)
  })

  it('prefers an explicit flat override over a percent', () => {
    expect(
      resolveAdditiveParticipantAmount(
        participant({ overrideAmount: 250, overridePercent: 1.5 }),
        14000
      )
    ).toEqual({ amount: 250, basis: 'flat' })
  })

  it('treats a zero flat override as an intentional zero, not a fallback to percent', () => {
    expect(
      resolveAdditiveParticipantAmount(
        participant({ overrideAmount: 0, overridePercent: 1.5 }),
        14000
      )
    ).toEqual({ amount: 0, basis: 'flat' })
  })

  it('pays nothing when the row carries neither an amount nor a percent', () => {
    expect(resolveAdditiveParticipantAmount(participant(), 14000)).toEqual({
      amount: 0,
      basis: 'none',
    })
  })

  it('pays nothing on a zero commission base', () => {
    expect(resolveAdditiveParticipantAmount(participant({ overridePercent: 1.5 }), 0)).toEqual({
      amount: 0,
      basis: 'percent',
    })
  })

  it('ignores premier pricing — it has no defined payout semantics', () => {
    expect(
      resolveAdditiveParticipantAmount(
        participant({ overridePercent: 1.5, premierPricingAmount: 900 }),
        14000
      )
    ).toEqual({ amount: 210, basis: 'percent' })
  })

  it('does not treat NaN or Infinity as a payable rate', () => {
    expect(resolveAdditiveParticipantAmount(participant({ overrideAmount: NaN }), 14000).basis).toBe(
      'none'
    )
    expect(
      resolveAdditiveParticipantAmount(participant({ overridePercent: Infinity }), 14000).basis
    ).toBe('none')
  })
})

describe('ADDITIVE_DEAL_COMMISSION_ROLES', () => {
  it('excludes setter and closer so pool-scaled participants are never double-paid', () => {
    expect(ADDITIVE_DEAL_COMMISSION_ROLES).not.toContain('setter')
    expect(ADDITIVE_DEAL_COMMISSION_ROLES).not.toContain('closer')
  })

  it('includes inspector', () => {
    expect(ADDITIVE_DEAL_COMMISSION_ROLES).toContain('inspector')
  })
})

describe('additive lines inside the pool cap', () => {
  // $14,000 base → 18% pool cap = $2,520.
  const compBase = 14000
  const poolCap = 2520

  it('leaves every line untouched when the job fits inside the cap', () => {
    // Setter 3% ($420) + closer 7% ($980) + inspection 1.5% ($210) = $1,610 < $2,520.
    const raw = new Map([
      [poolKey('setter-1', 'setter'), 420],
      [poolKey('closer-1', 'owner'), 980],
      [poolKey('sfm-1', 'inspector'), 210],
    ])
    const { scaled, enforced } = scaleCommissionsToPool(raw, poolCap)
    expect(enforced).toBe(false)
    expect(scaled.get(poolKey('sfm-1', 'inspector'))).toBe(210)
    expect(scaled.get(poolKey('closer-1', 'owner'))).toBe(980)
  })

  it('scales the inspection line down with everyone else when the cap is exceeded', () => {
    // Deliberately over-rich job: $1,400 + $1,400 + $210 = $3,010 > $2,520.
    const raw = new Map([
      [poolKey('setter-1', 'setter'), 1400],
      [poolKey('closer-1', 'owner'), 1400],
      [poolKey('sfm-1', 'inspector'), 210],
    ])
    const { scaled, enforced } = scaleCommissionsToPool(raw, poolCap)
    expect(enforced).toBe(true)

    // The inspection line is not privileged — it takes the same haircut as the rest.
    // 210 × (2520/3010) = 175.81. The leftover cents from per-line rounding come off
    // the largest line, not this one, so it lands on the exact proportional figure.
    const inspection = scaled.get(poolKey('sfm-1', 'inspector')) as number
    expect(inspection).toBe(175.81)

    // The cap is a real ceiling: this used to overshoot to $2,528.40 because the
    // scale factor was rounded to cents before being applied.
    const total = Array.from(scaled.values()).reduce((sum, v) => sum + v, 0)
    expect(total).toBeLessThanOrEqual(poolCap)
  })

  it('never pays out more than the cap, across a range of awkward splits', () => {
    const cases: Array<[number[], number]> = [
      [[1400, 1400, 210], 2520],
      [[1000, 1000, 1000], 2520],
      [[3333.33, 1111.11, 555.55], 2520],
      [[0.07, 0.07, 0.07], 0.1],
      [[999999, 1], 2520],
    ]
    for (const [amounts, cap] of cases) {
      const raw = new Map(amounts.map((amount, i) => [poolKey(`u${i}`, 'owner'), amount]))
      const { scaled, enforced } = scaleCommissionsToPool(raw, cap)
      expect(enforced).toBe(true)
      const total = Array.from(scaled.values()).reduce((sum, v) => sum + v, 0)
      expect(roundMoney(total)).toBeLessThanOrEqual(cap)
      // No line is ever pushed negative by the drift adjustment.
      for (const v of Array.from(scaled.values())) expect(v).toBeGreaterThanOrEqual(0)
    }
  })

  it('is deterministic — the same input always splits the same way', () => {
    const build = () =>
      new Map([
        [poolKey('a', 'owner'), 1400],
        [poolKey('b', 'setter'), 1400],
        [poolKey('c', 'inspector'), 210],
      ])
    const first = scaleCommissionsToPool(build(), poolCap).scaled
    const second = scaleCommissionsToPool(build(), poolCap).scaled
    expect(Array.from(first.entries())).toEqual(Array.from(second.entries()))
  })

  it('keeps two lines separate for one person who both closes and inspects', () => {
    const raw = new Map([
      [poolKey('rep-1', 'owner'), 980],
      [poolKey('rep-1', 'inspector'), 210],
    ])
    expect(raw.size).toBe(2)
    const { scaled } = scaleCommissionsToPool(raw, poolCap)
    expect(scaled.get(poolKey('rep-1', 'owner'))).toBe(980)
    expect(scaled.get(poolKey('rep-1', 'inspector'))).toBe(210)
  })
})
