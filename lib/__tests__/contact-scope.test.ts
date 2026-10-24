import { isSetterCanvasserLike, redactLeadContact, redactLeadsForViewer, LEAD_CONTACT_FIELDS } from '@/lib/contact-scope'

describe('contact scope (setters / canvassers)', () => {
  it.each(['setter', 'canvasser'])('%s is scoped', (role) => expect(isSetterCanvasserLike({ role })).toBe(true))
  it.each(['sales_rep', 'closer', 'admin', 'owner', 'operations', 'sales_manager', 'setter_manager', 'inside_sales', 'call_center'])('%s is not', (role) => expect(isSetterCanvasserLike({ role })).toBe(false))
  it('custom roles by name, but never inside sales, managers or super admins', () => {
    expect(isSetterCanvasserLike({ role: 'custom', customRoleName: 'Senior Setter' })).toBe(true)
    expect(isSetterCanvasserLike({ role: 'custom', customRoleName: 'Inside Sales Setter' })).toBe(false)
    expect(isSetterCanvasserLike({ role: 'custom', customRoleName: 'Setter Manager' })).toBe(false)
    expect(isSetterCanvasserLike({ role: 'setter', isSuperAdmin: true })).toBe(false)
  })
  it('redaction blanks identity, keeps the pin', () => {
    const pin = { id: 'l1', address_text: '1 Main St', lat: 35, lng: -80, canvass_disposition: 'not_home', owner_user_id: 'u2', homeowner_name: 'Pat', phone: '7045550100', email: 'p@x.com', notes: 'n', raw_payload: { a: 1 } }
    const r = redactLeadContact(pin)
    for (const f of LEAD_CONTACT_FIELDS) if (f in pin) expect((r as Record<string, unknown>)[f]).toBeNull()
    expect(r).toMatchObject({ id: 'l1', address_text: '1 Main St', lat: 35, lng: -80, canvass_disposition: 'not_home', owner_user_id: 'u2' })
  })
  it('does nothing for people who are not scoped', async () => {
    const admin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) } as never
    const leads = [{ id: 'l1', homeowner_name: 'Pat', owner_user_id: 'x' }]
    expect(await redactLeadsForViewer(admin, { id: 'u1', role: 'admin' }, leads)).toBe(leads)
  })
  it('keeps own leads and blanks the rest for a setter', async () => {
    const admin = { rpc: async (_n: string, a: { p_ids: string[] }) => ({ data: a.p_ids.filter((i) => i === 'knocked') }) } as never
    const leads = [
      { id: 'own', homeowner_name: 'A', owner_user_id: 'u1' },
      { id: 'knocked', homeowner_name: 'B', owner_user_id: 'u2' },
      { id: 'other', homeowner_name: 'C', owner_user_id: 'u2' },
    ]
    const out = await redactLeadsForViewer(admin, { id: 'u1', role: 'setter' }, leads)
    expect(out.map((l) => l.homeowner_name)).toEqual(['A', 'B', null])
  })
})
