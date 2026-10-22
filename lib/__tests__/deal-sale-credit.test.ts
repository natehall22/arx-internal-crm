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

import { saleCreditLockBlock, SALE_CREDIT_LOCKED_MESSAGE } from '@/lib/deal-sale-credit'

function fakeLockAdmin(signedOppIds: string[], leadOpps: string[] = []) {
  return {
    from: (table: string) => {
      const q: any = {}
      let eqs: Record<string, string> = {}
      q.select = () => q
      q.eq = (k: string, v: string) => { eqs[k] = v; return q }
      q.in = () => q
      q.limit = () => q
      q.then = (resolve: (v: unknown) => unknown) =>
        resolve(
          table === 'opportunities'
            ? { data: leadOpps.map((id) => ({ id })), error: null }
            : { data: signedOppIds.includes(eqs.opportunity_id) ? [{ id: 'c' }] : [], error: null }
        )
      return q
    },
  } as any
}

describe('saleCreditLockBlock', () => {
  it('blocks a non-super-admin on a signed deal', async () => {
    const msg = await saleCreditLockBlock(fakeLockAdmin(['o1']), { orgId: 'org', opportunityId: 'o1', actor: { is_super_admin: false } })
    expect(msg).toBe(SALE_CREDIT_LOCKED_MESSAGE)
  })
  it('blocks via the lead\'s opportunities', async () => {
    const msg = await saleCreditLockBlock(fakeLockAdmin(['o2'], ['o2']), { orgId: 'org', leadId: 'l1', actor: {} })
    expect(msg).toBe(SALE_CREDIT_LOCKED_MESSAGE)
  })
  it('lets a super admin through and ignores unsigned deals', async () => {
    expect(await saleCreditLockBlock(fakeLockAdmin(['o1']), { orgId: 'org', opportunityId: 'o1', actor: { is_super_admin: true } })).toBeNull()
    expect(await saleCreditLockBlock(fakeLockAdmin([]), { orgId: 'org', opportunityId: 'o1', actor: {} })).toBeNull()
  })
})
