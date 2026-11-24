/**
 * The data behind "Print today's sheet" — the TRUCK SHEET (renderer: lib/pdf/crew-day-sheet.ts). ONE builder for both callers — the
 * crew's phone link and the staff Visits board — so the paper is the same either way. For ONE crew and day, in route order:
 *   - the office's note for the crew (crew_day_notes), then the day's LOAD LIST (what goes on the truck), the day's bed materials and
 *     the day's machines;
 *   - each stop still to do: visits (customer's first name only, never a phone or email; gate / access notes only as the crew page
 *     shows them) and the crew's project stops (install work orders: the job's sold items). Under each stop: what to load, the beds
 *     from the property's newest yard measure (est.), and the machines.
 * Never a price on a service or a load line. The one money line is what the customer owes, exactly as before (crew + staff with
 * money access). Rules: lib/truck-sheet.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadAreaMeasureSettings, loadAreaMeasurements } from '@/lib/area-measure-db'
import { mulchCubicYards, pineStrawBales } from '@/lib/area-measure'
import { loadCrewProjectStops } from '@/lib/crew-day-projects'
import type { CrewDaySheetData, CrewSheetStop, SheetLoadLine } from '@/lib/pdf/crew-day-sheet'
import { formatDateWeekday } from '@/lib/format'
import { buildJobSoldScope } from '@/lib/job-sold-scope'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { getDocumentBrand } from '@/lib/org-brand'
import { SERVICE_STEP } from '@/lib/service-plans'
import { loadVisits } from '@/lib/service-plans-db'
import { orgDb } from '@/lib/supabase/org-db'
import { bedAmountsOf, combineLoad, dayBeds, dayLoad, distinctEquipment, isBedWork, quantityText, resolveEquipment, sortStops, stopNumbers, type BedAmounts, type LoadItem, type SoldLine } from '@/lib/truck-sheet'
import { loadCrewDayNote, loadEquipmentNames, loadPlanEquipment, loadVisitEquipment } from '@/lib/truck-sheet-db'
import { loadOwedByCustomer } from '@/lib/visit-collections-db'

const firstNameOf = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || null
const toLines = (items: LoadItem[]): SheetLoadLine[] => items.map((i) => ({ label: i.name, amount: quantityText(i) }))

type Draft = {
  id: string
  kind: 'visit' | 'job'
  position: number | null
  address: string | null
  propertyId: string | null
  stop: Omit<CrewSheetStop, 'stop' | 'load' | 'loadUnread' | 'beds' | 'machines'>
  sold: SoldLine[]
  loadUnread: boolean
  machineIds: string[]
  /** Words that say what the stop is (plan, quote line, sold lines): bed work when they mention mulch / straw / beds (isBedWork). */
  workTexts: Array<string | null | undefined>
}

