/**
 * The data behind "Print today's sheet" (renderer: lib/pdf/crew-day-sheet.ts). ONE builder for both callers — the crew's phone
 * link and the staff Visits board — so the paper is the same either way. Visits still to do on the day, in stop order, for
 * ONE crew; the customer's first name only (never a phone or email); the services sold as empty boxes (no price); and the
 * amount the customer owes, the only money on the sheet.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { CrewDaySheetData } from '@/lib/pdf/crew-day-sheet'
import { formatDateWeekday } from '@/lib/format'
import { getDocumentBrand } from '@/lib/org-brand'
import { SERVICE_STEP } from '@/lib/service-plans'
import { loadVisits } from '@/lib/service-plans-db'
import { loadOwedByCustomer } from '@/lib/visit-collections-db'

export async function buildCrewDaySheet(admin: SupabaseClient, orgId: string, o: { subId: string; crewName: string; day: string; /** Show what each customer owes (the crew always; staff only with money access). */ money: boolean }): Promise<CrewDaySheetData> {
  const [visits, brand] = await Promise.all([loadVisits(admin, orgId, { from: o.day, to: o.day, subId: o.subId, accessNotes: true }), getDocumentBrand(admin, orgId)])
  const open = visits.filter((v) => v.status === 'scheduled')
  const owed = o.money ? await loadOwedByCustomer(admin, orgId, open.map((v) => v.customerId).filter((x): x is string => !!x)) : new Map()
  const seen = new Set<string>()
  return {
    companyName: brand.casualName,
    crewName: o.crewName,
    dateLabel: formatDateWeekday(o.day),
    visits: open.map((v, i) => {
      // A customer with two visits is asked for the money once (on their first stop).
      const collect = v.customerId && !seen.has(v.customerId) ? (owed.get(v.customerId)?.dueCents ?? 0) : 0
      if (v.customerId) seen.add(v.customerId)
      return {
        stop: v.routePosition ?? i + 1,
        firstName: (v.customerName ?? '').trim().split(/\s+/)[0] || null,
        address: v.address,
        what: v.step !== SERVICE_STEP && v.stepLabel ? `${v.stepLabel} — ${v.planName}` : v.planName,
        accessNotes: v.accessNotes,
        notes: v.officeNotes,
        checklist: v.checklist.map((c) => c.label),
        collectCents: collect > 0 ? collect : null,
      }
    }),
  }
}
