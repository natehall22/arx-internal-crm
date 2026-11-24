export const dynamic = 'force-dynamic'

import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { canSeeAllReminders } from '@/lib/reminders'
import { resolveServicePlanAccess } from '@/lib/service-plans-access'
import Nav from '@/components/Nav'
import MyDayClock from '@/components/time/MyDayClock'
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
import { canBillService } from '@/lib/service-billing-access'
import { canAccessJobBoardFromPermissionNames, isOrgSuperuserRoleSlug } from '@/lib/permissions'
import { buildReportContext, runReport } from '@/lib/reporting/run'
import { fetchPeriodMetricRows, getContactDispositionIdSet, summarizePeriodRows } from '@/lib/reporting/period-metrics'
import FinishSetupCard from '@/components/today/FinishSetupCard'
import { loadFinishSetup } from '@/lib/finish-setup'
import { isOwnerProfile, isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveThreadViewer } from '@/lib/threads/viewer'
import { listWaiting } from '@/lib/threads/waiting'
import { loadOpenShiftsQueue } from '@/lib/time-tracking-db'
import CardGrid from '@/components/dashboard/CardGrid'
import { loadMyDayCards } from '@/lib/dashboard-cards-server'
import { applyDashboardWords, type CardData } from '@/lib/dashboard-cards'
import { loadCommissionChangesWaitingQueue } from '@/lib/payroll-commission-change'
import { loadCustomerMessagesBlockedQueue } from '@/lib/customer-messages-db'
import { loadQuickBooksStuckQueue } from '@/lib/quickbooks/activity'
import { loadQuickBooksNeedsYouQueue } from '@/lib/quickbooks/connection'
import { loadPaymentReversalsQueue } from '@/lib/online-payments/summary'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { loadRemindersQueue, loadAiChangesQueue, loadCloserQueues, loadDoorCollectionsQueue, loadOpsQueues, loadOwnerExceptions, loadServiceVisitQueues, loadUnpaidInvoicesQueue, todayKindFor, unpaidInvoicesFailedQueue, type TodayKind } from '@/lib/today'
import { applyTodayProfile, loadOrgProfile } from '@/lib/org-profile'
import { leadsWaitingFailedQueue, loadLeadsWaitingQueue } from '@/lib/leads-waiting'

const TITLE: Record<TodayKind, string> = {
  closer: 'Today',
  ops: 'Today',
  owner: 'Today',
  setter: 'Today',
  crew: 'Today',
}

