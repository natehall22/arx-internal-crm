export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'

import CheckupList from '@/components/checkups/CheckupList'
import Nav from '@/components/Nav'
import { PageHeader } from '@/components/ui/page-header'
import { requireAuth } from '@/lib/auth'
import { ymdInBusinessTz } from '@/lib/calendar-business-tz'
import { ensureCheckups, loadCheckups, loadCheckupSettings, OPEN_CHECKUP_STATUSES } from '@/lib/checkups'
import { CHECKUP_LEAD_DAYS } from '@/lib/checkups-settings'
import { addDaysToDateOnly } from '@/lib/install-calendar'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'

/** Jobs → Checkups: past customers due an inspection or a check-in call, and what came of each. */
export default async function CheckupsPage() {
  const { authUser, profile } = await requireAuth()
  const admin = createServiceClient()
  const { canJobBoard } = await resolveOpsAccess(admin, authUser.id, profile)
  if (!canJobBoard) redirect('/today')

  const settings = await loadCheckupSettings(admin, profile.org_id)
  let loadError = false
  if (settings.enabled) {
    await ensureCheckups(admin, profile.org_id).catch((e) => {
      console.error('checkups: ensure failed', e)
      loadError = true
    })
  }
  const all = await loadCheckups(admin, profile.org_id).catch((e) => {
    console.error('checkups: load failed', e)
    loadError = true
    return []
  })

  const today = ymdInBusinessTz(new Date())
  const soon = addDaysToDateOnly(today, CHECKUP_LEAD_DAYS)
  const closedSince = addDaysToDateOnly(today, -90)
  const open = all.filter((c) => OPEN_CHECKUP_STATUSES.includes(c.status))
  const sections = [
    { id: 'overdue', title: 'Due now', empty: 'Nothing due right now.', rows: open.filter((c) => c.status === 'due' && c.due_on <= today) },
    { id: 'booked', title: 'Booked', empty: 'No visits booked.', rows: open.filter((c) => c.status === 'booked') },
    { id: 'soon', title: `Coming up (next ${CHECKUP_LEAD_DAYS} days)`, empty: 'Nothing coming up.', rows: open.filter((c) => c.status === 'due' && c.due_on > today && c.due_on <= soon) },
    {
      id: 'closed',
      title: 'Done in the last 90 days',
      empty: 'Nothing closed yet.',
      rows: all.filter((c) => !OPEN_CHECKUP_STATUSES.includes(c.status) && (c.done_at ?? '').slice(0, 10) >= closedSince).sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? '')),
    },
  ]

  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
        <PageHeader title="Checkups" subtitle="Inspections and check-in calls for customers after their install." />
        {!settings.enabled && (
          <p className="mb-4 rounded-ui border border-surface-line bg-surface p-4 text-ui-base text-ink">
            Checkups are off. <Link href="/admin#checkups" className="font-semibold underline">Turn them on in Settings</Link>.
          </p>
        )}
        {settings.enabled && !settings.assigneeUserId && (
          <p className="mb-4 rounded-ui border border-amber-600 bg-amber-50 p-4 text-ui-base text-ink">
            Nobody is assigned to checkups yet. <Link href="/admin#checkups" className="font-semibold underline">Pick a person in Settings</Link>.
          </p>
        )}
        {loadError && <p className="mb-4 rounded-ui border border-red-700 bg-red-50 p-4 text-ui-base text-ink">Checkups couldn’t fully load. Refresh to try again.</p>}
        <CheckupList today={today} sections={sections} />
      </main>
    </div>
  )
}
