/**
 * Per-job overrides on the POOL-SCALED producer roles (sales_rep / setter / owner).
 *
 * These rows used to be written, audited, and then silently dropped at payroll time,
 * because `ADDITIVE_DEAL_COMMISSION_ROLES` excluded them and nothing else read them.
 * Production jobs 26-0035 and 26-0036 were paid from the wrong split as a result and
 * needed a manual SQL correction. They now REPLACE the comp-plan-computed line for
 * that job + user, which is what the admin was trying to express all along.
 */

import {
  collectParticipants,
  poolKey,
  producerOverrideKey,
  producerStorageRoleForParticipant,
  resolveProducerOverrideAmount,
  scaleCommissionsToPool,
  ADDITIVE_DEAL_COMMISSION_ROLES,
  PRODUCER_OVERRIDE_STORAGE_ROLES,
  type ProducerCommissionOverride,
} from '@/lib/payroll-export'

function override(
  overrides: Partial<ProducerCommissionOverride> = {}
): ProducerCommissionOverride {
  return {
    jobId: 'job-1',
    userId: 'user-1',
    role: 'closer',
    overrideAmount: null,
    overridePercent: null,
    ...overrides,
  }
}

describe('producerStorageRoleForParticipant', () => {
  it('folds both closing roles onto the table’s single "closer" name', () => {
    expect(producerStorageRoleForParticipant('sales_rep')).toBe('closer')
    expect(producerStorageRoleForParticipant('owner')).toBe('closer')
  })

  it('keeps setter as its own storage role', () => {
    expect(producerStorageRoleForParticipant('setter')).toBe('setter')
  })

  it('covers every role collectParticipants can emit', () => {
    // If a fourth participant role is ever added, this fails rather than letting the
    // new role silently map to "closer" and steal another line's override.
    const roles = collectParticipants(
      { salesperson_id: 'a' },
      { setter_user_id: 'b', owner_user_id: 'c' }
    ).map((p) => p.role)
    expect(roles.sort()).toEqual(['owner', 'sales_rep', 'setter'])
    for (const role of roles) {
      expect(PRODUCER_OVERRIDE_STORAGE_ROLES).toContain(producerStorageRoleForParticipant(role))
    }
  })
})

describe('resolveProducerOverrideAmount', () => {
  it('returns null when there is no override row at all', () => {
    expect(resolveProducerOverrideAmount(undefined, 20000)).toBeNull()
  })

  it('treats a row with neither amount nor percent as NOT an override', () => {
    // This is the shape the admin UI writes when an override is cleared, and it is
    // what prod job 26-0033 holds. Reading it as "$0" would unpay a real setter who
    // was only ever meant to fall back to their comp plan.
    expect(resolveProducerOverrideAmount(override(), 20000)).toBeNull()
  })

  it('treats an explicit zero as a real override', () => {
    // This is how a producer is taken OFF a deal whose commission is being re-split,
    // which is exactly what 26-0035 and 26-0036 needed.
    expect(resolveProducerOverrideAmount(override({ overrideAmount: 0 }), 20000)).toEqual({
      amount: 0,
      basis: 'flat',
    })
  })

  it('pays a flat dollar override', () => {
    expect(resolveProducerOverrideAmount(override({ overrideAmount: 900 }), 21052.71)).toEqual({
      amount: 900,
      basis: 'flat',
    })
  })

  it('pays a percent of the commission base, rounded to cents', () => {
    // 26-0036: 9% of $19,976.71.
    expect(resolveProducerOverrideAmount(override({ overridePercent: 9 }), 19976.71)).toEqual({
      amount: 1797.9,
      basis: 'percent',
    })
  })

  it('prefers a flat override over a percent, matching the additive rule', () => {
    expect(
      resolveProducerOverrideAmount(
        override({ overrideAmount: 500, overridePercent: 9 }),
        19976.71
      )
    ).toEqual({ amount: 500, basis: 'flat' })
  })

  it('does not treat NaN or Infinity as a payable override', () => {
    expect(resolveProducerOverrideAmount(override({ overrideAmount: NaN }), 20000)).toBeNull()
    expect(resolveProducerOverrideAmount(override({ overridePercent: Infinity }), 20000)).toBeNull()
  })
})

describe('producerOverrideKey', () => {
  it('separates two people holding different producer roles on one job', () => {
    expect(producerOverrideKey('job-1', 'user-1', 'closer')).not.toEqual(
      producerOverrideKey('job-1', 'user-1', 'setter')
    )
    expect(producerOverrideKey('job-1', 'user-1', 'closer')).not.toEqual(
      producerOverrideKey('job-2', 'user-1', 'closer')
    )
  })
})

describe('role sets stay disjoint', () => {
  it('never lets a role be both additive and a producer replacement', () => {
    // Overlap would double-pay: the row would add a line AND replace one.
    for (const role of PRODUCER_OVERRIDE_STORAGE_ROLES) {
      expect(ADDITIVE_DEAL_COMMISSION_ROLES).not.toContain(role)
    }
  })
})

