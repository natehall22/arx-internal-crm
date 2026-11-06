import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import { PageHeader } from '@/components/ui'
import { requireAuth } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/super-admin'

import JobSetupClient from './JobSetupClient'

export const dynamic = 'force-dynamic'

/** Settings → Job setup: the company's own job lists (Trades now). Owners only. */
export default async function JobSetupPage() {
  const { profile } = await requireAuth()
  if (!isSuperAdmin(profile)) redirect('/admin')
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        <PageHeader title="Job setup" subtitle="Your company's own lists for jobs. Only owners can change these." />
        <JobSetupClient />
      </main>
    </div>
  )
}