export default async function TodayPage() {
  const { authUser, profile } = await requireAuth()
  const admin = createServiceClient()
  const perms = await resolveEffectivePermissionNames(admin, authUser.id, profile)
  const customRole = (profile as { custom_role_id?: string | null }).custom_role_id
    ? (await admin.from('custom_roles').select('name, display_name').eq('id', (profile as { custom_role_id: string }).custom_role_id).eq('org_id', profile.org_id).maybeSingle()).data
    : null
  const kind = todayKindFor({ role: profile.role, customRoleName: (customRole?.name as string | null) ?? null, customRoleDisplayName: (customRole?.display_name as string | null) ?? null, isSuperuser: isOrgSuperuserRoleSlug(profile.role) || isSuperAdmin(profile), canJobBoard: canAccessJobBoardFromPermissionNames(perms) })

  // The company's industry profile (lib/org-profile.ts): feature switches + which Today cards, in what order, with what titles.
  const orgProfile = await loadOrgProfile(admin, profile.org_id)
  // My day reads run alongside the rest of the page's reads (it bails with no reads for a company with neither service plans nor the time clock).
  const myDayPromise = loadMyDayCards(admin, profile, orgProfile.features).catch((e) => { console.error('today: my day failed', e); return [] as CardData[] })
  // Setters work in the field: on a phone, Today IS the canvass app (unless the company switched door knocking off).
  const canvassOn = kind === 'setter' && orgProfile.features.canvassing
  if (canvassOn && /iPhone|Android|Mobile/i.test(headers().get('user-agent') ?? '')) redirect('/canvass')

  // A new company's owner gets a "Finish setup" checklist until every step is done (never the original company; hides itself).
  // Started here and awaited with the rest of the page, so it runs in parallel with Today's own load.
  const finishSetupPromise = isSuperAdmin(profile) ? loadFinishSetup(admin, profile.org_id, { servicePlansOn: orgProfile.features.servicePlans }).catch((e) => { console.error('today: finish setup failed', e); return null }) : Promise.resolve(null)
  const { start, end } = getDateRangeForTimeFrame('week', 'America/New_York')
  // A crew member (Field Tech) has no sales numbers: nothing is read for them.
  const rows = kind === 'crew' ? ({ doors: [], sets: [], sits: [], sales: [], calendar: [] } as unknown as Awaited<ReturnType<typeof fetchPeriodMetricRows>>) : await fetchPeriodMetricRows(admin, { orgId: profile.org_id, startIso: start.toISOString(), endIso: end.toISOString() })
  const opts = { setterLane: kind === 'setter', contactDispositionIdSet: getContactDispositionIdSet(undefined) }
  const mine = summarizePeriodRows(rows, kind === 'owner' || kind === 'ops' ? null : new Set([profile.id]), opts)

  // Service-plan visits (only companies with the servicePlans switch on): ops and owners see today's crews + skips first.
  // Every kind but setter loads the visit queue on a service company (the "Visits left today" tile); only ops / owners get the queue cards.
  const visitsOn = kind !== 'setter' && orgProfile.features.servicePlans
  const visitCardsOn = kind === 'ops' || kind === 'owner'
  // Crew time clock: shifts the system stopped with no finish time (may be paying 0 h) — payroll admins (ops / owners).
  const clockOn = (kind === 'ops' || kind === 'owner') && isPayrollAdminRole(profile.role) && orgProfile.features.timeTracking
  // Hourly billing: commission changes waiting to be paid (owners only — it is pay).
  const commissionWaiting = kind === 'owner' ? await loadCommissionChangesWaitingQueue(admin, profile.org_id).catch((e) => { console.error('today: commission changes failed', e); return null }) : null
  // Customer emails switched on but the company's name / email / postal address is missing: nothing goes out (owners fix it).
  const messagesBlocked = kind === 'owner' && orgProfile.features.customerMessages ? await loadCustomerMessagesBlockedQueue(admin, profile.org_id).catch((e) => { console.error('today: customer messages check failed', e); return null }) : null
  // The one unpaid card (job and service invoices): ops / owners see it; amounts only for people who invoice (money:record) or see financials.
  const invoicesOn = kind === 'ops' || kind === 'owner'
  const invoiceMoney = invoicesOn && (hasFinancials(perms) || (await canBillService(admin, profile)).bill)
  const unpaidInvoices = invoicesOn ? await loadUnpaidInvoicesQueue(admin, profile.org_id, new Date(), { money: invoiceMoney }).catch((e) => { console.error('today: unpaid invoices failed', e); return unpaidInvoicesFailedQueue() }) : null
  // Cash / checks a crew took at the door, waiting for the office to confirm (money people only; companies with service plans).
  const doorCollections = invoicesOn && invoiceMoney && orgProfile.features.servicePlans ? await loadDoorCollectionsQueue(admin, profile.org_id, { money: true }).catch((e) => { console.error('today: door collections failed', e); return null }) : null
  // QuickBooks connection needs a person (reconnect): owners only, only while the switch is on.
  const quickBooksQueue = kind === 'owner' && orgProfile.features.quickbooks ? await loadQuickBooksNeedsYouQueue(admin, profile.org_id).catch((e) => { console.error('today: quickbooks check failed', e); return null }) : null
  // QuickBooks: records the CRM could not send without a person (Retry / Skip on Settings → QuickBooks).
  const quickBooksStuck = kind === 'owner' && orgProfile.features.quickbooks ? await loadQuickBooksStuckQueue(admin, profile.org_id).catch((e) => { console.error('today: quickbooks stuck check failed', e); return null }) : null
  const shiftsQueue = clockOn ? await loadOpenShiftsQueue(admin, profile.org_id).catch((e) => { console.error('today: open shifts failed', e); return null }) : null
  // Online payments: a lost dispute on a job already collected / paid in payroll — payroll admins review commission.
  const reversalsOn = (kind === 'ops' || kind === 'owner') && isPayrollAdminRole(profile.role) && orgProfile.features.onlinePayments
  const reversals = reversalsOn ? await loadPaymentReversalsQueue(admin, profile.org_id).catch((e) => { console.error('today: payment reversals failed', e); return null }) : null
  // Leads nobody has contacted: owners see them in the owner list (loadOwnerExceptions); everyone else but field roles sees their own.
  const myLeadsWaiting = kind === 'closer' || kind === 'ops' ? await loadLeadsWaitingQueue(admin, profile.org_id, new Date(), { ownerUserId: profile.id }).catch((e) => { console.error('today: leads waiting failed', e); return leadsWaitingFailedQueue() }) : null
  const [visitQueues, closerQueues, opsQueues, ownerQueues, report] = await Promise.all([
    visitsOn ? loadServiceVisitQueues(admin, profile.org_id).catch((e) => { console.error('today: visits failed', e); return [] }) : Promise.resolve([]),
    kind === 'closer' ? loadCloserQueues(admin, profile.org_id, profile.id, new Date(), { money: true }) : Promise.resolve([]),
    kind === 'ops' ? loadOpsQueues(admin, profile.org_id) : Promise.resolve([]),
    kind === 'owner' ? loadOwnerExceptions(admin, profile.org_id, new Date(), { money: hasFinancials(perms) }) : Promise.resolve([]),
    kind === 'ops' || kind === 'owner' ? loadNeedsYouForViewer(admin, profile.org_id, profile, canAccessJobBoardFromPermissionNames(perms)) : Promise.resolve(null),
  ])
  // The one Needs-you rule (lib/data-health.ts): owner everything, ops operational rows, anyone else nothing.
  const needsYou = report?.report ?? null
  const needsYouAudience: 'owner' | 'ops' = report?.audience === 'owner' ? 'owner' : 'ops'

  // Service companies (industry profile `today.ownerTiles`): this week in their own terms, each number from an existing
  // loader — today's visit queue, the unpaid-invoices card, and the revenue report (money only for people who see financials).
  const profileTiles = kind !== 'setter' ? orgProfile.today.ownerTiles : undefined
  const billedWeek = profileTiles?.includes('billed-week') && hasFinancials(perms)
    ? await buildReportContext(admin, profile)
        .then((ctx) => runReport(admin, ctx, { dataset: 'revenue', mode: 'summary', groupBy: null, metric: { kind: 'sum', column: 'billed' }, date: { preset: '7d' }, filters: [], sortDesc: true }))
        .then((r) => r.summary?.value ?? 0)
        .catch((e) => { console.error('today: billed this week failed', e); return null })
    : undefined
  const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  const profileTileList = (profileTiles ?? []).flatMap<{ label: string; value: string | number }>((key) => {
    // No service plans = no visits to count (hide the tile); a failed visits load shows '—', never a false 0.
    if (key === 'visits-left-today') return visitsOn ? [{ label: 'Visits left today', value: visitQueues.find((q) => q.id === 'todays-visits')?.count ?? '—' }] : []
    if (key === 'unpaid-invoices') return unpaidInvoices ? [{ label: 'Unpaid invoices', value: unpaidInvoices.empty.includes('couldn’t load') ? '—' : unpaidInvoices.count }] : []
    return billedWeek === undefined ? [] : [{ label: 'Billed, last 7 days', value: billedWeek === null ? '—' : usd(billedWeek) }]
  })
  const tiles =
    profileTiles
      ? profileTileList
      : kind === 'setter'
      ? [{ label: 'Doors this week', value: mine.doors }, { label: 'Inspections set', value: mine.inspectionsSet }]
      : kind === 'ops'
        ? [{ label: 'Sales this week', value: mine.sales }]
        : kind === 'crew'
        ? []
        : [
            { label: 'Sits this week', value: mine.sits },
            { label: 'Sales this week', value: mine.sales },
            { label: 'Inspections set', value: mine.inspectionsSet },
            { label: 'Appointments', value: mine.calendar },
          ]
  const finishSetup = await finishSetupPromise
  // A crew lead's or field tech's "My day" (stops + the time clock), from the same loaders as the dashboard card; nothing for anyone else.
  const myDay = applyDashboardWords(await myDayPromise, orgProfile.terms)
  const myDayHasClock = myDay.some((c) => c.kind === 'list' && c.key === 'my-day' && c.clock === true)
  const waiting = await resolveThreadViewer(admin, profile).then((viewer) => listWaiting(admin, viewer)).catch(() => [])
  // AI changes waiting for THIS person's Approve (the switch must be on; a failed read just hides the card).
  const aiChanges = orgProfile.features.aiConnectorWrites ? await loadAiChangesQueue(admin, profile.org_id, profile.id).catch((e) => { console.error('today: AI changes failed', e); return null }) : null
  // Reminders (company switch on): mine for everyone, everyone else's for owner / office (the same reader, lib/reminders.ts).
  const remindersOn = orgProfile.features.reminders
  // "Make a visit" on a reminder: service plans on AND the viewer may edit visits (lib/service-plans-access.ts).
  const canMakeVisit = remindersOn && orgProfile.features.servicePlans ? (await resolveServicePlanAccess(admin, profile.id, profile).catch(() => null))?.edit === true : false
  const myReminders = remindersOn ? await loadRemindersQueue(admin, profile.org_id, profile, 'mine', new Date(), { canMakeVisit }).catch((e) => { console.error('today: my reminders failed', e); return null }) : null
  const otherReminders = remindersOn && canSeeAllReminders(profile) ? await loadRemindersQueue(admin, profile.org_id, profile, 'others', new Date(), { canMakeVisit }).catch((e) => { console.error('today: reminders failed', e); return null }) : null
  const queues = [...(myReminders && (myReminders.count > 0 || (myReminders.upcoming?.length ?? 0) > 0) ? [myReminders] : []), ...(otherReminders && (otherReminders.count > 0 || (otherReminders.upcoming?.length ?? 0) > 0) ? [otherReminders] : []), ...(aiChanges && aiChanges.count > 0 ? [aiChanges] : []), ...applyTodayProfile([...(quickBooksQueue ? [quickBooksQueue] : []), ...(quickBooksStuck ? [quickBooksStuck] : []), ...(messagesBlocked ? [messagesBlocked] : []), ...(reversals && reversals.count > 0 ? [reversals] : []), ...(commissionWaiting ? [commissionWaiting] : []), ...(shiftsQueue ? [shiftsQueue] : []), ...(visitCardsOn ? visitQueues : []), ...(doorCollections && doorCollections.count > 0 ? [doorCollections] : []), ...(unpaidInvoices && (unpaidInvoices.count > 0 || unpaidInvoices.empty.includes('couldn’t load')) ? [unpaidInvoices] : []), ...(myLeadsWaiting && (myLeadsWaiting.count > 0 || myLeadsWaiting.empty.includes('couldn’t load')) ? [myLeadsWaiting] : []), ...closerQueues, ...opsQueues, ...ownerQueues], orgProfile.today, orgProfile.terms)]

  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6">
        <PageHeader
          title={TITLE[kind]}
          subtitle={`Hi ${profile.full_name?.split(' ')[0] ?? 'there'} — here's what needs you.`}
          actions={canvassOn ? <Button asChild><Link href="/canvass">Open Canvass</Link></Button> : undefined}
        />
        {/* The day clock: only for someone on a time-tracked crew (or leading one) and only when the company uses the clock. */}
        {orgProfile.features.timeTracking && !myDayHasClock ? <MyDayClock /> : null}
        {finishSetup ? <FinishSetupCard items={finishSetup} /> : null}
        {myDay.length > 0 ? <CardGrid cards={myDay} /> : null}
        <WaitingOnYou items={waiting} />
        {needsYou && needsYou.count > 0 ? <NeedsYouList report={needsYou} canFixPayPlans={isOwnerProfile(profile)} audience={needsYouAudience} /> : null}
        {kind === 'owner' && queues.length === 0 && (!needsYou || needsYou.count === 0) ? (
          <EmptyState title="All clear" body={orgProfile.today.allClear ?? "No exceptions: every appointment has an outcome, every sold job has a date, nothing is stuck."} />
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          {queues.map((q) => (
            <QueueCard key={q.id} queue={q} />
          ))}
        </div>
        {tiles.length > 0 ? (
          <section aria-label="This week" className="flex flex-col gap-2">
            <h2 className="text-ui-lg font-semibold text-ink">This week</h2>
            <KpiTiles tiles={tiles} />
          </section>
        ) : null}
      </main>
    </div>
  )
}