describe('the 26-0035 misallocation, before and after', () => {
  // Kavita Pachalla: $21,052.71 comp base, 18% pool cap = $3,789.49.
  // Intent: Tim (setter) $900, Nathan $1,444.75, Evan $1,444.75 = $3,789.50.
  const compBase = 21052.71
  const poolCap = 3789.49

  it('reproduces the bug: an ignored setter override plus additive customs misallocates', () => {
    // What actually happened: Tim's $900 setter override was dropped, so he kept his
    // comp-plan setter line (~5% = $1,052.64); Nathan kept his sales_rep line (~7% =
    // $1,473.69) AND took a $1,444.75 custom on top; Evan took his custom.
    const raw = new Map([
      [poolKey('tim', 'setter'), 1052.64],
      [poolKey('nathan', 'sales_rep'), 1473.69],
      [poolKey('nathan', 'custom'), 1444.75],
      [poolKey('evan', 'custom'), 1444.75],
    ])
    const { scaled, enforced } = scaleCommissionsToPool(raw, poolCap)

    expect(enforced).toBe(true)
    // The cap held — this was never an overpayment — but every share is wrong.
    const total = Array.from(scaled.values()).reduce((s, v) => s + v, 0)
    expect(Math.round(total * 100) / 100).toBeLessThanOrEqual(poolCap)
    expect(scaled.get(poolKey('tim', 'setter'))).not.toBe(900)
    // Nathan drew from two lines at once, which is the actual misallocation.
    const nathanTotal =
      (scaled.get(poolKey('nathan', 'sales_rep')) || 0) + (scaled.get(poolKey('nathan', 'custom')) || 0)
    expect(nathanTotal).toBeGreaterThan(scaled.get(poolKey('evan', 'custom')) || 0)
  })

  it('pays the intended split once producer overrides replace the comp-plan lines', () => {
    // Tim's $900 setter override now replaces his plan line, and Nathan's sales_rep
    // line is explicitly zeroed so his pay comes only from the agreed custom amount.
    const tim = resolveProducerOverrideAmount(
      override({ userId: 'tim', role: 'setter', overrideAmount: 900 }),
      compBase
    )
    const nathanProducer = resolveProducerOverrideAmount(
      override({ userId: 'nathan', role: 'closer', overrideAmount: 0 }),
      compBase
    )
    expect(tim).toEqual({ amount: 900, basis: 'flat' })
    expect(nathanProducer).toEqual({ amount: 0, basis: 'flat' })

    const raw = new Map([
      [poolKey('tim', 'setter'), tim!.amount],
      [poolKey('nathan', 'sales_rep'), nathanProducer!.amount],
      [poolKey('nathan', 'custom'), 1444.75],
      [poolKey('evan', 'custom'), 1444.75],
    ])
    const { scaled, enforced } = scaleCommissionsToPool(raw, poolCap)

    // $900 + $0 + $1,444.75 + $1,444.75 = $3,789.50, a cent over the cap, so the
    // scaler shaves the drift off the largest line rather than breaching it.
    expect(enforced).toBe(true)
    expect(scaled.get(poolKey('tim', 'setter'))).toBe(900)
    expect(scaled.get(poolKey('nathan', 'sales_rep'))).toBe(0)
    expect(scaled.get(poolKey('evan', 'custom'))).toBeCloseTo(1444.75, 1)

    const total = Array.from(scaled.values()).reduce((s, v) => s + v, 0)
    expect(Math.round(total * 100) / 100).toBeLessThanOrEqual(poolCap)
  })
})

describe('the 26-0036 misallocation', () => {
  // Debra Lynn Gullette: $19,976.71 base, 18% cap = $3,595.81.
  // Intent: Nathan 9% + Evan 9% = the whole pool, nobody else.
  const compBase = 19976.71
  const poolCap = 3595.81

  it('needs both producers zeroed, since Evan was ALSO the setter', () => {
    const nine = resolveProducerOverrideAmount(override({ overridePercent: 9 }), compBase)!
    expect(nine.amount).toBe(1797.9)

    // Without zeroing, Nathan's sales_rep line and Evan's setter line still fire and
    // dilute both custom lines down from the agreed 9%.
    const diluted = scaleCommissionsToPool(
      new Map([
        [poolKey('nathan', 'sales_rep'), 1398.37],
        [poolKey('evan', 'setter'), 998.84],
        [poolKey('nathan', 'custom'), nine.amount],
        [poolKey('evan', 'custom'), nine.amount],
      ]),
      poolCap
    )
    expect(diluted.enforced).toBe(true)
    expect(diluted.scaled.get(poolKey('nathan', 'custom'))!).toBeLessThan(nine.amount)

    // With both producer lines explicitly zeroed, the two custom lines land exactly.
    const correct = scaleCommissionsToPool(
      new Map([
        [poolKey('nathan', 'sales_rep'), 0],
        [poolKey('evan', 'setter'), 0],
        [poolKey('nathan', 'custom'), nine.amount],
        [poolKey('evan', 'custom'), nine.amount],
      ]),
      poolCap
    )
    expect(correct.enforced).toBe(false)
    expect(correct.scaled.get(poolKey('nathan', 'custom'))).toBe(nine.amount)
    expect(correct.scaled.get(poolKey('evan', 'custom'))).toBe(nine.amount)
  })
})
