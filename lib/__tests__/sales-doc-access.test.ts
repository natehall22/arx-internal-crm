import { isBarredFromSalesDocAccess } from '@/lib/permissions'

describe('sales doc access gating', () => {
  it('bars appointment-setting base roles', () => {
    expect(isBarredFromSalesDocAccess('setter')).toBe(true)
    expect(isBarredFromSalesDocAccess('canvasser')).toBe(true)
    expect(isBarredFromSalesDocAccess('call_center')).toBe(true)
    expect(isBarredFromSalesDocAccess('inside_sales')).toBe(true)
  })

  it('bars custom Inside Sales roles on sales_rep base role', () => {
    expect(
      isBarredFromSalesDocAccess({
        role: 'sales_rep',
        customRoleDisplayName: 'Inside Sales (Call Center)',
      })
    ).toBe(true)
  })

  it('bars users with Inside Sales preset permission grants', () => {
    expect(
      isBarredFromSalesDocAccess({
        role: 'custom',
        permissionNames: new Set(['opportunities:view', 'leads:claim_inbound', 'scheduling:create']),
      })
    ).toBe(true)
  })

  it('does not bar closers or regional managers', () => {
    expect(isBarredFromSalesDocAccess('closer')).toBe(false)
    expect(
      isBarredFromSalesDocAccess({
        role: 'regional_manager',
        permissionNames: new Set(['opportunities:view', 'leads:manage_inbound']),
      })
    ).toBe(false)
  })
})
