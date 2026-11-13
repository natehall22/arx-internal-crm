import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import SettingsBackLink from '@/components/admin/SettingsBackLink'
import TextingSettings from '@/components/admin/TextingSettings'
import { PageHeader } from '@/components/ui'
import { requireAuth } from '@/lib/auth'
import { requireOrgFeaturePage } from '@/lib/org-features-server'
import { isSuperAdmin } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'

/** Settings → Texting: the company's own number and where it stands, the business details carriers ask for, usage, and texts nobody could be matched to. Owners only. */
export default async function TextingPage() {
  const { profile } = await requireAuth()
  await requireOrgFeaturePage(profile.org_id, 'texting')
  if (!isSuperAdmin(profile)) redirect('/admin')
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        <SettingsBackLink />
        <PageHeader title="Texting" subtitle="Text your customers from your company’s own number." />
        <TextingSettings />
      </main>
    </div>
  )
}
