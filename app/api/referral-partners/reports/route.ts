import { NextRequest, NextResponse } from 'next/server'

import { partnerApiError, partnerRequestContext } from '@/lib/referral-partner-api'
import { loadReferredJobs } from '@/lib/referral-partner-stats'
import { PARTNER_SELECT, assignedToLabel, daysUntilOpen, type ReferralPartnerRow } from '@/lib/referral-partners'
import { canSeeFinancials } from '@/lib/financials-access'

export const dynamic = 'force-dynamic'

/**
 * Manager reports.
 *  - kind=partner: referrals, sold jobs and revenue per partner.
 *  - kind=rep: sold jobs and revenue per rep through their partners, read from the
 *    `partner_owner` commission rows (the owner AS OF each sale, so reassignment can't
 *    rewrite history).
 *  - kind=cooling: assigned partners about to open up, soonest first.
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase, userId, profile, orgId, access } = await partnerRequestContext()
    if (!access.canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const kind = request.nextUrl.searchParams.get('kind') ?? 'partner'
    // Revenue per partner / rep is financial data (reports:financials); counts stay visible.
    const money = await canSeeFinancials(supabase, { id: userId, role: profile.role, custom_role_id: profile.custom_role_id })

    const { data, error } = await supabase
      .from('referral_partners')
      .select(PARTNER_SELECT)
      .eq('org_id', orgId)
    if (error) throw error
    const partners = (data ?? []) as unknown as ReferralPartnerRow[]

    if (kind === 'cooling') {
      const rows = partners
        .map((p) => ({ ...p, days_until_open: daysUntilOpen(p) }))
        .filter((p) => p.days_until_open !== null && p.days_until_open <= 14)
        .sort((a, b) => (a.days_until_open ?? 0) - (b.days_until_open ?? 0))
        .map((p) => ({
          id: p.id,
          name: p.name,
          company: p.company,
          assigned_to: assignedToLabel(p),
          days_until_open: p.days_until_open,
        }))
      return NextResponse.json({ rows })
    }

    const { referredCount, jobs } = await loadReferredJobs(supabase, orgId, partners.map((p) => p.id))

    if (kind === 'partner') {
      const rows = partners
        .map((p) => {
          const mine = jobs.filter((j) => j.partner_id === p.id)
          return {
            id: p.id,
            name: p.name,
            company: p.company,
            assigned_to: assignedToLabel(p),
            referred: referredCount.get(p.id) ?? 0,
            jobs_sold: mine.length,
            revenue: money ? mine.reduce((s, j) => s + j.sale_amount, 0) : null,
          }
        })
        .filter((r) => r.referred > 0)
        .sort((a, b) => (b.revenue ?? b.jobs_sold) - (a.revenue ?? a.jobs_sold))
      return NextResponse.json({ rows })
    }

    if (kind === 'rep') {
      const jobIds = jobs.map((j) => j.job_id)
      const { data: roles, error: rolesErr } = jobIds.length
        ? await supabase
            .from('deal_commission_roles')
            .select('job_id, user_id, user:users!deal_commission_roles_user_id_fkey(full_name)')
            .eq('org_id', orgId)
            .eq('role', 'partner_owner')
            .in('job_id', jobIds)
        : { data: [], error: null }
      if (rolesErr) throw rolesErr
      const amountByJob = new Map(jobs.map((j) => [j.job_id, j.sale_amount]))
      const byRep = new Map<string, { user_id: string; rep: string; jobs_sold: number; revenue: number }>()
      for (const r of (roles ?? []) as unknown as Array<{
        job_id: string
        user_id: string
        user: { full_name: string | null } | null
      }>) {
        const row = byRep.get(r.user_id) ?? {
          user_id: r.user_id,
          rep: r.user?.full_name ?? 'Unknown rep',
          jobs_sold: 0,
          revenue: 0,
        }
        row.jobs_sold += 1
        row.revenue += money ? amountByJob.get(r.job_id) ?? 0 : 0
        byRep.set(r.user_id, row)
      }
      return NextResponse.json({ rows: Array.from(byRep.values()).map((r) => (money ? r : { ...r, revenue: null })).sort((a, b) => (b.revenue ?? b.jobs_sold) - (a.revenue ?? a.jobs_sold)) })
    }

    return NextResponse.json({ error: 'Unknown report' }, { status: 400 })
  } catch (error) {
    return partnerApiError(error, 'referral-partners reports')
  }
}
