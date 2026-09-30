import { isCanvassTerritoryAssigneeEligible } from '@/lib/canvass-territory-assignee-filter'

describe('isCanvassTerritoryAssigneeEligible', () => {
  it('allows an active sales-side user', () => {
    expect(isCanvassTerritoryAssigneeEligible({ role: 'canvasser', dashboard_view: 'sales', active: true })).toBe(true)
  })
  it('treats a missing active flag as eligible', () => {
    expect(isCanvassTerritoryAssigneeEligible({ role: 'setter' })).toBe(true)
    expect(isCanvassTerritoryAssigneeEligible({ role: 'setter', active: null })).toBe(true)
  })
  it('excludes deactivated users', () => {
    expect(isCanvassTerritoryAssigneeEligible({ role: 'canvasser', dashboard_view: 'sales', active: false })).toBe(false)
  })
  it('still excludes ops users', () => {
    expect(isCanvassTerritoryAssigneeEligible({ role: 'admin', dashboard_view: 'ops', active: true })).toBe(false)
    expect(isCanvassTerritoryAssigneeEligible({ role: 'operations', active: true })).toBe(false)
  })
})
