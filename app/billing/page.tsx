export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import HoursToBill from '@/components/billing/HoursToBill'
import ReadyToBill from '@/components/billing/ReadyToBill'
import { requireAuth } from '@/lib/auth'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { resolveHourlyAccess } from '@/lib/hourly-billing-access'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import DoorCollections from '@/components/billing/DoorCollections'
import { loadPendingCollections } from '@/lib/visit-collections-db'
import { loadUnpaidInvoicesQueue, unpaidInvoicesFailedQueue } from '@/lib/today'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Money → Billing: the one home for billing work. Unpaid invoices (job and service, the same list as the Today card),
 * Ready to bill (service plans on) and Hours to bill (hourly billing on). Anyone who records money (money:record) sees it.
 */
export default async function BillingPage({ searchParams }: { searchParams?: { view?: string } }) {
  const { profile } = await requireAuth()
  const admin = createServiceClient()
  if (!(await callerCanAccessJobBilling(admin, profile))) redirect('/dashboard')

  const [servicePlans, hourly] = await Promise.all([isOrgFeatureOn(profile.org_id, 'servicePlans'), resolveHourlyAccess(admin, profile)])
  const view = searchParams?.view === 'ready' && servicePlans ? 'ready' : searchParams?.view === 'door' && servicePlans ? 'door' : searchParams?.view === 'hours' && hourly.bill ? 'hours' : 'unpaid'
  const door = servicePlans ? await loadPendingCollections(admin, profile.org_id).catch(() => []) : []
  const unpaid = view === 'unpaid' ? await loadUnpaidInvoicesQueue(admin, profile.org_id, new Date(), { money: true, cap: 200 }).catch((e) => { console.error('billing: unpaid invoices failed', e); return unpaidInvoicesFailedQueue() }) : null

  const tab = (active: boolean) => `inline-flex min-h-tap items-center rounded-ui px-4 text-ui-sm font-semibold ${active ? 'bg-brand-700 text-white' : 'border border-surface-line bg-surface text-ink'}`
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <nav aria-label="Billing views" className="mx-auto flex max-w-[1800px] flex-wrap gap-2 px-4 pt-4">
        <Link href="/billing" className={tab(view === 'unpaid')} aria-current={view === 'unpaid' ? 'page' : undefined}>Unpaid invoices</Link>
        {servicePlans ? <Link href="/billing?view=ready" className={tab(view === 'ready')} aria-current={view === 'ready' ? 'page' : undefined}>Ready to bill</Link> : null}
        {servicePlans ? <Link href="/billing?view=door" className={tab(view === 'door')} aria-current={view === 'door' ? 'page' : undefined}>At the door{door.length > 0 ? ` (${door.length})` : ''}</Link> : null}
        {hourly.bill ? <Link href="/billing?view=hours" className={tab(view === 'hours')} aria-current={view === 'hours' ? 'page' : undefined}>Hours to bill</Link> : null}
      </nav>
      {view === 'door' ? (
        <main className="mx-auto max-w-3xl px-4 py-4">
          <h1 className="mb-3 text-ui-lg font-semibold text-ink">Cash and checks to confirm</h1>
          <DoorCollections rows={door} />
        </main>
      ) : view === 'ready' ? <ReadyToBill /> : view === 'hours' ? <HoursToBill /> : (
        <main className="mx-auto max-w-3xl px-4 py-4">
          <h1 className="mb-3 text-ui-lg font-semibold text-ink">{unpaid?.title ?? 'Unpaid invoices'}{unpaid && unpaid.count > 0 ? ` (${unpaid.count})` : ''}</h1>
          {unpaid && unpaid.items.length > 0 ? (
            <ul className="overflow-hidden rounded-ui border border-surface-line bg-surface">
              {unpaid.items.map((i) => (
                <li key={i.id} className="border-b border-surface-line last:border-b-0">
                  <Link href={i.href} className="flex min-h-tap flex-col justify-center px-4 py-3">
                    <span className="text-ui-base font-semibold text-ink">{i.title}</span>
                    <span className="text-ui-sm text-ink">{[i.ref, i.detail].filter(Boolean).join(' · ')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-ui border border-surface-line bg-surface px-4 py-6 text-ui-base text-ink">{unpaid?.empty ?? 'No unpaid invoices.'}</p>
          )}
        </main>
      )}
    </div>
  )
}
