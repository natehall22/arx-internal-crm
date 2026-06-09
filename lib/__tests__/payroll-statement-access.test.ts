import {
  canUseManagerStatementView,
  resolvePayrollStatementTargetUserId,
} from '@/lib/payroll-statement-access'

describe('resolvePayrollStatementTargetUserId', () => {
  const rep = { id: 'rep-1', role: 'canvasser' as const }
  const manager = { id: 'mgr-1', role: 'sales_manager' as const }
  const admin = { id: 'admin-1', role: 'admin' as const }

  it('defaults to viewer when user_id is omitted (email link case)', () => {
    expect(resolvePayrollStatementTargetUserId(rep, null)).toEqual({
      userId: 'rep-1',
      viewingOtherUser: false,
    })
  })

  it('blocks reps from requesting another user via user_id', () => {
    expect(resolvePayrollStatementTargetUserId(rep, 'other-user')).toEqual({ error: 'forbidden' })
    expect(resolvePayrollStatementTargetUserId({ id: 'rep-1', role: 'sales_rep' as const }, 'other-user')).toEqual({
      error: 'forbidden',
    })
  })

  it('allows reps to request themselves explicitly', () => {
    expect(resolvePayrollStatementTargetUserId(rep, 'rep-1')).toEqual({
      userId: 'rep-1',
      viewingOtherUser: false,
    })
  })

  it('allows managers and payroll admins to request another user', () => {
    expect(resolvePayrollStatementTargetUserId(manager, 'rep-2')).toEqual({
      userId: 'rep-2',
      viewingOtherUser: true,
    })
    expect(resolvePayrollStatementTargetUserId(admin, 'rep-2')).toEqual({
      userId: 'rep-2',
      viewingOtherUser: true,
    })
  })
})

describe('canUseManagerStatementView', () => {
  it('excludes frontline rep roles from viewing team statements via URL', () => {
    expect(canUseManagerStatementView('canvasser')).toBe(false)
    expect(canUseManagerStatementView('sales_rep')).toBe(false)
    expect(canUseManagerStatementView('operations')).toBe(false)
  })

  it('includes manager roles', () => {
    expect(canUseManagerStatementView('setter_manager')).toBe(true)
    expect(canUseManagerStatementView('sales_manager')).toBe(true)
  })
})
