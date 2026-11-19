import { NextResponse } from 'next/server'

import { loadAllWork, ALL_WORK_MAX_DAYS } from '@/lib/all-work-db'
import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { resolveCanReassignAppointment } from '@/lib/permissions'
import { addDaysYmd, daysBetweenYmd, isYmd, weekdayOfYmd, ymdInZone } from '@/lib/service-plans'
import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { loadCrewSubIds } from '@/lib/time-tracking-db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ops/all-work?from=YYYY-MM-DD&to=YYYY-MM-DD — the "All work" calendar: install crews, service visits, planned job stages
 * and (only for people who may see every appointment) sales appointments, merged. Read-only, no money. Job-board people of a company
 * with service plans on. Also answers `myCrewIds` (the crews the viewer leads), the default filter for a crew lead.
 */
export async function GET(request: Request) {
  const ctx = await servicePlanRouteAuth('view')
  if (ctx instanceof Response) return ctx
  const url = new URL(request.url)
  const timeZone = await loadOrgTimeZone(ctx.admin, ctx.orgId)
  const today = ymdInZone(new Date(), timeZone)
  const from = isYmd(url.searchParams.get('from')) ? (url.searchParams.get('from') as string) : (() => {
        // The Monday-first month grid that holds today (the calendar's own default window).
        const first = `${today.slice(0, 8)}01`
        return addDaysYmd(first, -((weekdayOfYmd(first) + 6) % 7))
      })()
  const to = isYmd(url.searchParams.get('to')) ? (url.searchParams.get('to') as string) : addDaysYmd(from, 41)
  if (to < from || daysBetweenYmd(from, to) > ALL_WORK_MAX_DAYS) return NextResponse.json({ error: 'Pick up to 9 weeks' }, { status: 400 })
  const { data: me } = await ctx.admin.from('users').select('role, custom_role_id').eq('id', ctx.userId).eq('org_id', ctx.orgId).maybeSingle()
  const appointments = me ? await resolveCanReassignAppointment(ctx.admin, me as { role: string; custom_role_id?: string | null }).catch(() => false) : false
  const [work, led] = await Promise.all([
    loadAllWork(ctx.admin, ctx.orgId, from, to, { visits: ctx.access.view, appointments, timeZone }),
    loadCrewSubIds(ctx.admin, ctx.orgId, ctx.userId).catch(() => ({ all: [] as string[], led: [] as string[] })),
  ])
  return NextResponse.json({ ...work, today, myCrewIds: led.led, appointments })
}
