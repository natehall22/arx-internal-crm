/**
 * Read-only: for the same windows, compute every dashboard number the OLD way (leads / appointments / contracts,
 * exactly as app/dashboard/page.tsx did) and the NEW way (reporting views via lib/reporting/period-metrics.ts),
 * and print before → after per metric, org-wide and per person. This is what the PR description's table is made from.
 *   set -a; . ./.env.local; set +a; npx tsx scripts/dashboard-views-compare.ts
 */
import { createClient } from '@supabase/supabase-js'

import { getAttributedCanvassLeadUserId } from '@/lib/canvass-lead-attribution'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import { fetchEffectiveSitOpportunitiesInPeriod } from '@/lib/dashboard-sit-metrics'
import { countsAsInspectionSet } from '@/lib/inspection-set-metrics'
import { getSitOutcomeNormalizedIdSet } from '@/lib/inspection-outcomes'
import { fetchPeriodMetricRows, countContacts, getContactDispositionIdSet } from '@/lib/reporting/period-metrics'
import { EXCLUDE_SOLAR_IMPORT_LEADS_OR, getAttributedInstallationSales, isCanvassDoorLead, isContactDisposition, SALE_AGREEMENT_TYPES } from '@/lib/sales-metrics'
import { fetchSupabaseAllPages } from '@/lib/supabase-fetch-all-pages'

type Counts = Record<string, number>
const bump = (m: Counts, k: string | null | undefined) => { if (k) m[k] = (m[k] ?? 0) + 1 }

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: org } = await admin.from('orgs').select('id, settings').limit(1).single()
  const orgId = org!.id as string
  const { data: users } = await admin.from('users').select('id, full_name, role').eq('org_id', orgId)
  const name = new Map((users ?? []).map((u) => [u.id as string, `${u.full_name} (${u.role})`]))
  const sitSet = getSitOutcomeNormalizedIdSet((org!.settings as any)?.inspection_outcomes)
  const contactSet = getContactDispositionIdSet((org!.settings as any)?.canvass_dispositions)

  for (const frame of ['week', 'last_week', 'month', 'last_month', 'year']) {
    const { start, end } = getDateRangeForTimeFrame(frame, 'America/New_York')
    const startIso = start.toISOString(), endIso = end.toISOString()

    // ---- BEFORE (old page logic) ----
    const leads = await fetchSupabaseAllPages<any>((a, b) => admin.from('leads').select('id, source, canvass_disposition, created_at, owner_user_id, pin_attributed_user_id, ownership_reassigned_at').eq('org_id', orgId).gte('created_at', startIso).lt('created_at', endIso).or(EXCLUDE_SOLAR_IMPORT_LEADS_OR).range(a, b) as any)
    const appts = await fetchSupabaseAllPages<any>((a, b) => admin.from('scheduled_appointments').select('id, canvasser_user_id, closer_user_id, created_at, appointment_type, status').eq('org_id', orgId).gte('created_at', startIso).lt('created_at', endIso).range(a, b) as any)
    const calendar = await fetchSupabaseAllPages<any>((a, b) => admin.from('scheduled_appointments').select('id, closer_user_id').eq('org_id', orgId).not('closer_user_id', 'is', null).gte('scheduled_for', startIso).lt('scheduled_for', endIso).range(a, b) as any)
    const { data: contracts } = await admin.from('order_form_contracts').select('id, opportunity_id, customer_signed_at, opportunities(owner_user_id, setter_user_id)').eq('org_id', orgId).in('agreement_type', [...SALE_AGREEMENT_TYPES]).eq('status', 'completed').not('customer_signed_at', 'is', null).gte('customer_signed_at', startIso).lt('customer_signed_at', endIso)
    const oldSales = getAttributedInstallationSales(contracts as never)
    const oldSits = sitSet.size === 0 ? [] : await fetchEffectiveSitOpportunitiesInPeriod(admin as never, { orgId, startIso, endIso, sitOutcomeIdSet: sitSet })

    const before: Record<string, Counts> = { doors: {}, contacts: {}, sets: {}, sitsSetter: {}, sitsCloser: {}, salesSetter: {}, salesCloser: {}, calendar: {}, received: {} }
    for (const l of leads.filter(isCanvassDoorLead)) {
      const u = getAttributedCanvassLeadUserId(l)
      bump(before.doors, u)
      if (isContactDisposition(l.canvass_disposition, contactSet)) bump(before.contacts, u)
    }
    for (const a of appts.filter(countsAsInspectionSet)) bump(before.sets, a.canvasser_user_id)
    for (const o of oldSits) { bump(before.sitsSetter, o.setter_user_id); bump(before.sitsCloser, o.owner_user_id) }
    for (const o of oldSales) { bump(before.salesSetter, o.setter_user_id); bump(before.salesCloser, o.owner_user_id) }
    for (const a of calendar) bump(before.calendar, a.closer_user_id)
    for (const a of appts) bump(before.received, a.closer_user_id)

    // ---- AFTER (reporting views) ----
    const rows = await fetchPeriodMetricRows(admin as never, { orgId, startIso, endIso })
    const after: Record<string, Counts> = { doors: {}, contacts: {}, sets: {}, sitsSetter: {}, sitsCloser: {}, salesSetter: {}, salesCloser: {}, calendar: {}, received: {} }
    for (const d of rows.doors) { bump(after.doors, d.user_id); if (isContactDisposition(d.disposition, contactSet)) bump(after.contacts, d.user_id) }
    for (const r of rows.sets) bump(after.sets, r.setter_user_id)
    for (const r of rows.sits) { bump(after.sitsSetter, r.setter_user_id); bump(after.sitsCloser, r.closer_user_id) }
    for (const r of rows.sales) { bump(after.salesSetter, r.setter_user_id); bump(after.salesCloser, r.closer_user_id) }
    for (const r of rows.calendar) bump(after.calendar, r.closer_user_id)
    for (const r of rows.sets) bump(after.received, r.closer_user_id)
    void countContacts
    // Goals scorecard org-wide doors: old RPC (lead-based) vs rpt_canvass_doors head count.
    const { data: rpcDoors } = await admin.rpc('dashboard_count_door_leads_scoped', { p_org_id: orgId, p_start: startIso, p_end: endIso, p_scope_user_ids: [] })
    const { count: viewDoors } = await admin.from('rpt_canvass_doors').select('knock_id', { count: 'exact', head: true }).eq('org_id', orgId).gte('knocked_at', startIso).lt('knocked_at', endIso)
    console.log(`scorecard doors (org)  ${rpcDoors} → ${viewDoors}`)

    console.log(`\n=== ${frame}  ${startIso} → ${endIso}`)
    for (const metric of Object.keys(before)) {
      const ids = new Set([...Object.keys(before[metric]), ...Object.keys(after[metric])])
      const sum = (m: Counts) => Object.values(m).reduce((x, y) => x + y, 0)
      console.log(`${metric.padEnd(11)} total ${sum(before[metric])} → ${sum(after[metric])}`)
      for (const id of Array.from(ids)) {
        const b = before[metric][id] ?? 0, a = after[metric][id] ?? 0
        if (b !== a) console.log(`    ${(name.get(id) ?? id).padEnd(34)} ${b} → ${a}`)
      }
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
