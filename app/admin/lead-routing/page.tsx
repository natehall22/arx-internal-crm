import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import SettingsBackLink from '@/components/admin/SettingsBackLink'
import LeadRoutingSettings from '@/components/admin/LeadRoutingSettings'
import { PageHeader } from '@/components/ui'
import { requireAuth } from '@/lib/auth'
import { canEditLeadIntake } from '@/lib/lead-intake'

export const dynamic = 'force-dynamic'

/** Settings → Lead routing: who new website leads go to, and when an untouched lead counts as waiting. Admins and owners. */
export default async function LeadRoutingPage() {
  const { profile } = await requireAuth()
  if (!canEditLeadIntake(profile)) redirect('/admin')
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        <SettingsBackLink />
        <PageHeader title="Lead routing" subtitle="Who gets new website leads, and when a lead nobody has called counts as waiting." />
        <LeadRoutingSettings />
      </main>
    </div>
  )
}
