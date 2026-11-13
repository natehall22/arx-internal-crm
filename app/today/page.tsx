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
import { canBillService } from '@/lib/service-billing-access'
import { canAccessJobBoardFromPermissionNames, isOrgSuperuserRoleSlug } from '@/lib/permissions'
import { fetchPeriodMetricRows, getContactDispositionIdSet, summarizePeriodRows } from '@/lib/reporting/period-metrics'
import { isOwnerProfile } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveThreadViewer } from '@/lib/threads/viewer'
import { listWaiting } from '@/lib/threads/waiting'
import { loadOpenShiftsQueue } from '@/lib/time-tracking-db'
import { loadCommissionChangesWaitingQueue } from '@/lib/payroll-commission-change'
import { loadCustomerMessagesBlockedQueue } from '@/lib/customer-messages-db'
import { loadQuickBooksStuckQueue } from '@/lib/quickbooks/activity'
import { loadQuickBooksNeedsYouQueue } from '@/lib/quickbooks/connection'
import { loadPaymentReversalsQueue } from '@/lib/online-payments/summary'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { loadAiChangesQueue, loadCloserQueues, loadDoorCollectionsQueue, loadOpsQueues, loadOwnerExceptions, loadServiceVisitQueues, loadUnpaidInvoicesQueue, todayKindFor, unpaidInvoicesFailedQueue, type TodayKind } from '@/lib/today'
import { applyTodayProfile, loadOrgProfile } from '@/lib/org-profile'
import { leadsWaitingFailedQueue, loadLeadsWaitingQueue } from '@/lib/leads-waiting'

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

  // The company's industry profile (lib/org-profile.ts): feature switches + which Today cards, in what order, with what titles.
  const orgProfile = await loadOrgProfile(admin, profile.org_id)
  // Setters work in the field: on a phone, Today IS the canvass app (unless the company switched door knocking off).
  const canvassOn = kind === 'setter' && orgProfile.features.canvassing
  if (canvassOn && /iPhone|Android|Mobile/i.test(headers().get('user-agent') ?? '')) redirect('/canvass')

  const { start, end } = getDateRangeForTimeFrame('week', 'America/New_York')
  const rows = await fetchPeriodMetricRows(admin, { orgId: profile.org_id, startIso: start.toISOString(), endIso: end.toISOString() })
  const opts = { setterLane: kind === 'setter', contactDispositionIdSet: getContactDispositionIdSet(undefined) }
  const mine = summarizePeriodRows(rows, kind === 'owner' || kind === 'ops' ? null : new Set([profile.id]), opts)

  // Service-plan visits (only companies with the servicePlans switch on): ops and owners see today's crews + skips first.
  const visitsOn = (kind === 'ops' || kind === 'owner') && orgProfile.features.servicePlans
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
  // AI changes waiting for THIS person's Approve (the switch must be on; a failed read just hides the card).
  const aiChanges = orgProfile.features.aiConnectorWrites ? await loadAiChangesQueue(admin, profile.org_id, profile.id).catch((e) => { console.error('today: AI changes failed', e); return null }) : null
  const queues = [...(aiChanges && aiChanges.count > 0 ? [aiChanges] : []), ...applyTodayProfile([...(quickBooksQueue ? [quickBooksQueue] : []), ...(quickBooksStuck ? [quickBooksStuck] : []), ...(messagesBlocked ? [messagesBlocked] : []), ...(reversals && reversals.count > 0 ? [reversals] : []), ...(commissionWaiting ? [commissionWaiting] : []), ...(shiftsQueue ? [shiftsQueue] : []), ...visitQueues, ...(doorCollections && doorCollections.count > 0 ? [doorCollections] : []), ...(unpaidInvoices && (unpaidInvoices.count > 0 || unpaidInvoices.empty.includes('couldn’t load')) ? [unpaidInvoices] : []), ...(myLeadsWaiting && (myLeadsWaiting.count > 0 || myLeadsWaiting.empty.includes('couldn’t load')) ? [myLeadsWaiting] : []), ...closerQueues, ...opsQueues, ...ownerQueues], orgProfile.today, orgProfile.terms)]

  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6">
        <PageHeader
          title={TITLE[kind]}
          subtitle={`Hi ${profile.full_name?.split(' ')[0] ?? 'there'} — here's what needs you.`}
          actions={canvassOn ? <Button asChild><Link href="/canvass">Open Canvass</Link></Button> : undefined}
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
