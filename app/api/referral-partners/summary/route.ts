import { NextResponse } from 'next/server'

import { getEasternMonthKey } from '@/lib/eastern-datetime'
import { partnerApiError, partnerRequestContext } from '@/lib/referral-partner-api'
import { loadReferredJobs } from '@/lib/referral-partner-stats'
import { OPENING_SOON_DAYS, daysUntilOpen, type ReferralPartnerRow } from '@/lib/referral-partners'

export const dynamic = 'force-dynamic'

/** The "My Partners" dashboard card: count, opening soon (with Log Touch), jobs this month. */
export async function GET() {
  try {
    const { supabase, userId, orgId } = await partnerRequestContext()
    const { data, error } = await supabase
      .from('referral_partners')
      .select('id, name, status, last_touched_at, type:referral_partner_types(id, name, inactivity_days)')
      .eq('org_id', orgId)
      .eq('assigned_user_id', userId)
    if (error) throw error
    const mine = (data ?? []) as unknown as Array<
      Pick<ReferralPartnerRow, 'id' | 'name' | 'status' | 'last_touched_at' | 'type'>
    >

    const openingSoon = mine
      .map((p) => ({ id: p.id, name: p.name, days_until_open: daysUntilOpen(p) }))
      .filter((p): p is { id: string; name: string; days_until_open: number } =>
        p.days_until_open !== null && p.days_until_open <= OPENING_SOON_DAYS
      )
      .sort((a, b) => a.days_until_open - b.days_until_open)

    const thisMonth = getEasternMonthKey(new Date().toISOString())
    const { jobs } = await loadReferredJobs(supabase, orgId, mine.map((p) => p.id))
    const jobsThisMonth = jobs.filter((j) => j.sale_date?.slice(0, 7) === thisMonth).length

    return NextResponse.json({
      assigned_count: mine.length,
      opening_soon: openingSoon.slice(0, 5),
      opening_soon_count: openingSoon.length,
      jobs_this_month: jobsThisMonth,
    })
  } catch (error) {
    return partnerApiError(error, 'referral-partners summary')
  }
}
