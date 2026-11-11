/** @jest-environment node */
import { customerAccessFor } from '@/lib/customer-file/customer-access'
import type { ThreadViewer } from '@/lib/threads/visibility'

const v = (over: Partial<ThreadViewer>): ThreadViewer => ({
  userId: 'u', orgId: 'o', ownerLike: false, jobBoard: false, jobEdit: false, jobFinancials: false, managerLike: false,
  closerLike: false, setterLike: false, pricingBarred: false, insideSales: false, ...over,
})

describe('customerAccessFor', () => {
  it('owners, ops and managers: everything, with or without a deal', () => {
    for (const viewer of [v({ ownerLike: true }), v({ jobBoard: true }), v({ managerLike: true })]) {
      expect(customerAccessFor(viewer, false)).toEqual({ read: true, edit: true, accessNotes: true, documents: true, editDocuments: true })
    }
  })
  it('a closer only with a deal they can open', () => {
    expect(customerAccessFor(v({ closerLike: true }), false).read).toBe(false)
    expect(customerAccessFor(v({ closerLike: true }), true)).toEqual({ read: true, edit: true, accessNotes: true, documents: true, editDocuments: true })
  })
  it('setters read (their own deal) but never edit, never see access notes or documents', () => {
    expect(customerAccessFor(v({ setterLike: true, pricingBarred: true }), true)).toEqual({ read: true, edit: false, accessNotes: false, documents: false, editDocuments: false })
  })
  it('inside sales: read, no edit, no access notes', () => {
    expect(customerAccessFor(v({ insideSales: true, pricingBarred: true }), true)).toEqual({ read: true, edit: false, accessNotes: false, documents: false, editDocuments: false })
  })
  it('subs / unknown roles: nothing', () => {
    expect(customerAccessFor(v({}), false).read).toBe(false)
  })
})
