export const dynamic = 'force-dynamic'

import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import WaitingOnYou from '@/components/threads/WaitingOnYou'
import NeedsYouList from '@/components/ops/NeedsYouList'
import { KpiTiles, QueueCard } from '@/components/today/QueueCard'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { requireAuth } from '@/lib/auth'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import { loadNeedsYouForViewer } from '@/lib/data-health'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { hasFinancials } from '@/lib/financials-access'
import { canAccessJobBoardFromPermissionNames, isOrgSuperuserRoleSlug } from '@/lib/permissions'
import { fetchPeriodMetricRows, getContactDispositionIdSet, summarizePeriodRows } from '@/lib/reporting/period-metrics'
import { isOwnerProfile } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveThreadViewer } from '@/lib/threads/viewer'
import { listWaiting } from '@/lib/threads/waiting'
import { loadCloserQueues, loadOpsQueues, loadOwnerExceptions, todayKindFor, type TodayKind } from '@/lib/today'

const TITLE: Record<TodayKind, string> = {
  closer: 'Today',
  ops: 'Today',
  owner: 'Today',
  setter: 'Today',
}

export default async function TodayPage() {
  const { authUser, profile } = await requireAuth()
  const admin = createServiceClient()
  const perms = await resolveEffectivePermissionNames(admin, authUser.id, profile)
  const kind = todayKindFor({ role: profile.role, isSuperuser: isOrgSuperuserRoleSlug(profile.role), canJobBoard: canAccessJobBoardFromPermissionNames(perms) })

  // Setters work in the field: on a phone, Today IS the canvass app.
  if (kind === 'setter' && /iPhone|Android|Mobile/i.test(headers().get('user-agent') ?? '')) redirect('/canvass')

  const { start, end } = getDateRangeForTimeFrame('week', 'America/New_York')
  const rows = await fetchPeriodMetricRows(admin, { orgId: profile.org_id, startIso: start.toISOString(), endIso: end.toISOString() })
  const opts = { setterLane: kind === 'setter', contactDispositionIdSet: getContactDispositionIdSet(undefined) }
  const mine = summarizePeriodRows(rows, kind === 'owner' || kind === 'ops' ? null : new Set([profile.id]), opts)

  const [closerQueues, opsQueues, ownerQueues, report] = await Promise.all([
    kind === 'closer' ? loadCloserQueues(admin, profile.org_id, profile.id, new Date(), { money: true }) : Promise.resolve([]),
    kind === 'ops' ? loadOpsQueues(admin, profile.org_id) : Promise.resolve([]),
    kind === 'owner' ? loadOwnerExceptions(admin, profile.org_id, new Date(), { money: hasFinancials(perms) }) : Promise.resolve([]),
    kind === 'ops' || kind === 'owner' ? loadNeedsYouForViewer(admin, profile.org_id, profile, canAccessJobBoardFromPermissionNames(perms)) : Promise.resolve(null),
  ])
  // The one Needs-you rule (lib/data-health.ts): owner everything, ops operational rows, anyone else nothing.
  const needsYou = report?.report ?? null
  const needsYouAudience: 'owner' | 'ops' = report?.audience === 'owner' ? 'owner' : 'ops'

  const tiles =
    kind === 'setter'
      ? [{ label: 'Doors this week', value: mine.doors }, { label: 'Inspections set', value: mine.inspectionsSet }]
      : kind === 'ops'
        ? [{ label: 'Sales this week', value: mine.sales }]
        : [
            { label: 'Sits this week', value: mine.sits },
            { label: 'Sales this week', value: mine.sales },
            { label: 'Inspections set', value: mine.inspectionsSet },
            { label: 'Appointments', value: mine.calendar },
          ]
  const waiting = await resolveThreadViewer(admin, profile).then((viewer) => listWaiting(admin, viewer)).catch(() => [])
  const queues = [...closerQueues, ...opsQueues, ...ownerQueues]

  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6">
        <PageHeader
          title={TITLE[kind]}
          subtitle={`Hi ${profile.full_name?.split(' ')[0] ?? 'there'} — here's what needs you.`}
          actions={kind === 'setter' ? <Button asChild><Link href="/canvass">Open Canvass</Link></Button> : undefined}
        />
        <WaitingOnYou items={waiting} />
        {needsYou && needsYou.count > 0 ? <NeedsYouList report={needsYou} canFixPayPlans={isOwnerProfile(profile)} audience={needsYouAudience} /> : null}
        {kind === 'owner' && queues.length === 0 && (!needsYou || needsYou.count === 0) ? (
          <EmptyState title="All clear" body="No exceptions: every appointment has an outcome, every sold job has a date, nothing is stuck." />
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          {queues.map((q) => (
            <QueueCard key={q.id} queue={q} />
          ))}
        </div>
        <section aria-label="This week" className="flex flex-col gap-2">
          <h2 className="text-ui-lg font-semibold text-ink">This week</h2>
          <KpiTiles tiles={tiles} />
        </section>
      </main>
    </div>
  )
}
