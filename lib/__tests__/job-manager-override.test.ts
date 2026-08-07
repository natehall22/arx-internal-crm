import {
  buildManagerHierarchy,
  buildManagerHierarchyForDate,
  deriveManagerOverrideRecipients,
  normalizeManagerOverrideRate,
  withDerivedManagerOverride,
} from '@/lib/job-manager-override'
import type { DealCommissionRoleParticipant } from '@/lib/payroll-export'

// Mirrors the live chart: Archer → Corey → Evan, Travis → Nathan, Nathan has reports.
// Every user here is ACTIVE; the inactive variants live in their own describe below.
const hierarchy = buildManagerHierarchy([
  { id: 'archer', manager_user_id: 'corey', active: true },
  { id: 'tim', manager_user_id: 'corey', active: true },
  { id: 'corey', manager_user_id: 'evan', active: true },
  { id: 'caleb', manager_user_id: 'evan', active: true },
  { id: 'evan', manager_user_id: null, active: true },
  { id: 'travis', manager_user_id: 'nathan', active: true },
  { id: 'nathan', manager_user_id: null, active: true },
  { id: 'solo', manager_user_id: null, active: true },
])

describe('buildManagerHierarchy', () => {
  it('maps each user to their manager and records who holds a manager seat', () => {
    expect(hierarchy.managerByUser.get('archer')).toBe('corey')
    expect(Array.from(hierarchy.usersWithReports).sort()).toEqual(['corey', 'evan', 'nathan'])
    expect(hierarchy.inactiveUserIds.size).toBe(0)
  })

  it('records only a strict false as inactive — missing/null reads as active', () => {
    const h = buildManagerHierarchy([
      { id: 'gone', manager_user_id: null, active: false },
      { id: 'here', manager_user_id: null, active: true },
      { id: 'unknown', manager_user_id: null, active: null },
      { id: 'unselected', manager_user_id: null },
    ])
    expect(Array.from(h.inactiveUserIds)).toEqual(['gone'])
  })

  it('drops a user recorded as their own manager rather than treating it as a seat', () => {
    const h = buildManagerHierarchy([{ id: 'loop', manager_user_id: 'loop' }])
    expect(h.managerByUser.size).toBe(0)
    expect(h.usersWithReports.size).toBe(0)
  })

  it('still records an inactive self-managing user as inactive', () => {
    const h = buildManagerHierarchy([{ id: 'loop', manager_user_id: 'loop', active: false }])
    expect(h.managerByUser.size).toBe(0)
    expect(Array.from(h.inactiveUserIds)).toEqual(['loop'])
  })

  it('ignores rows with no id or no manager', () => {
    const h = buildManagerHierarchy([
      { id: null, manager_user_id: 'x' },
      { id: 'y', manager_user_id: null },
    ])
    expect(h.managerByUser.size).toBe(0)
  })
})

describe('buildManagerHierarchyForDate', () => {
  const history = [
    { id: 'old-link', userId: 'rep', managerUserId: 'old-manager', effectiveFrom: '2026-08-05', effectiveTo: '2026-08-20' },
    { id: 'new-link', userId: 'rep', managerUserId: 'new-manager', effectiveFrom: '2026-08-21', effectiveTo: null },
  ]

  it('uses the assignment effective when the job was sold', () => {
    expect(buildManagerHierarchyForDate(history, '2026-08-10').managerByUser.get('rep')).toBe('old-manager')
    expect(buildManagerHierarchyForDate(history, '2026-08-21').managerByUser.get('rep')).toBe('new-manager')
  })

  it('keeps unverified historical timeframes blank', () => {
    expect(buildManagerHierarchyForDate(history, '2026-07-31').managerByUser.size).toBe(0)
    expect(buildManagerHierarchyForDate(history, null).managerByUser.size).toBe(0)
  })

  it('stops future overrides after a manager becomes inactive without rewriting prior sales', () => {
    const stableAssignment = [
      { id: 'stable-link', userId: 'rep', managerUserId: 'old-manager', effectiveFrom: '2026-08-05', effectiveTo: null },
    ]
    const activeHistory = [
      { userId: 'rep', isActive: true, effectiveFrom: '2026-08-05' },
      { userId: 'old-manager', isActive: true, effectiveFrom: '2026-08-05' },
      { userId: 'old-manager', isActive: false, effectiveFrom: '2026-08-21' },
    ]
    const before = buildManagerHierarchyForDate(stableAssignment, '2026-08-20', activeHistory)
    const after = buildManagerHierarchyForDate(stableAssignment, '2026-08-21', activeHistory)
    expect(deriveManagerOverrideRecipients(['rep'], before)).toEqual(['old-manager'])
    expect(deriveManagerOverrideRecipients(['rep'], after)).toEqual([])
  })
})

