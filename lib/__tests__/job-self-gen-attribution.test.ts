import {
  normalizeSelfGenRate,
  resolveSelfGenCredit,
  withDerivedSelfGen,
  NO_SELF_GEN,
  payableSelfGenFlag,
} from '@/lib/job-self-gen-attribution'
import type { DealCommissionRoleParticipant } from '@/lib/payroll-export'

describe('resolveSelfGenCredit', () => {
  it('credits the opportunity owner on a clean self-gen deal', () => {
    expect(
      resolveSelfGenCredit({
        isSelfGenerated: true,
        ownerUserId: 'closer-1',
        setterUserId: 'closer-1',
        salespersonId: 'closer-1',
      })
    ).toEqual({ creditUserId: 'closer-1', conflictWithSetter: false })
  })

  it('treats a self-gen deal with no setter at all as clean', () => {
    expect(
      resolveSelfGenCredit({
        isSelfGenerated: true,
        ownerUserId: 'closer-1',
        setterUserId: null,
        salespersonId: 'closer-1',
      })
    ).toEqual({ creditUserId: 'closer-1', conflictWithSetter: false })
  })

  it('flags a conflict when a self-gen deal also carries a different setter', () => {
    expect(
      resolveSelfGenCredit({
        isSelfGenerated: true,
        ownerUserId: 'closer-1',
        setterUserId: 'setter-9',
        salespersonId: 'closer-1',
      })
    ).toEqual({ creditUserId: 'closer-1', conflictWithSetter: true })
  })

  it('falls back to the job salesperson when the opportunity has no owner', () => {
    expect(
      resolveSelfGenCredit({
        isSelfGenerated: true,
        ownerUserId: null,
        setterUserId: null,
        salespersonId: 'rep-7',
      })
    ).toEqual({ creditUserId: 'rep-7', conflictWithSetter: false })
  })

  it('requires a strictly true flag — null (never reviewed) is not self-gen', () => {
    expect(
      resolveSelfGenCredit({
        isSelfGenerated: null,
        ownerUserId: 'closer-1',
        setterUserId: 'closer-1',
        salespersonId: 'closer-1',
      })
    ).toEqual(NO_SELF_GEN)
    expect(
      resolveSelfGenCredit({
        isSelfGenerated: false,
        ownerUserId: 'closer-1',
        setterUserId: null,
        salespersonId: 'closer-1',
      })
    ).toEqual(NO_SELF_GEN)
  })

  it('pays nobody when there is no one to credit', () => {
    expect(
      resolveSelfGenCredit({
        isSelfGenerated: true,
        ownerUserId: null,
        setterUserId: null,
        salespersonId: null,
      })
    ).toEqual(NO_SELF_GEN)
  })
})

describe('payableSelfGenFlag', () => {
  it('keeps inferred history non-payable until a human confirms it', () => {
    expect(payableSelfGenFlag(true, 'inferred_setter_equals_owner')).toBeNull()
    expect(payableSelfGenFlag(true, 'manual')).toBe(true)
    expect(payableSelfGenFlag(false, 'manual')).toBe(false)
    expect(payableSelfGenFlag(true, null)).toBeNull()
  })
})

const explicitSelfGen: DealCommissionRoleParticipant = {
  userId: 'admin-chosen',
  role: 'self_gen',
  overrideAmount: null,
  overridePercent: 4,
  premierPricingAmount: null,
}

const inspectorRow: DealCommissionRoleParticipant = {
  userId: 'inspector-1',
  role: 'inspector',
  overrideAmount: null,
  overridePercent: 1.5,
  premierPricingAmount: null,
}

const clean = { creditUserId: 'closer-1', conflictWithSetter: false }
const conflicted = { creditUserId: 'closer-1', conflictWithSetter: true }

describe('withDerivedSelfGen', () => {
  it('adds a self-gen line at the org rate', () => {
    const result = withDerivedSelfGen([], clean, 6)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      userId: 'closer-1',
      role: 'self_gen',
      overridePercent: 6,
      overrideAmount: null,
    })
  })

  it('keeps unrelated explicit rows and appends alongside them', () => {
    const result = withDerivedSelfGen([inspectorRow], clean, 6)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(inspectorRow)
  })

  it('never overrides a self_gen row an admin already saved', () => {
    expect(withDerivedSelfGen([explicitSelfGen], clean, 6)).toEqual([explicitSelfGen])
  })

  it('respects a deliberate $0 self_gen row', () => {
    const zeroed = { ...explicitSelfGen, overrideAmount: 0, overridePercent: null }
    expect(withDerivedSelfGen([zeroed], clean, 6)).toEqual([zeroed])
  })

  it('suppresses the derived line when the deal is both setter-attributed and self-gen', () => {
    // 7% + 5% + 6% + 1.5% + 1% = 20.5% would breach the 18% pool cap and scale every
    // other line on the job down, so the contradictory line is never auto-paid.
    expect(withDerivedSelfGen([inspectorRow], conflicted, 6)).toEqual([inspectorRow])
  })

  it('still lets an admin force the line on a conflicting job via an explicit row', () => {
    expect(withDerivedSelfGen([explicitSelfGen], conflicted, 6)).toEqual([explicitSelfGen])
  })

  it('derives nothing when the rate is 0 (feature off) or junk', () => {
    expect(withDerivedSelfGen([], clean, 0)).toEqual([])
    expect(withDerivedSelfGen([], clean, -6)).toEqual([])
    expect(withDerivedSelfGen([], clean, Number.NaN)).toEqual([])
  })

  it('derives nothing when the job is not self-generated', () => {
    expect(withDerivedSelfGen([inspectorRow], NO_SELF_GEN, 6)).toEqual([inspectorRow])
  })
})

describe('normalizeSelfGenRate', () => {
  it('passes a real rate through and treats anything else as off', () => {
    expect(normalizeSelfGenRate(6)).toBe(6)
    expect(normalizeSelfGenRate('6.00')).toBe(6)
    expect(normalizeSelfGenRate(null)).toBe(0)
    expect(normalizeSelfGenRate(0)).toBe(0)
    expect(normalizeSelfGenRate(-6)).toBe(0)
    expect(normalizeSelfGenRate('nope')).toBe(0)
  })
})
