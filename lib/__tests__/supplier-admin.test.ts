import { canManageSuppliers, describeChange, diffSupplier, parseSupplierInput, type SupplierInput } from '@/lib/supplier-admin'

describe('canManageSuppliers (owners only)', () => {
  it('super admins and owners yes; everyone else no', () => {
    expect(canManageSuppliers({ is_super_admin: true, role: 'admin' })).toBe(true)
    expect(canManageSuppliers({ role: 'owner' })).toBe(true)
    expect(canManageSuppliers({ role: 'admin' })).toBe(false)
    expect(canManageSuppliers({ role: 'operations' })).toBe(false)
    expect(canManageSuppliers({ role: 'sales_rep' })).toBe(false)
    expect(canManageSuppliers(null)).toBe(false)
  })
  it('a deactivated owner loses it', () => {
    expect(canManageSuppliers({ is_super_admin: true, active: false, role: 'owner' })).toBe(false)
    expect(canManageSuppliers({ role: 'owner', active: false })).toBe(false)
  })
})

describe('parseSupplierInput', () => {
  const base = { name: '  ABC   Supply ', order_email: 'Orders@ABC.test', order_cc_emails: ['a@x.com', 'A@x.com', ' b@y.com '], default_for_trades: ['Roofing', 'roofing', 'gutters'] }
  it('cleans and lowercases', () => {
    const r = parseSupplierInput(base)
    if (!r.ok) throw new Error(r.error)
    expect(r.value).toMatchObject({ name: 'ABC Supply', order_email: 'orders@abc.test', order_cc_emails: ['a@x.com', 'b@y.com'], default_for_trades: ['roofing', 'gutters'], active: true, connection_type: 'email' })
  })
  it('empty order email is allowed (supplier cannot be emailed yet)', () => {
    const r = parseSupplierInput({ name: 'QXO', order_email: '', active: false })
    expect(r.ok && r.value.order_email).toBeNull()
  })
  it.each([
    ['not an email', { name: 'X', order_email: 'nope' }],
    ['two addresses', { name: 'X', order_email: 'a@x.com,b@y.com' }],
    ['angle brackets', { name: 'X', order_email: 'Bob <b@y.com>' }],
    ['bad cc', { name: 'X', order_cc_emails: ['ok@x.com', 'bad'] }],
    ['no name', { name: '   ' }],
    ['bad trade', { name: 'X', default_for_trades: ['roof;ing'] }],
  ])('rejects %s', (_label, body) => {
    expect(parseSupplierInput(body as Record<string, unknown>).ok).toBe(false)
  })
  it('only email or api for the connection', () => {
    const r = parseSupplierInput({ name: 'X', connection_type: 'carrier-pigeon' })
    expect(r.ok && r.value.connection_type).toBe('email')
    const a = parseSupplierInput({ name: 'X', connection_type: 'api' })
    expect(a.ok && a.value.connection_type).toBe('api')
  })
})

describe('diffSupplier', () => {
  const before: SupplierInput = { name: 'ABC', active: true, order_email: null, order_cc_emails: [], account_number: null, default_branch: null, default_delivery_notes: null, default_for_trades: [], connection_type: 'email' }
  it('lists only what changed, old → new', () => {
    const changes = diffSupplier(before, { ...before, order_email: 'o@abc.com', default_for_trades: ['roofing'] })
    expect(changes.map((c) => c.field)).toEqual(['order_email', 'default_for_trades'])
    expect(describeChange(changes[0])).toBe('Order email: (empty) → o@abc.com')
    expect(describeChange(changes[1])).toBe('Default for trades: (none) → roofing')
  })
  it('no change = empty list; a new supplier lists every set field', () => {
    expect(diffSupplier(before, { ...before })).toEqual([])
    expect(diffSupplier(null, { ...before }).map((c) => c.field)).toContain('name')
  })
})
