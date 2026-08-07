import {
  buildAdditiveParticipantsForJob,
  type DerivedCommissionContext,
} from '@/lib/job-derived-commission-lines'
import type { SelfGenOpportunityRow } from '@/lib/job-self-gen-attribution'
import {
  poolKey,
  resolveAdditiveParticipantAmount,
  scaleCommissionsToPool,
  type DealCommissionRoleParticipant,
} from '@/lib/payroll-export'
import { commissionPoolCap } from '@/lib/commission-payroll'

const OPP = 'opp-1'
const CLOSER = 'closer-1'
const SETTER = 'setter-1'
const MANAGER = 'manager-1'

function context(overrides: {
  inspectionRatePercent?: number
  managerOverrideRatePercent?: number
  selfGenRatePercent?: number
  inspectorUserId?: string | null
  selfGen?: SelfGenOpportunityRow | null
}): DerivedCommissionContext {
  return {
    rateHistory: [{
      inspectionRatePercent: overrides.inspectionRatePercent ?? 0,
      managerOverrideRatePercent: overrides.managerOverrideRatePercent ?? 0,
      selfGenRatePercent: overrides.selfGenRatePercent ?? 0,
      effectiveFrom: '2026-08-05',
    }],
    inspectorByOpportunity: overrides.inspectorUserId
      ? new Map([[OPP, overrides.inspectorUserId]])
      : new Map(),
    managerAssignments: [
      { userId: SETTER, managerUserId: MANAGER, effectiveFrom: '2026-08-05', effectiveTo: null },
      { userId: CLOSER, managerUserId: MANAGER, effectiveFrom: '2026-08-05', effectiveTo: null },
    ],
    managerActiveHistory: [
      { userId: CLOSER, isActive: true, effectiveFrom: '2026-08-05' },
      { userId: SETTER, isActive: true, effectiveFrom: '2026-08-05' },
      { userId: MANAGER, isActive: true, effectiveFrom: '2026-08-05' },
    ],
    compAssignments: [
      { userId: CLOSER, effectiveFrom: '2026-08-05', effectiveTo: null, isManagerPlan: false },
      { userId: SETTER, effectiveFrom: '2026-08-05', effectiveTo: null, isManagerPlan: false },
      { userId: MANAGER, effectiveFrom: '2026-08-05', effectiveTo: null, isManagerPlan: true },
    ],
    selfGenByOpportunity: overrides.selfGen ? new Map([[OPP, overrides.selfGen]]) : new Map(),
  }
}

const jobInput = {
  opportunityId: OPP,
  participantUserIds: [CLOSER, SETTER],
  salespersonId: CLOSER,
  saleDate: '2026-08-05',
}

