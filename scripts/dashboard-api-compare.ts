/**
 * Read-only: the numbers /api/dashboard/team-stats, personal-stats and the Sisu leaderboard USED to return
 * (the dashboard_* RPCs, still in the database) vs what they return now (reporting views via period-metrics).
 *   cp .env.local here; set -a; . ./.env.local; set +a; npx tsx scripts/dashboard-api-compare.ts
 */
import { createClient } from '@supabase/supabase-js'

import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import { getContactDispositionIdSet } from '@/lib/sales-metrics'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import { fetchPeriodMetricRows, summarizePeriodRows } from '@/lib/reporting/period-metrics'

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: org } = await admin.from('orgs').select('id, settings').limit(1).single()
  const orgId = org!.id as string
  const { data: users } = await admin.from('users').select('id, full_name, role').eq('org_id', orgId)
  const ids = (users ?? []).map((u) => u.id as string)
  const label = new Map((users ?? []).map((u) => [u.id as string, `${u.full_name} (${u.role})`]))
  const contactSet = getContactDispositionIdSet((org!.settings as any)?.canvass_dispositions)
  const dispositionIds = Array.from(contactSet)

  for (const frame of ['week', 'last_week', 'month', 'last_month', 'year']) {
    const { start, end } = getDateRangeForTimeFrame(frame, 'America/New_York')
    const a = { p_org_id: orgId, p_start: start.toISOString(), p_end: end.toISOString(), p_member_ids: ids }
    const [doors, contacts, sets, recv, cal, sales] = await Promise.all([
      admin.rpc('dashboard_door_leads_by_owner', a),
      admin.rpc('dashboard_contact_leads_by_owner', { ...a, p_disposition_ids: dispositionIds }),
      admin.rpc('dashboard_inspections_set_by_canvasser', a),
      admin.rpc('dashboard_inspections_received_by_closer', a),
      admin.rpc('dashboard_closer_calendar_appts_by_closer', a),
      admin.rpc('dashboard_install_sales_by_owner', a),
    ])
    const map = (r: any, k: string) => new Map<string, number>((r.data ?? []).map((x: any) => [x[k], Number(x.cnt)]))
    const old = { doors: map(doors, 'owner_id'), contacts: map(contacts, 'owner_id'), sets: map(sets, 'canvasser_id'), recv: map(recv, 'closer_id'), cal: map(cal, 'closer_id'), salesOwner: map(sales, 'owner_id') }
    const rows = await fetchPeriodMetricRows(admin as never, { orgId, startIso: a.p_start, endIso: a.p_end })
    console.log(`\n=== ${frame} ${a.p_start} → ${a.p_end}`)
    const diffs: string[] = []
    for (const u of users ?? []) {
      const st = summarizePeriodRows(rows, new Set([u.id as string]), { setterLane: isSetterLikeRole(u.role as string), contactDispositionIdSet: contactSet })
      const closerSales = new Set(rows.sales.filter((r) => r.closer_user_id === u.id).map((r) => r.opportunity_id)).size
      const pairs: Array<[string, number, number]> = [
        ['doors', old.doors.get(u.id as string) ?? 0, st.doors],
        ['contacts', old.contacts.get(u.id as string) ?? 0, st.contacts],
        ['inspections set', old.sets.get(u.id as string) ?? 0, st.inspectionsSet],
        ['inspections received', old.recv.get(u.id as string) ?? 0, st.inspectionsReceived],
        ['calendar', old.cal.get(u.id as string) ?? 0, st.calendar],
        ['sales (leaderboard, closer)', old.salesOwner.get(u.id as string) ?? 0, closerSales],
      ]
      for (const [m, b, n] of pairs) if (b !== n) diffs.push(`  ${(label.get(u.id as string) ?? u.id).padEnd(34)} ${m.padEnd(28)} ${b} → ${n}`)
    }
    console.log(diffs.length ? diffs.join('\n') : '  (no differences)')
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
