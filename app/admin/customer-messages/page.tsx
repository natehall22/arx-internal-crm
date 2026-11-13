import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import SettingsBackLink from '@/components/admin/SettingsBackLink'
import CustomerMessagesSettings from '@/components/admin/CustomerMessagesSettings'
import { PageHeader } from '@/components/ui'
import { requireAuth } from '@/lib/auth'
import { requireOrgFeaturePage } from '@/lib/org-features-server'
import { isSuperAdmin } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'

/** Settings → Customer messages: which automatic emails customers get, when, and what they say. Owners only. */
export default async function CustomerMessagesPage() {
  const { profile } = await requireAuth()
  await requireOrgFeaturePage(profile.org_id, 'customerMessages')
  if (!isSuperAdmin(profile)) redirect('/admin')
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        <SettingsBackLink />
        <PageHeader title="Customer messages" subtitle="Emails your customers get on their own. Each one is off until you turn it on." />
        <CustomerMessagesSettings />
      </main>
    </div>
  )
}