describe('buildAdditiveParticipantsForJob', () => {
  it('produces nothing at all when every rate is 0 (all features off)', () => {
    const result = buildAdditiveParticipantsForJob({
      ...jobInput,
      explicit: [],
      context: context({ inspectorUserId: CLOSER, selfGen: null }),
    })
    expect(result.participants).toEqual([])
    expect(result.selfGenSetterConflict).toBe(false)
  })

  it('preserves explicit admin rows untouched when features are off', () => {
    const explicit: DealCommissionRoleParticipant[] = [
      {
        userId: 'someone',
        role: 'custom',
        overrideAmount: 500,
        overridePercent: null,
        premierPricingAmount: null,
      },
    ]
    const result = buildAdditiveParticipantsForJob({
      ...jobInput,
      explicit,
      context: context({}),
    })
    expect(result.participants).toEqual(explicit)
  })

  it('does not apply newer compensation to a historical sale', () => {
    const result = buildAdditiveParticipantsForJob({
      ...jobInput,
      saleDate: '2026-08-04',
      explicit: [],
      context: context({
        inspectionRatePercent: 1.5,
        managerOverrideRatePercent: 1,
        selfGenRatePercent: 6,
        inspectorUserId: CLOSER,
        selfGen: {
          isSelfGenerated: true,
          source: 'manual',
          ownerUserId: CLOSER,
          setterUserId: null,
        },
      }),
    })
    expect(result.participants).toEqual([])
    expect(result.selfGenSetterConflict).toBe(false)
  })

  it('keeps the historical rate when the current rate changes', () => {
    const ctx = context({ inspectionRatePercent: 1.5, inspectorUserId: CLOSER })
    ctx.rateHistory.push({
      inspectionRatePercent: 2,
      managerOverrideRatePercent: 0,
      selfGenRatePercent: 0,
      effectiveFrom: '2026-09-01',
    })
    const oldSale = buildAdditiveParticipantsForJob({
      ...jobInput,
      saleDate: '2026-08-20',
      explicit: [],
      context: ctx,
    })
    expect(oldSale.participants[0]).toMatchObject({ overridePercent: 1.5 })

    const newSale = buildAdditiveParticipantsForJob({
      ...jobInput,
      saleDate: '2026-09-01',
      explicit: [],
      context: ctx,
    })
    expect(newSale.participants[0]).toMatchObject({ overridePercent: 2 })
  })

  it('keeps a derived component blank when the recipient had no comp assignment', () => {
    const ctx = context({ inspectionRatePercent: 1.5, inspectorUserId: CLOSER })
    ctx.compAssignments = ctx.compAssignments.filter((row) => row.userId !== CLOSER)
    const result = buildAdditiveParticipantsForJob({
      ...jobInput,
      explicit: [],
      context: ctx,
    })
    expect(result.participants).toEqual([])
  })

  it('stacks all three derived lines on the published Sales Manager scenario', () => {
    // Manager self-generates, inspects and closes their own deal: 7% close (paid via
    // the comp plan) + 6% self-gen + 1.5% inspection + 1% override = 15.5%.
    const result = buildAdditiveParticipantsForJob({
      opportunityId: OPP,
      participantUserIds: [MANAGER],
      salespersonId: MANAGER,
      saleDate: '2026-08-05',
      explicit: [],
      context: {
        ...context({
          inspectionRatePercent: 1.5,
          managerOverrideRatePercent: 1,
          selfGenRatePercent: 6,
          inspectorUserId: MANAGER,
          selfGen: { isSelfGenerated: true, source: 'manual', ownerUserId: MANAGER, setterUserId: null },
        }),
      },
    })
    const byRole = new Map(result.participants.map((p) => [p.role, p]))
    expect(byRole.get('inspector')).toMatchObject({ userId: MANAGER, overridePercent: 1.5 })
    expect(byRole.get('field_manager')).toMatchObject({ userId: MANAGER, overridePercent: 1 })
    expect(byRole.get('self_gen')).toMatchObject({ userId: MANAGER, overridePercent: 6 })
    // 7 (comp plan) + 1.5 + 1 + 6 = 15.5%, matching the published ladder.
    const additivePct = result.participants.reduce((sum, p) => sum + (p.overridePercent ?? 0), 0)
    expect(additivePct + 7).toBe(15.5)
  })

  it('pays the manager once on a job where they close and their report sets', () => {
    const result = buildAdditiveParticipantsForJob({
      opportunityId: OPP,
      participantUserIds: [MANAGER, SETTER],
      salespersonId: MANAGER,
      saleDate: '2026-08-05',
      explicit: [],
      context: context({ managerOverrideRatePercent: 1 }),
    })
    const managerLines = result.participants.filter((p) => p.role === 'field_manager')
    expect(managerLines).toHaveLength(1)
    expect(managerLines[0].userId).toBe(MANAGER)
  })

  it('suppresses the self-gen line and reports the conflict when a setter is also attributed', () => {
    const result = buildAdditiveParticipantsForJob({
      ...jobInput,
      explicit: [],
      context: context({
        selfGenRatePercent: 6,
        selfGen: { isSelfGenerated: true, source: 'manual', ownerUserId: CLOSER, setterUserId: SETTER },
      }),
    })
    expect(result.participants.some((p) => p.role === 'self_gen')).toBe(false)
    expect(result.selfGenSetterConflict).toBe(true)
  })

  it('does not report a conflict when the self-gen feature is off', () => {
    const result = buildAdditiveParticipantsForJob({
      ...jobInput,
      explicit: [],
      context: context({
        selfGenRatePercent: 0,
        selfGen: { isSelfGenerated: true, source: 'manual', ownerUserId: CLOSER, setterUserId: SETTER },
      }),
    })
    expect(result.selfGenSetterConflict).toBe(false)
  })

  it('derives nothing for a job with no linked opportunity', () => {
    const result = buildAdditiveParticipantsForJob({
      opportunityId: null,
      participantUserIds: [CLOSER],
      salespersonId: CLOSER,
      saleDate: '2026-08-05',
      explicit: [],
      context: context({
        inspectionRatePercent: 1.5,
        selfGenRatePercent: 6,
        inspectorUserId: CLOSER,
        selfGen: { isSelfGenerated: true, source: 'manual', ownerUserId: CLOSER, setterUserId: null },
      }),
    })
    expect(result.participants.some((p) => p.role === 'inspector')).toBe(false)
    expect(result.participants.some((p) => p.role === 'self_gen')).toBe(false)
  })

  it('still walks the manager chain for a job with no opportunity', () => {
    // The override comes from users.manager_user_id, not the opportunity.
    const result = buildAdditiveParticipantsForJob({
      opportunityId: null,
      participantUserIds: [SETTER],
      salespersonId: null,
      saleDate: '2026-08-05',
      explicit: [],
      context: context({ managerOverrideRatePercent: 1 }),
    })
    expect(result.participants).toHaveLength(1)
    expect(result.participants[0]).toMatchObject({ userId: MANAGER, role: 'field_manager' })
  })
})

