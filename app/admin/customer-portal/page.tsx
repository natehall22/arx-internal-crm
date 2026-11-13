import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import SettingsBackLink from '@/components/admin/SettingsBackLink'
import CustomerPortalSettings from '@/components/admin/CustomerPortalSettings'
import { PageHeader } from '@/components/ui'
import { requireAuth } from '@/lib/auth'
import { requireOrgFeaturePage } from '@/lib/org-features-server'
import { loadPortalSettings } from '@/lib/portal/settings'
import { createServiceClient } from '@/lib/supabase/service'
import { isSuperAdmin } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'

/** Settings → Customer portal: who can sign in and how install dates read. Owners only. */
export default async function CustomerPortalPage() {
  const { profile } = await requireAuth()
  await requireOrgFeaturePage(profile.org_id, 'customerPortal')
  if (!isSuperAdmin(profile)) redirect('/admin')
  const initial = await loadPortalSettings(createServiceClient(), profile.org_id)
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        <SettingsBackLink />
        <PageHeader title="Customer portal" subtitle="Your customers see their project, photos, documents and invoices at your own web address." />
        <CustomerPortalSettings initial={initial} />
      </main>
    </div>
  )
}
