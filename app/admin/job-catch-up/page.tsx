import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import { PageHeader } from '@/components/ui'
import JobCatchUpSettingsClient from '@/components/admin/JobCatchUpSettingsClient'
import { requireAuth } from '@/lib/auth'
import { canOpenSettingsHub } from '@/lib/settings-registry'

export const dynamic = 'force-dynamic'

export default async function JobCatchUpSettingsPage() {
  const { profile } = await requireAuth()
  if (!canOpenSettingsHub(profile.role)) redirect('/dashboard')
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-2xl px-4 py-4 sm:px-6">
        <PageHeader title="Job catch-up" subtitle="One line per job on the Production Board, and a “Where this stands” box on each job — built from what already happened, nothing new to type." />
        <JobCatchUpSettingsClient />
      </main>
    </div>
  )
}
