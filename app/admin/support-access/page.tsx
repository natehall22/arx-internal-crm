import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import SettingsBackLink from '@/components/admin/SettingsBackLink'
import SupportAccessCard from '@/components/admin/SupportAccessCard'
import { PageHeader } from '@/components/ui'
import { requireAuth } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'

export default async function SupportAccessPage() {
  const { profile, support } = await requireAuth()
  // Owners only — and never from inside a support session (staff cannot manage the company's own support access).
  if (!isSuperAdmin(profile) || support) redirect('/admin')
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
        <SettingsBackLink />
        <PageHeader title="Support access" subtitle="Let the product support team into your company to help you. You choose for how long and can end it any time. Owners only." />
        <SupportAccessCard />
      </main>
    </div>
  )
}
