import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import TimeClockSettingsCard from '@/components/time/TimeClockSettingsCard'
import TimeWeekClient from '@/components/time/TimeWeekClient'
import { PageHeader } from '@/components/ui'
import { requireAuth } from '@/lib/auth'
import { requireOrgFeaturePage } from '@/lib/org-features-server'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { isSuperAdmin } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'

/** Time — the office's week of crew time (payroll admins). Fixes need a reason; an approved week is read-only. */
export default async function TimePage() {
  const { profile } = await requireAuth()
  await requireOrgFeaturePage(profile.org_id, 'timeTracking')
  if (!isPayrollAdminRole(profile.role)) redirect('/today')
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-4 sm:px-6">
        <PageHeader title="Time" subtitle="Crew time for the pay week. Hours go to payroll and labor cost to each job on their own." />
        <TimeWeekClient />
        {isSuperAdmin(profile) ? <TimeClockSettingsCard /> : null}
      </main>
    </div>
  )
}
