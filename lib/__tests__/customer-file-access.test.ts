import { defaultTab, tabsFor } from '@/lib/customer-file/access'
import { buildStages, nextAction } from '@/lib/customer-file/stage'
import type { ThreadViewer } from '@/lib/threads/visibility'

const base: ThreadViewer = { userId: 'u', orgId: 'o', ownerLike: false, jobBoard: false, jobEdit: false, jobFinancials: false, managerLike: false, closerLike: false, setterLike: false, pricingBarred: false }
const owner = { ...base, ownerLike: true, jobBoard: true, jobEdit: true, jobFinancials: true }
const ops = { ...base, jobBoard: true, jobEdit: true }
const closer = { ...base, closerLike: true }
const setter = { ...base, setterLike: true, pricingBarred: true }
const inside = { ...base, pricingBarred: true }
const salesMgr = { ...base, managerLike: true }

describe('customer file tabs', () => {
  it('setters: overview + sales (+ notes); never job, money or files', () => {
    expect(tabsFor(setter, { hasJob: true })).toEqual(['overview', 'sales', 'notes'])
  })
  it('closers see sales + files; no job (the job page needs board access) or money', () => {
    expect(tabsFor(closer, { hasJob: true })).toEqual(['overview', 'sales', 'files', 'notes'])
  })
  it('ops: job, files; money only with financials', () => {
    expect(tabsFor(ops, { hasJob: true })).toEqual(['overview', 'sales', 'job', 'files', 'notes'])
    expect(tabsFor({ ...ops, jobFinancials: true }, { hasJob: true })).toContain('money')
  })
  it('owner: everything; no Job/Money before there is a job', () => {
    expect(tabsFor(owner, { hasJob: true })).toEqual(['overview', 'sales', 'job', 'money', 'files', 'notes'])
    expect(tabsFor(owner, { hasJob: false })).toEqual(['overview', 'sales', 'files', 'notes'])
  })
  it('role defaults: ops → job, closer → sales, inside sales → sales, owner → overview, setter → overview', () => {
    expect(defaultTab(ops, { hasJob: true })).toBe('job')
    expect(defaultTab(ops, { hasJob: false })).toBe('overview')
    expect(defaultTab(closer, { hasJob: true })).toBe('sales')
    expect(defaultTab(inside, { hasJob: false })).toBe('sales')
    expect(defaultTab(owner, { hasJob: true })).toBe('overview')
    expect(defaultTab(setter, { hasJob: true })).toBe('overview')
    expect(defaultTab(salesMgr, { hasJob: true })).toBe('sales')
  })
  it('a remembered tab wins only while it is still allowed', () => {
    expect(defaultTab(owner, { hasJob: true }, 'money')).toBe('money')
    expect(defaultTab(setter, { hasJob: true }, 'money')).toBe('overview')
    expect(defaultTab(owner, { hasJob: true }, 'bogus')).toBe('overview')
    expect(defaultTab(owner, { hasJob: true }, 'notes')).toBe('overview')
  })
})

describe('stage stepper', () => {
  it('walks lead → payroll and points at the next action', () => {
    const open = buildStages({ inspectionSet: true, hasProposal: false, signed: false, job: null })
    expect(open.map((s) => s.state)).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo', 'todo', 'todo'])
    expect(nextAction(open, false)).toEqual({ label: 'Build the proposal', tab: 'sales' })
    const scheduled = buildStages({ inspectionSet: true, hasProposal: true, signed: true, job: { status: 'scheduled', scheduled: true, completed: false, paid: false, payrollSent: false, cancelled: false } })
    expect(scheduled.find((s) => s.state === 'current')?.key).toBe('installed')
  })
  it('a cancelled job has no next action', () => {
    const s = buildStages({ inspectionSet: true, hasProposal: true, signed: true, job: { status: 'cancelled', scheduled: true, completed: false, paid: false, payrollSent: false, cancelled: true } })
    expect(nextAction(s, true)).toBeNull()
  })
})
