import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import MoveFromJobber from '@/components/jobber-import/MoveFromJobber'
import { PageHeader } from '@/components/ui'
import { requireAuth } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'

/** Settings → Move from Jobber: upload Jobber's exports, check, bring it over (owners only). */
export default async function MoveFromJobberPage() {
  const { profile } = await requireAuth()
  if (!isSuperAdmin(profile)) redirect('/admin')
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        <PageHeader title="Move from Jobber" subtitle="Bring your customers, properties, plans, invoices and price book over. Nothing is saved until you press Import, and the whole import can be undone." />
        <MoveFromJobber />
      </main>
    </div>
  )
}
