import { closeOutOldAppointments, previewCloseout, undoCloseout } from '@/lib/appointment-closeout'
import { loadDataHealth } from '@/lib/data-health'
import { fetchPeriodMetricRows } from '@/lib/reporting/period-metrics'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const ORG = 'org1'
const NOW = new Date('2026-10-23T12:00:00Z')
const appt = (id: string, daysAgo: number, extra: Record<string, unknown> = {}) => ({ id, org_id: ORG, status: 'scheduled', scheduled_for: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(), duration_minutes: 60, appointment_type: 'inspection', address_text: id, ...extra })

const seed = () => ({
  scheduled_appointments: [appt('old1', 60), appt('old2', 20), appt('recent', 5), appt('done', 40, { status: 'completed' }), appt('closed', 50, { outcome_not_recorded_at: '2026-10-01T00:00:00Z' })],
  production_jobs: [],
})

describe('Needs you appointments window', () => {
  it('lists only the last 14 days; older ones are counted as hidden; closed-out ones are neither', async () => {
    const db = createFakeDb(seed())
    const report = await loadDataHealth(db.client, ORG, { now: NOW })
    expect(report.appointments.map((a) => a.appointmentId)).toEqual(['recent'])
    expect(report.hiddenOldAppointments).toBe(2)
  })
})

describe('Close out old appointments', () => {
  it('previews exactly what would close', async () => {
    const db = createFakeDb(seed())
    const p = await previewCloseout(db.client, ORG, NOW)
    expect(p.count).toBe(2)
    expect(p.oldest!.slice(0, 10)).toBe('2026-08-24')
  })
  it('closes one audited batch, touches nothing else, and is fully reversible', async () => {
    const db = createFakeDb(seed())
    const res = await closeOutOldAppointments(db.client, { orgId: ORG, actorUserId: 'owner', now: NOW })
    expect(res.closed).toBe(2)
    const byId = Object.fromEntries(db.tables.scheduled_appointments.map((a) => [a.id, a]))
    expect(byId.old1.outcome_not_recorded_at).toBeTruthy()
    expect(byId.old1.outcome_not_recorded_batch).toBe(res.batchId)
    expect(byId.old1.status).toBe('scheduled') // status unchanged
    expect(byId.recent.outcome_not_recorded_at).toBeUndefined() // inside the window
    expect(byId.done.outcome_not_recorded_at).toBeUndefined() // has an outcome
    expect(db.tables.appointment_closeouts).toHaveLength(2)
    expect((await previewCloseout(db.client, ORG, NOW)).count).toBe(0)

    const undo = await undoCloseout(db.client, { orgId: ORG, actorUserId: 'owner', batchId: res.batchId })
    expect(undo.restored).toBe(2)
    expect(byId.old1.outcome_not_recorded_at).toBeNull()
    expect(db.tables.appointment_closeouts.every((r) => r.reverted_at)).toBe(true)
    // the earlier, separate close-out is untouched by the undo
    expect(byId.closed.outcome_not_recorded_at).toBeTruthy()
    expect((await previewCloseout(db.client, ORG, NOW)).count).toBe(2)
  })
})

describe('reports', () => {
  it('closed-out appointments are not in the calendar (efficiency) denominator', async () => {
    const mk = (id: string, closed: boolean) => ({ org_id: ORG, appointment_id: id, closer_user_id: 'c1', scheduled_for: '2026-10-20T14:00:00Z', outcome_not_recorded_at: closed ? '2026-10-23T00:00:00Z' : null })
    const db = createFakeDb({ rpt_appointments: [mk('a', false), mk('b', true)], rpt_canvass_doors: [], rpt_inspection_sets: [], rpt_sits: [], rpt_sales: [] })
    const rows = await fetchPeriodMetricRows(db.client, { orgId: ORG, startIso: '2026-10-18T04:00:00Z', endIso: '2026-10-25T04:00:00Z' })
    expect(rows.calendar).toEqual([{ closer_user_id: 'c1' }])
  })
})

describe('big backlogs and races', () => {
  it('closes a backlog bigger than one chunk in one batch', async () => {
    const many = Array.from({ length: 450 }, (_, i) => appt(`a${i}`, 30 + (i % 20)))
    const db = createFakeDb({ scheduled_appointments: many, production_jobs: [] })
    const res = await closeOutOldAppointments(db.client, { orgId: ORG, actorUserId: 'owner', now: NOW })
    expect(res.closed).toBe(450)
    expect(db.tables.appointment_closeouts).toHaveLength(450)
    expect((await previewCloseout(db.client, ORG, NOW)).count).toBe(0)
  })
  it('a second close-out right after finds nothing and adds no phantom audit rows', async () => {
    const db = createFakeDb(seed())
    await closeOutOldAppointments(db.client, { orgId: ORG, actorUserId: 'owner', now: NOW })
    const again = await closeOutOldAppointments(db.client, { orgId: ORG, actorUserId: 'owner', now: NOW })
    expect(again.closed).toBe(0)
    expect(db.tables.appointment_closeouts).toHaveLength(2)
  })
})
