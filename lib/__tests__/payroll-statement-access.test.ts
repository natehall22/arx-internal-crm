import {
  canUseManagerStatementView,
  canViewPayrollStatement,
  isUserInManagerHierarchy,
} from '@/lib/payroll-statement-access'

function makeHierarchySupabase(chain: Record<string, string | null>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => {
              return { data: null, error: null }
            },
          }),
        }),
      }),
    }),
  } as never
}

function makeHierarchySupabaseWithManagers(
  managersByUserId: Record<string, string | null>,
  orgIdExpected = 'org-1'
) {
  return {
    from: () => ({
      select: () => ({
        eq: (col: string, val: string) => {
          const userId = col === 'id' ? val : ''
          return {
            eq: (col2: string, val2: string) => ({
              maybeSingle: async () => {
                if (col2 === 'org_id' && val2 !== orgIdExpected) {
                  return { data: null, error: null }
                }
                const manager_user_id = managersByUserId[userId] ?? null
                return {
                  data: manager_user_id ? { manager_user_id } : { manager_user_id: null },
                  error: null,
                }
              },
            }),
          }
        },
      }),
    }),
  } as never
}

describe('canUseManagerStatementView', () => {
  it('allows sales_manager and above', () => {
    expect(canUseManagerStatementView('sales_manager')).toBe(true)
    expect(canUseManagerStatementView('admin')).toBe(true)
    expect(canUseManagerStatementView('operations')).toBe(false)
  })

  it('denies rep-level roles', () => {
    expect(canUseManagerStatementView('sales_rep')).toBe(false)
    expect(canUseManagerStatementView('setter')).toBe(false)
  })
})

describe('isUserInManagerHierarchy', () => {
  it('returns true when viewer is direct manager of target', async () => {
    const supabase = makeHierarchySupabaseWithManagers({
      'rep-1': 'mgr-1',
      'mgr-1': null,
    })
    await expect(isUserInManagerHierarchy(supabase, 'org-1', 'mgr-1', 'rep-1')).resolves.toBe(true)
  })

  it('returns true when viewer is indirect manager', async () => {
    const supabase = makeHierarchySupabaseWithManagers({
      'rep-1': 'mgr-1',
      'mgr-1': 'reg-mgr',
      'reg-mgr': null,
    })
    await expect(isUserInManagerHierarchy(supabase, 'org-1', 'reg-mgr', 'rep-1')).resolves.toBe(
      true
    )
  })

  it('returns false for peer rep (no management chain)', async () => {
    const supabase = makeHierarchySupabaseWithManagers({
      'rep-a': 'mgr-1',
      'rep-b': 'mgr-2',
      'mgr-1': null,
      'mgr-2': null,
    })
    await expect(isUserInManagerHierarchy(supabase, 'org-1', 'rep-a', 'rep-b')).resolves.toBe(
      false
    )
  })

  it('returns true when manager views self', async () => {
    const supabase = makeHierarchySupabase({})
    await expect(isUserInManagerHierarchy(supabase, 'org-1', 'mgr-1', 'mgr-1')).resolves.toBe(true)
  })
})

describe('canViewPayrollStatement', () => {
  const orgId = 'org-1'

  it('allows rep to view own statement', async () => {
    const supabase = makeHierarchySupabase({})
    await expect(
      canViewPayrollStatement(supabase, { id: 'rep-1', org_id: orgId, role: 'sales_rep' }, 'rep-1')
    ).resolves.toBe(true)
  })

  it('allows payroll admin (operations) to view any rep in org', async () => {
    const supabase = makeHierarchySupabase({})
    await expect(
      canViewPayrollStatement(
        supabase,
        { id: 'ops-1', org_id: orgId, role: 'operations' },
        'rep-other'
      )
    ).resolves.toBe(true)
  })

  it('denies hierarchy walk when user row is outside viewer org', async () => {
    const supabase = makeHierarchySupabaseWithManagers({ 'rep-1': 'mgr-1', 'mgr-1': null }, 'org-1')
    await expect(isUserInManagerHierarchy(supabase, 'org-other', 'mgr-1', 'rep-1')).resolves.toBe(
      false
    )
  })

  it('denies peer rep cross-view', async () => {
    const supabase = makeHierarchySupabaseWithManagers({
      'rep-a': 'mgr-1',
      'rep-b': 'mgr-1',
    })
    await expect(
      canViewPayrollStatement(supabase, { id: 'rep-a', org_id: orgId, role: 'sales_rep' }, 'rep-b')
    ).resolves.toBe(false)
  })

  it('allows manager in hierarchy to view subordinate', async () => {
    const supabase = makeHierarchySupabaseWithManagers({
      'rep-1': 'mgr-1',
      'mgr-1': null,
    })
    await expect(
      canViewPayrollStatement(
        supabase,
        { id: 'mgr-1', org_id: orgId, role: 'sales_manager' },
        'rep-1'
      )
    ).resolves.toBe(true)
  })

  it('denies manager not in target chain', async () => {
    const supabase = makeHierarchySupabaseWithManagers({
      'rep-1': 'mgr-other',
      'mgr-other': null,
    })
    await expect(
      canViewPayrollStatement(
        supabase,
        { id: 'mgr-1', org_id: orgId, role: 'sales_manager' },
        'rep-1'
      )
    ).resolves.toBe(false)
  })
})
