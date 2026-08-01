import {
  normalizeInspectionRate,
  withDerivedInspector,
} from '@/lib/job-inspector-attribution'
import type { DealCommissionRoleParticipant } from '@/lib/payroll-export'

function explicitInspector(
  overrides: Partial<DealCommissionRoleParticipant> = {}
): DealCommissionRoleParticipant {
  return {
    userId: 'admin-chosen-rep',
    role: 'inspector',
    overrideAmount: null,
    overridePercent: 2.5,
    premierPricingAmount: null,
    ...overrides,
  }
}

const managerRow: DealCommissionRoleParticipant = {
  userId: 'manager-1',
  role: 'field_manager',
  overrideAmount: null,
  overridePercent: 1,
  premierPricingAmount: null,
}

describe('withDerivedInspector', () => {
  it('adds an inspector line at the org rate when none was entered by hand', () => {
    const result = withDerivedInspector([], 'sfm-1', 1.5)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      userId: 'sfm-1',
      role: 'inspector',
      overridePercent: 1.5,
      overrideAmount: null,
    })
  })

  it('keeps existing rows and appends the inspector alongside them', () => {
    const result = withDerivedInspector([managerRow], 'sfm-1', 1.5)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(managerRow)
    expect(result[1].role).toBe('inspector')
  })

  it('never overrides an inspector row an admin already saved', () => {
    const explicit = explicitInspector()
    const result = withDerivedInspector([explicit], 'someone-else', 1.5)
    expect(result).toEqual([explicit])
  })

  it('respects a deliberate $0 inspector row rather than re-deriving it', () => {
    const zeroed = explicitInspector({ overrideAmount: 0, overridePercent: null })
    const result = withDerivedInspector([zeroed], 'sfm-1', 1.5)
    expect(result).toEqual([zeroed])
  })

  it('derives nothing when the org rate is 0 (feature off)', () => {
    expect(withDerivedInspector([], 'sfm-1', 0)).toEqual([])
    expect(withDerivedInspector([managerRow], 'sfm-1', 0)).toEqual([managerRow])
  })

  it('derives nothing when no inspector could be identified', () => {
    expect(withDerivedInspector([], null, 1.5)).toEqual([])
  })

  it('ignores a negative or non-finite rate', () => {
    expect(withDerivedInspector([], 'sfm-1', -1.5)).toEqual([])
    expect(withDerivedInspector([], 'sfm-1', NaN)).toEqual([])
  })
})

describe('normalizeInspectionRate', () => {
  it('passes through a real rate', () => {
    expect(normalizeInspectionRate(1.5)).toBe(1.5)
    expect(normalizeInspectionRate('1.50')).toBe(1.5)
  })

  it('treats null, undefined, zero and junk as off', () => {
    expect(normalizeInspectionRate(null)).toBe(0)
    expect(normalizeInspectionRate(undefined)).toBe(0)
    expect(normalizeInspectionRate(0)).toBe(0)
    expect(normalizeInspectionRate(-2)).toBe(0)
    expect(normalizeInspectionRate('not a number')).toBe(0)
  })
})