/** Sold lines of each stopped-at job (the job's proposal line items, via the ONE sold-scope builder). A job whose scope cannot be read is flagged, never shown as an empty load. */
async function jobStopDrafts(admin: SupabaseClient, orgId: string, subId: string, day: string): Promise<Draft[]> {
  let stops: Awaited<ReturnType<typeof loadCrewProjectStops>> = []
  try {
    stops = (await loadCrewProjectStops(admin, { orgId, subId }, day)).filter((s) => s.status !== 'completed' && s.status !== 'cancelled')
  } catch (e) {
    console.error('[truck-sheet] project stops failed', e)
    return []
  }
  if (stops.length === 0) return []
  const db = orgDb(admin, orgId)
  const [{ data: wos }, machines] = await Promise.all([
    db.from('work_orders').select('id, job_id, property_id, stop_order').in('id', stops.map((s) => s.id)),
    loadVisitEquipment(admin, orgId, stops.map((s) => s.id)),
  ])
  const woBy = new Map(((wos ?? []) as Array<{ id: string; job_id: string | null; property_id: string | null; stop_order: number | null }>).map((w) => [w.id, w]))
  const jobIds = Array.from(new Set(stops.map((s) => woBy.get(s.id)?.job_id).filter((x): x is string => !!x)))
  const { data: jobs } = jobIds.length
    ? await db
        .from('production_jobs')
        .select('id, job_number, job_type, address_text, project_id, accepted_proposal_id, linked_proposal_id, customer_id, project:projects(sold_roof_squares)')
        .in('id', jobIds)
    : { data: [] }
  const jobBy = new Map(((jobs ?? []) as Array<Record<string, unknown> & { id: string; customer_id: string | null }>).map((j) => [j.id, j]))
  const custIds = Array.from(new Set(Array.from(jobBy.values()).map((j) => j.customer_id).filter((x): x is string => !!x)))
  const { data: custs } = custIds.length ? await db.from('customers').select('id, name').in('id', custIds) : { data: [] }
  const custBy = new Map(((custs ?? []) as Array<{ id: string; name: string | null }>).map((c) => [c.id, c.name]))
  const soldBy = new Map<string, { lines: SoldLine[] | null }>()
  await Promise.all(
    jobIds.map(async (id) => {
      const job = jobBy.get(id)
      if (!job) return soldBy.set(id, { lines: null })
      try {
        const scope = await buildJobSoldScope({ admin, orgId, job })
        soldBy.set(id, { lines: (scope?.line_items ?? []).map((l) => ({ name: l.name, category: l.category, unit: l.unit, quantity: l.quantity })) })
      } catch (e) {
        console.error('[truck-sheet] sold scope failed', id, e)
        soldBy.set(id, { lines: null })
      }
    })
  )
  return stops.map((s) => {
    const wo = woBy.get(s.id)
    const job = wo?.job_id ? jobBy.get(wo.job_id) : undefined
    const sold = wo?.job_id ? soldBy.get(wo.job_id) : undefined
    return {
      id: s.id,
      kind: 'job' as const,
      position: wo?.stop_order ?? null,
      address: s.address,
      propertyId: wo?.property_id ?? null,
      stop: {
        firstName: firstNameOf(job?.customer_id ? custBy.get(job.customer_id) : null),
        address: s.address,
        what: [s.tradeLabel, s.jobNumber ? `Job ${s.jobNumber}` : null, s.dayCount ? `day ${s.dayNumber} of ${s.dayCount}` : null].filter(Boolean).join(' · '),
        accessNotes: null,
        notes: null,
        checklist: [],
        collectCents: null,
      },
      sold: sold?.lines ?? [],
      loadUnread: !sold || sold.lines === null,
      machineIds: resolveEquipment(machines.get(s.id), null),
      workTexts: [s.tradeLabel, ...(sold?.lines ?? []).flatMap((l) => [l.name, l.category])],
    }
  })
}

