import { NextResponse } from 'next/server'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { crewDayLinkSubIds, ensureServiceVisits, loadVisitsPage } from '@/lib/service-plans-db'
import { addDaysYmd, daysBetweenYmd, isYmd, ymdInZone } from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ops/visits?from=YYYY-MM-DD&to=YYYY-MM-DD&crew=<subId>|none|mine — service visits on those days (default:
 * this week from today; `mine` = visits assigned to me, e.g. an inspector's follow-ons), plus the crews list. Tops up the
 * visit horizon first (the generator is idempotent). Paged: `offset` (default 0) → `{ visits, total, hasMore }`, so a big
 * week is never silently cut off — the screen offers "Load more".
 */
export async function GET(request: Request) {
  const ctx = await servicePlanRouteAuth('view')
  if (ctx instanceof Response) return ctx
  const url = new URL(request.url)
  const timeZone = await loadOrgTimeZone(ctx.admin, ctx.orgId)
  const today = ymdInZone(new Date(), timeZone)
  const from = isYmd(url.searchParams.get('from')) ? (url.searchParams.get('from') as string) : today
  const toRaw = url.searchParams.get('to')
  const to = isYmd(toRaw) ? toRaw : addDaysYmd(from, 6)
  if (to < from || daysBetweenYmd(from, to) > 62) return NextResponse.json({ error: 'Pick up to 9 weeks' }, { status: 400 })
  const crew = url.searchParams.get('crew')

  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
  // The horizon top-up runs on the first page only (a "Load more" never re-runs it).
  if (offset === 0) await ensureServiceVisits(ctx.admin, ctx.orgId, { timeZone }).catch((e) => console.error('[visits] ensure failed', e))
  const filter = crew === 'mine' ? { from, to, userId: ctx.userId, accessNotes: true } : { from, to, subId: crew === 'none' ? null : crew || undefined, accessNotes: true }
  const [page, subs, linked] = await Promise.all([
    loadVisitsPage(ctx.admin, ctx.orgId, { ...filter, offset }),
    orgDb(ctx.admin, ctx.orgId).from('sub_contractors').select('id, company_name').eq('active', true).order('company_name'),
    crewDayLinkSubIds(ctx.admin, ctx.orgId),
  ])
  return NextResponse.json({
    today,
    from,
    to,
    visits: page.visits,
    total: page.total,
    hasMore: page.hasMore,
    offset,
    canEdit: ctx.access.edit,
    crews: ((subs.data ?? []) as Array<{ id: string; company_name: string | null }>).map((s) => ({ id: s.id, name: s.company_name ?? 'Crew', hasPhoneLink: linked.has(s.id) })),
  })
}
