import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { checklistSummary, cleanServiceLines, readChecklist, tapChecklist, unchecked, visitChecklist } from '@/lib/visit-checklist'
import { tapVisitChecklist } from '@/lib/visit-checklist-db'

describe('service lines (what was sold)', () => {
  it('cleans text or arrays: trims, drops blanks and repeats, keeps order', () => {
    expect(cleanServiceLines(' Mow \n\nedge\nMOW\nBlow  off ')).toEqual({ ok: true, value: ['Mow', 'edge', 'Blow off'] })
    expect(cleanServiceLines(['Mow', 3 as unknown as string])).toMatchObject({ ok: false })
    expect(cleanServiceLines(null)).toEqual({ ok: true, value: [] })
    expect(cleanServiceLines('x'.repeat(61))).toMatchObject({ ok: false })
    expect(cleanServiceLines(Array.from({ length: 31 }, (_, i) => `Line ${i}`))).toMatchObject({ ok: false })
  })
})

describe('the checklist a crew sees', () => {
  it('still to do: the plan’s current lines with what was checked; a removed line goes unless already checked', () => {
    const stored = [{ label: 'Mow', done: true }, { label: 'Beds', done: false }, { label: 'Old job', done: true }]
    expect(visitChecklist(['Mow', 'Edge'], stored, true)).toEqual([
      { label: 'Mow', done: true },
      { label: 'Edge', done: false },
      { label: 'Old job', done: true },
    ])
  })
  it('finished: exactly what was stored, whatever the plan says now', () => {
    expect(visitChecklist(['Mow', 'Edge', 'New'], [{ label: 'Mow', done: true }], false)).toEqual([{ label: 'Mow', done: true }])
  })
  it('a tap only touches a service on the list', () => {
    const list = [{ label: 'Mow', done: false }]
    expect(tapChecklist(list, 'mow', true)).toEqual({ ok: true, value: [{ label: 'Mow', done: true }] })
    expect(tapChecklist(list, 'Aerate', true)).toMatchObject({ ok: false })
    expect(tapChecklist(list, 'Mow', 'yes')).toMatchObject({ ok: false })
  })
  it('summarises for the office', () => {
    expect(checklistSummary([{ label: 'Mow', done: true }, { label: 'Edge', done: true }, { label: 'Blow', done: false }])).toBe('Mow, Edge · Not done: Blow')
    expect(checklistSummary([{ label: 'Mow', done: false }])).toBe('Nothing checked')
    expect(unchecked([{ label: 'a', done: true }])).toEqual([])
    expect(readChecklist('nope')).toEqual([])
  })
})

describe('tapVisitChecklist (the one writer)', () => {
  const ORG = 'org-a'
  const seed = (extra: Record<string, unknown> = {}) =>
    createFakeDb({
      service_plans: [{ id: 'sp1', org_id: ORG, service_lines: ['Mow', 'Edge', 'Blow'] }],
      work_orders: [
        { id: 'v1', org_id: ORG, work_order_type: 'service_visit', assigned_sub_id: 's1', status: 'scheduled', visit_step: 'service', service_plan_id: 'sp1', visit_checklist: null, updated_at: 't1', ...extra },
        { id: 'v2', org_id: ORG, work_order_type: 'service_visit', assigned_sub_id: 's2', status: 'scheduled', visit_step: 'service', service_plan_id: 'sp1', visit_checklist: null, updated_at: 't1' },
        { id: 'vx', org_id: 'org-b', work_order_type: 'service_visit', assigned_sub_id: 's1', status: 'scheduled', visit_step: 'service', service_plan_id: 'spx', visit_checklist: null, updated_at: 't1' },
      ],
    })

  it('saves a tap on the whole list (so unchecked items are known too)', async () => {
    const db = seed()
    const r = await tapVisitChecklist(db.client as never, ORG, 's1', 'v1', 'Edge', true)
    expect(r).toEqual({ ok: true, checklist: [{ label: 'Mow', done: false }, { label: 'Edge', done: true }, { label: 'Blow', done: false }] })
    expect(db.tables.work_orders.find((w) => w.id === 'v1')!.visit_checklist).toEqual((r as { checklist: unknown }).checklist)
  })
  it('another crew’s visit, another company’s visit, or a closed visit is refused', async () => {
    const db = seed()
    expect(await tapVisitChecklist(db.client as never, ORG, 's1', 'v2', 'Mow', true)).toMatchObject({ ok: false, status: 404 })
    expect(await tapVisitChecklist(db.client as never, ORG, 's1', 'vx', 'Mow', true)).toMatchObject({ ok: false, status: 404 })
    const closed = seed({ status: 'completed' })
    expect(await tapVisitChecklist(closed.client as never, ORG, 's1', 'v1', 'Mow', true)).toMatchObject({ ok: false, status: 409 })
  })
  it('a service that is not on the list is refused', async () => {
    const db = seed()
    expect(await tapVisitChecklist(db.client as never, ORG, 's1', 'v1', 'Plant a tree', true)).toMatchObject({ ok: false, status: 400 })
  })
})