export async function buildCrewDaySheet(admin: SupabaseClient, orgId: string, o: { subId: string; crewName: string; day: string; /** Show what each customer owes (the crew always; staff only with money access). */ money: boolean }): Promise<CrewDaySheetData> {
  const [visits, brand, jobDrafts, note] = await Promise.all([
    loadVisits(admin, orgId, { from: o.day, to: o.day, subId: o.subId, accessNotes: true }),
    getDocumentBrand(admin, orgId),
    jobStopDrafts(admin, orgId, o.subId, o.day),
    loadCrewDayNote(admin, orgId, o.subId, o.day),
  ])
  // The phone page numbers the day's non-cancelled visits (done ones too); the sheet uses the same numbers (stopNumbers).
  const dayVisits = visits.filter((v) => v.status !== 'cancelled')
  const numberOf = stopNumbers(dayVisits.map((v) => ({ id: v.id, position: v.routePosition })))
  const open = visits.filter((v) => v.status === 'scheduled')
  const owed = o.money ? await loadOwedByCustomer(admin, orgId, open.map((v) => v.customerId).filter((x): x is string => !!x)) : new Map()

  // What the visits' plans were sold as (a plan that came from a quote: its quote line) and each plan's / visit's machines.
  const db = orgDb(admin, orgId)
  const planIds = Array.from(new Set(open.filter((v) => v.step === SERVICE_STEP).map((v) => v.planId)))
  const [planRows, planMachines, visitMachines] = await Promise.all([
    planIds.length ? db.from('service_plans').select('id, quote_line_id').in('id', planIds) : Promise.resolve({ data: [] }),
    loadPlanEquipment(admin, orgId, planIds),
    loadVisitEquipment(admin, orgId, open.map((v) => v.id)),
  ])
  const quoteLineOf = new Map(((planRows.data ?? []) as Array<{ id: string; quote_line_id: string | null }>).map((p) => [p.id, p.quote_line_id]))
  const lineIds = Array.from(new Set(Array.from(quoteLineOf.values()).filter((x): x is string => !!x)))
  const { data: lineRows } = lineIds.length ? await db.from('proposal_line_items').select('id, name, category, unit, quantity').in('id', lineIds) : { data: [] }
  const lineBy = new Map(((lineRows ?? []) as Array<{ id: string; name: string; category: string | null; unit: string | null; quantity: unknown }>).map((l) => [l.id, l]))

  const seen = new Set<string>()
  const visitDrafts: Draft[] = open.map((v) => {
    // A customer with two visits is asked for the money once (on their first stop).
    const collect = v.customerId && !seen.has(v.customerId) ? (owed.get(v.customerId)?.dueCents ?? 0) : 0
    if (v.customerId) seen.add(v.customerId)
    const qid = v.step === SERVICE_STEP ? quoteLineOf.get(v.planId) : null
    const ql = qid ? lineBy.get(qid) : undefined
    return {
      id: v.id,
      kind: 'visit' as const,
      position: numberOf.get(v.id) ?? v.routePosition,
      address: v.address,
      propertyId: v.propertyId,
      stop: {
        firstName: firstNameOf(v.customerName),
        address: v.address,
        what: v.step !== SERVICE_STEP && v.stepLabel ? `${v.stepLabel} — ${v.planName}` : v.planName,
        accessNotes: v.accessNotes,
        notes: v.officeNotes,
        checklist: v.checklist.map((c) => c.label),
        collectCents: collect > 0 ? collect : null,
      },
      sold: ql ? [{ name: ql.name, category: ql.category, unit: ql.unit, quantity: Number(ql.quantity) || 0 }] : [],
      loadUnread: false,
      // A plan's default machines belong to its service visits only; a follow-on step visit has its own (or none).
      machineIds: resolveEquipment(visitMachines.get(v.id), v.step === SERVICE_STEP ? planMachines.get(v.planId) : null),
      workTexts: [v.planName, v.stepLabel, ql?.name, ql?.category, ...v.checklist.map((c) => c.label)],
    }
  })

  // Yard measures: the NEWEST per property, as stored. Only for a company that uses the measure tool.
  const beds = new Map<string, BedAmounts | null>()
  const propertyIds = Array.from(new Set([...visitDrafts, ...jobDrafts].map((d) => d.propertyId).filter((x): x is string => !!x)))
  if (propertyIds.length > 0 && (await isOrgFeatureOn(orgId, 'areaMeasure'))) {
    const settings = await loadAreaMeasureSettings(admin, orgId).catch(() => null)
    await Promise.all(
      propertyIds.map(async (propertyId) => {
        try {
          const { rows } = await loadAreaMeasurements(admin, orgId, { propertyId }, 1)
          beds.set(propertyId, rows[0] && settings ? bedAmountsOf(rows[0], settings, { mulchCubicYards, pineStrawBales }) : null)
        } catch (e) {
          console.error('[truck-sheet] yard measure failed', propertyId, e)
        }
      })
    )
  }

  // Job stops keep their saved number, else continue after the day's highest visit number.
  let next = Math.max(0, ...Array.from(numberOf.values()))
  const jobNumbered = jobDrafts.map((d) => ({ ...d, position: d.position ?? ++next }))
  const ordered = sortStops([...visitDrafts, ...jobNumbered])
  const names = await loadEquipmentNames(admin, orgId, ordered.flatMap((d) => d.machineIds))
  const perStopLoad = ordered.map((d) => combineLoad(d.sold))
  const stops: CrewSheetStop[] = ordered.map((d, i) => ({
    ...d.stop,
    stop: d.position ?? i + 1,
    load: toLines(perStopLoad[i]),
    loadUnread: d.loadUnread,
    beds: d.propertyId ? beds.get(d.propertyId) ?? null : null,
    machines: d.machineIds.map((id) => names.get(id) ?? 'Machine'),
  }))
  const totalBeds = dayBeds(ordered.map((d) => ({ propertyKey: d.propertyId, beds: d.propertyId && isBedWork(d.workTexts) ? beds.get(d.propertyId) ?? null : null })))
  const machineIds = distinctEquipment(ordered.map((d) => d.machineIds))
  return {
    companyName: brand.casualName,
    crewName: o.crewName,
    dateLabel: formatDateWeekday(o.day),
    officeNote: note?.note ?? null,
    load: toLines(dayLoad(perStopLoad)),
    beds: totalBeds.properties > 0 ? totalBeds : null,
    machines: machineIds.map((id) => names.get(id) ?? 'Machine'),
    visits: stops,
  }
}
