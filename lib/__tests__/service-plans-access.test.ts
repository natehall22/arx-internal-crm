import { servicePlanAccessFor } from '@/lib/service-plans-access'

describe('servicePlanAccessFor', () => {
  const none = { canJobBoard: false, canEditJobs: false, canViewJobFinancials: false }
  it('feature off = nobody, whatever their permissions', () => {
    expect(servicePlanAccessFor(false, { canJobBoard: true, canEditJobs: true, canViewJobFinancials: true })).toEqual({ feature: false, view: false, edit: false, prices: false })
  })
  it('job board views; jobs:edit edits and sees prices; financials-only viewers see prices; field roles (no ops perms) get nothing', () => {
    expect(servicePlanAccessFor(true, { ...none, canJobBoard: true })).toEqual({ feature: true, view: true, edit: false, prices: false })
    expect(servicePlanAccessFor(true, { ...none, canJobBoard: true, canViewJobFinancials: true })).toMatchObject({ view: true, edit: false, prices: true })
    expect(servicePlanAccessFor(true, { ...none, canEditJobs: true })).toMatchObject({ view: true, edit: true, prices: true })
    expect(servicePlanAccessFor(true, none)).toEqual({ feature: true, view: false, edit: false, prices: false })
    expect(servicePlanAccessFor(true, { ...none, canViewJobFinancials: true })).toMatchObject({ view: false, prices: false })
  })
})
