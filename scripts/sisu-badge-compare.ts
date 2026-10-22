/** Read-only: Sisu badge-award inputs (weekly doors, monthly closed sales) for every user, OLD code path vs NEW. */
import { createClient } from '@supabase/supabase-js'

import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import { getAttributedInstallationSales, SALE_AGREEMENT_TYPES } from '@/lib/sales-metrics'
import { countDoorsKnockedForBadgeAward, getPreviousFullWeekRange } from '@/lib/sisu-weekly-doors'
import { countClosedSalesForBadgeAward, getPreviousFullMonthRange } from '@/lib/sisu-monthly-closed-sales'

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: org } = await admin.from('orgs').select('id').limit(1).single()
  const orgId = org!.id as string
  const { data: users } = await admin.from('users').select('id, full_name, role').eq('org_id', orgId)
  const doorsOld = async (uid: string, r: { start: Date; end: Date }) => {
    const { data, error } = await admin.rpc('dashboard_door_leads_by_owner', { p_org_id: orgId, p_start: r.start.toISOString(), p_end: r.end.toISOString(), p_member_ids: [uid] })
    if (error) throw error
    return Number((data ?? []).find((x: any) => x.owner_id === uid)?.cnt ?? 0)
  }
  const salesOld = async (uid: string, r: { start: Date; end: Date }) => {
    const { data } = await admin.from('order_form_contracts').select('id, opportunity_id, customer_signed_at, opportunities(owner_user_id, setter_user_id)').eq('org_id', orgId).in('agreement_type', [...SALE_AGREEMENT_TYPES]).eq('status', 'completed').not('customer_signed_at', 'is', null).gte('customer_signed_at', r.start.toISOString()).lt('customer_signed_at', r.end.toISOString())
    return new Set(getAttributedInstallationSales(data as never).filter((o) => o.setter_user_id === uid || o.owner_user_id === uid).map((o) => o.opportunity_id || o.id)).size
  }
  const wk = getDateRangeForTimeFrame('week', 'America/New_York'), pwk = getPreviousFullWeekRange()
  const mo = getDateRangeForTimeFrame('month', 'America/New_York'), pmo = getPreviousFullMonthRange()
  let diffs = 0, rows = 0
  for (const u of users ?? []) {
    const id = u.id as string
    const dOld = Math.max(await doorsOld(id, wk), await doorsOld(id, pwk))
    const dNew = await countDoorsKnockedForBadgeAward(admin as never, orgId, id)
    const sOld = Math.max(await salesOld(id, mo), await salesOld(id, pmo))
    const sNew = await countClosedSalesForBadgeAward(admin as never, orgId, id)
    rows++
    if (dOld !== dNew || sOld !== sNew) { diffs++; console.log(`${u.full_name} (${u.role}): doors ${dOld} → ${dNew}, closed sales ${sOld} → ${sNew}`) }
    else if (dOld || sOld) console.log(`${u.full_name} (${u.role}): doors ${dOld}, closed sales ${sOld}  (same)`)
  }
  console.log(`\n${rows} users checked, ${diffs} differ`)
}
main().catch((e) => { console.error(e); process.exit(1) })
