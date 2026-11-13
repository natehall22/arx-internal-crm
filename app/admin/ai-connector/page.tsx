import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import SettingsBackLink from '@/components/admin/SettingsBackLink'
import { PageHeader } from '@/components/ui'
import { requireAuth } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/super-admin'

import AiConnectorClient from './AiConnectorClient'

export const dynamic = 'force-dynamic'

export default async function AiConnectorPage() {
  const { profile } = await requireAuth()
  if (!isSuperAdmin(profile)) redirect('/admin')
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
        <SettingsBackLink />
        <PageHeader title="AI connector" subtitle="Let people use their own AI app (Claude, ChatGPT) to look things up in the CRM as themselves. Owners only." />
        <AiConnectorClient />
      </main>
    </div>
  )
}
