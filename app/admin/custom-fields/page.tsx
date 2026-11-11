import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import { PageHeader } from '@/components/ui'
import { requireAuth } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/super-admin'

import CustomFieldsClient from './CustomFieldsClient'

export const dynamic = 'force-dynamic'

/** Settings → Custom fields: the company's own fields on customers, properties and jobs. Owners only. */
export default async function CustomFieldsPage() {
  const { profile } = await requireAuth()
  if (!isSuperAdmin(profile)) redirect('/admin')
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        <PageHeader title="Custom fields" subtitle="Extra boxes your team fills in on customers, properties and jobs. Only owners can change this list." />
        <CustomFieldsClient />
      </main>
    </div>
  )
}
