import { checkSaleCreditChange, diffSaleCredit } from '@/lib/deal-sale-credit'

const current = { closerUserId: 'closer', setterUserId: 'setter', isSelfGenerated: false }
const owner = { id: 'o', is_super_admin: true }
const rep = { id: 'r', is_super_admin: false }

describe('diffSaleCredit', () => {
  it('reports only real changes', () => {
    expect(diffSaleCredit(current, { closerUserId: 'closer', setterUserId: 'setter' })).toEqual({})
    expect(diffSaleCredit(current, { setterUserId: null })).toEqual({ setterUserId: null })
    expect(diffSaleCredit(current, {})).toEqual({})
  })
  it('confirming an unconfirmed self-gen flag is a change', () => {
    expect(diffSaleCredit({ ...current, isSelfGenerated: null }, { isSelfGenerated: false })).toEqual({ isSelfGenerated: false })
  })
})

describe('checkSaleCreditChange', () => {
  const merged = { ...current, setterUserId: 'other' }
  const changed = { setterUserId: 'other' }

  it('anyone allowed to sign can confirm credit before signing', () => {
    expect(checkSaleCreditChange({ locked: false, actor: rep, merged, changed, reason: null })).toBeNull()
  })
  it('after signing only a super admin may change it', () => {
    expect(checkSaleCreditChange({ locked: true, actor: rep, merged, changed, reason: 'x' })?.status).toBe(403)
  })
  it('after signing a reason is required', () => {
    expect(checkSaleCreditChange({ locked: true, actor: owner, merged, changed, reason: '  ' })?.status).toBe(400)
    expect(checkSaleCreditChange({ locked: true, actor: owner, merged, changed, reason: 'wrong setter' })).toBeNull()
  })
  it('no change is always fine, even locked', () => {
    expect(checkSaleCreditChange({ locked: true, actor: rep, merged: current, changed: {}, reason: null })).toBeNull()
  })
  it('self-generated with a separate setter is rejected', () => {
    const m = { closerUserId: 'c', setterUserId: 's', isSelfGenerated: true }
    expect(checkSaleCreditChange({ locked: false, actor: rep, merged: m, changed: { isSelfGenerated: true }, reason: null })?.status).toBe(400)
  })
})