describe('deriveManagerOverrideRecipients', () => {
  it('pays the first manager above a participant', () => {
    expect(deriveManagerOverrideRecipients(['archer'], hierarchy)).toEqual(['corey'])
  })

  it('stops at one rung — the grandparent manager is NOT paid', () => {
    // Documented assumption: the published ladder defines a single manager rung.
    expect(deriveManagerOverrideRecipients(['archer'], hierarchy)).not.toContain('evan')
  })

  it('pays a manager on their own deal too', () => {
    expect(deriveManagerOverrideRecipients(['evan'], hierarchy)).toEqual(['evan'])
    // Nathan closes his own deal: own-production override, no manager above him.
    expect(deriveManagerOverrideRecipients(['nathan'], hierarchy)).toEqual(['nathan'])
  })

  it('pays a manager exactly once when they both produced the deal and manage a participant', () => {
    // Nathan closed it and Travis (his report) set it.
    expect(deriveManagerOverrideRecipients(['nathan', 'travis'], hierarchy)).toEqual(['nathan'])
  })

  it('pays a mid-level manager on their own production AND their own manager one rung up', () => {
    // Corey is the producer here, so Corey takes the own-production override and Evan
    // — the one rung above the producer — takes the team override. Contrast with the
    // Archer case above, where Corey is the rung and Evan gets nothing.
    expect(deriveManagerOverrideRecipients(['corey'], hierarchy)).toEqual(['corey', 'evan'])
  })

  it('pays nothing for a rep with no manager and no reports', () => {
    expect(deriveManagerOverrideRecipients(['solo'], hierarchy)).toEqual([])
  })

  it('terminates on a manager_user_id cycle instead of looping forever', () => {
    const cyclic = buildManagerHierarchy([
      { id: 'a', manager_user_id: 'b', active: true },
      { id: 'b', manager_user_id: 'a', active: true },
    ])
    // Both hold "seats" under the has-a-report rule, so both appear once, and the
    // walk terminates.
    const result = deriveManagerOverrideRecipients(['a'], cyclic, { maxLevels: 10 })
    expect(new Set(result).size).toBe(result.length)
    expect(result).toEqual(['a', 'b'])
  })

  it('walks further up only when explicitly asked to', () => {
    expect(deriveManagerOverrideRecipients(['archer'], hierarchy, { maxLevels: 2 })).toEqual([
      'corey',
      'evan',
    ])
    expect(deriveManagerOverrideRecipients(['archer'], hierarchy, { maxLevels: 0 })).toEqual([])
  })

  it('ignores empty participant ids', () => {
    expect(deriveManagerOverrideRecipients(['', 'archer'], hierarchy)).toEqual(['corey'])
  })
})

describe('deriveManagerOverrideRecipients — inactive managers roll up', () => {
  // The live chart with Corey deactivated: Archer/Tim → Corey (inactive) → Evan (active).
  const coreyGone = buildManagerHierarchy([
    { id: 'archer', manager_user_id: 'corey', active: true },
    { id: 'tim', manager_user_id: 'corey', active: true },
    { id: 'corey', manager_user_id: 'evan', active: false },
    { id: 'evan', manager_user_id: null, active: true },
  ])

  it('rolls the override up one level past an inactive direct manager', () => {
    // Ownership rule 2026-08-05: a deal Tim set pays Evan, NOT the deactivated Corey.
    expect(deriveManagerOverrideRecipients(['tim'], coreyGone)).toEqual(['evan'])
    expect(deriveManagerOverrideRecipients(['archer'], coreyGone)).not.toContain('corey')
  })

  it('rolls up two levels past two consecutive inactive managers', () => {
    const twoGone = buildManagerHierarchy([
      { id: 'rep', manager_user_id: 'mid', active: true },
      { id: 'mid', manager_user_id: 'upper', active: false },
      { id: 'upper', manager_user_id: 'top', active: false },
      { id: 'top', manager_user_id: null, active: true },
    ])
    expect(deriveManagerOverrideRecipients(['rep'], twoGone)).toEqual(['top'])
  })

  it('emits no line at all when no active manager exists anywhere up the chain', () => {
    const allGone = buildManagerHierarchy([
      { id: 'rep', manager_user_id: 'mid', active: true },
      { id: 'mid', manager_user_id: 'top', active: false },
      { id: 'top', manager_user_id: null, active: false },
    ])
    // Never falls back onto a deactivated user.
    expect(deriveManagerOverrideRecipients(['rep'], allGone)).toEqual([])
  })

  it('gives an inactive manager nothing on their own production and rolls it up', () => {
    // Corey (inactive, has reports) personally produces: Corey collects nothing and
    // his first active manager Evan takes the override instead.
    expect(deriveManagerOverrideRecipients(['corey'], coreyGone)).toEqual(['evan'])
  })

  it('pays an inactive manager nothing even when they are the top of the chain', () => {
    const lonelyInactive = buildManagerHierarchy([
      { id: 'rep', manager_user_id: 'boss', active: true },
      { id: 'boss', manager_user_id: null, active: false },
    ])
    expect(deriveManagerOverrideRecipients(['boss'], lonelyInactive)).toEqual([])
  })

  it('does not let skipping inactive users turn a cycle into an infinite walk', () => {
    // Every node in the loop is inactive, so nothing is ever paid and the walk must
    // still terminate on the visited set rather than the active-level counter.
    const inactiveCycle = buildManagerHierarchy([
      { id: 'a', manager_user_id: 'b', active: false },
      { id: 'b', manager_user_id: 'c', active: false },
      { id: 'c', manager_user_id: 'a', active: false },
    ])
    expect(deriveManagerOverrideRecipients(['a'], inactiveCycle, { maxLevels: 10 })).toEqual([])
  })

  it('terminates on a cycle that contains one active user, paying them once', () => {
    const mixedCycle = buildManagerHierarchy([
      { id: 'a', manager_user_id: 'b', active: false },
      { id: 'b', manager_user_id: 'c', active: false },
      { id: 'c', manager_user_id: 'a', active: true },
    ])
    const result = deriveManagerOverrideRecipients(['a'], mixedCycle, { maxLevels: 10 })
    expect(result).toEqual(['c'])
    expect(new Set(result).size).toBe(result.length)
  })

  it('still pays only ONE manager per job when two participants roll up to the same one', () => {
    // Archer and Tim both report to inactive Corey; both roll up to Evan.
    expect(deriveManagerOverrideRecipients(['archer', 'tim'], coreyGone)).toEqual(['evan'])
  })
})