describe('pool cap — the 20.5% breach case', () => {
  const compBase = 14000
  const poolCap = commissionPoolCap(compBase) // 2520 = 18%

  it('scales every line down when self-gen is forced onto a setter-attributed job', () => {
    // Explicit admin row forces the self-gen line onto a job that also has a setter.
    const explicit: DealCommissionRoleParticipant[] = [
      {
        userId: CLOSER,
        role: 'self_gen',
        overrideAmount: null,
        overridePercent: 6,
        premierPricingAmount: null,
      },
    ]
    const { participants, selfGenSetterConflict } = buildAdditiveParticipantsForJob({
      ...jobInput,
      explicit,
      context: context({
        inspectionRatePercent: 1.5,
        managerOverrideRatePercent: 1,
        selfGenRatePercent: 6,
        inspectorUserId: CLOSER,
        selfGen: { isSelfGenerated: true, source: 'manual', ownerUserId: CLOSER, setterUserId: SETTER },
      }),
    })
    // The explicit row wins, so it is present despite the conflict.
    expect(participants.some((p) => p.role === 'self_gen')).toBe(true)
    expect(selfGenSetterConflict).toBe(true)

    const raw = new Map<string, number>([
      [poolKey(CLOSER, 'sales_rep'), 980], // 7% closer, from the comp plan
      [poolKey(SETTER, 'setter'), 700], // 5% setter, from the comp plan
    ])
    for (const p of participants) {
      const amount = resolveAdditiveParticipantAmount(p, compBase)
      raw.set(poolKey(p.userId, p.role), amount.amount)
    }

    const rawTotal = Array.from(raw.values()).reduce((a, b) => a + b, 0)
    // 7 + 5 + 6 + 1.5 + 1 = 20.5% of 14,000 = 2,870.
    expect(rawTotal).toBe(2870)
    expect(rawTotal / compBase).toBeCloseTo(0.205, 6)
    expect(rawTotal).toBeGreaterThan(poolCap)

    const { scaled, enforced } = scaleCommissionsToPool(raw, poolCap)
    expect(enforced).toBe(true)
    const scaledTotal = Array.from(scaled.values()).reduce((a, b) => a + b, 0)
    expect(Math.round(scaledTotal * 100) / 100).toBe(poolCap)
    // The closer and setter both lose money because of the contradictory attribution —
    // which is exactly why the DERIVED line refuses to create this situation.
    expect(scaled.get(poolKey(CLOSER, 'sales_rep'))!).toBeLessThan(980)
    expect(scaled.get(poolKey(SETTER, 'setter'))!).toBeLessThan(700)
  })

  it('stays under the cap on the suppressed-conflict path (14.5%)', () => {
    const { participants } = buildAdditiveParticipantsForJob({
      ...jobInput,
      explicit: [],
      context: context({
        inspectionRatePercent: 1.5,
        managerOverrideRatePercent: 1,
        selfGenRatePercent: 6,
        inspectorUserId: CLOSER,
        selfGen: { isSelfGenerated: true, source: 'manual', ownerUserId: CLOSER, setterUserId: SETTER },
      }),
    })
    const raw = new Map<string, number>([
      [poolKey(CLOSER, 'sales_rep'), 980],
      [poolKey(SETTER, 'setter'), 700],
    ])
    for (const p of participants) {
      raw.set(poolKey(p.userId, p.role), resolveAdditiveParticipantAmount(p, compBase).amount)
    }
    const rawTotal = Array.from(raw.values()).reduce((a, b) => a + b, 0)
    // 7 + 5 + 1.5 + 1 = 14.5% — under the 18% cap, nobody is scaled down.
    expect(rawTotal / compBase).toBeCloseTo(0.145, 6)
    expect(scaleCommissionsToPool(raw, poolCap).enforced).toBe(false)
  })
})