const explicitManagerRow: DealCommissionRoleParticipant = {
  userId: 'admin-chosen-manager',
  role: 'field_manager',
  overrideAmount: null,
  overridePercent: 2,
  premierPricingAmount: null,
}

const inspectorRow: DealCommissionRoleParticipant = {
  userId: 'inspector-1',
  role: 'inspector',
  overrideAmount: null,
  overridePercent: 1.5,
  premierPricingAmount: null,
}

describe('withDerivedManagerOverride', () => {
  it('adds one line per manager at the org rate', () => {
    const result = withDerivedManagerOverride([], ['corey', 'evan'], 1)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      userId: 'corey',
      role: 'field_manager',
      overridePercent: 1,
      overrideAmount: null,
    })
    expect(result[1].userId).toBe('evan')
  })

  it('keeps unrelated explicit rows and appends alongside them', () => {
    const result = withDerivedManagerOverride([inspectorRow], ['corey'], 1)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(inspectorRow)
    expect(result[1].role).toBe('field_manager')
  })

  it('never overrides a manager row an admin already saved', () => {
    expect(withDerivedManagerOverride([explicitManagerRow], ['corey'], 1)).toEqual([
      explicitManagerRow,
    ])
  })

  it('respects a deliberate $0 manager row', () => {
    const zeroed = { ...explicitManagerRow, overrideAmount: 0, overridePercent: null }
    expect(withDerivedManagerOverride([zeroed], ['corey'], 1)).toEqual([zeroed])
  })

  it('treats a senior_manager row as the admin taking control too', () => {
    const senior = { ...explicitManagerRow, role: 'senior_manager' as const }
    expect(withDerivedManagerOverride([senior], ['corey'], 1)).toEqual([senior])
  })

  it('derives nothing when the rate is 0 (feature off) or junk', () => {
    expect(withDerivedManagerOverride([], ['corey'], 0)).toEqual([])
    expect(withDerivedManagerOverride([], ['corey'], -1)).toEqual([])
    expect(withDerivedManagerOverride([], ['corey'], Number.NaN)).toEqual([])
  })

  it('derives nothing when no manager could be identified', () => {
    expect(withDerivedManagerOverride([inspectorRow], [], 1)).toEqual([inspectorRow])
  })

  it('never writes the same manager twice on one job', () => {
    const result = withDerivedManagerOverride([], ['corey', 'corey'], 1)
    expect(result).toHaveLength(1)
  })
})

describe('normalizeManagerOverrideRate', () => {
  it('passes a real rate through and treats anything else as off', () => {
    expect(normalizeManagerOverrideRate(1)).toBe(1)
    expect(normalizeManagerOverrideRate('1.00')).toBe(1)
    expect(normalizeManagerOverrideRate(null)).toBe(0)
    expect(normalizeManagerOverrideRate(undefined)).toBe(0)
    expect(normalizeManagerOverrideRate(0)).toBe(0)
    expect(normalizeManagerOverrideRate(-1)).toBe(0)
    expect(normalizeManagerOverrideRate('nope')).toBe(0)
  })
})
