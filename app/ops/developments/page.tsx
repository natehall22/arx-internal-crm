export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'

import DevelopmentBoard from '@/components/ops/DevelopmentBoard'
import Nav from '@/components/Nav'
import { PageHeader } from '@/components/ui/page-header'
import { requireAuth } from '@/lib/auth'
import { loadDevelopmentBoard } from '@/lib/development-board-db'
import { requireOrgFeaturePage } from '@/lib/org-features-server'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'

/** Jobs → Developments: every lot of every development, one cell per crew. Property tools must be on (a company without them never sees it). */
export default async function DevelopmentsPage({ searchParams }: { searchParams: { customer?: string; development?: string } }) {
  const { authUser, profile } = await requireAuth()
  await requireOrgFeaturePage(profile.org_id, 'projectTools')
  const admin = createServiceClient()
  const { canJobBoard } = await resolveOpsAccess(admin, authUser.id, profile)
  if (!canJobBoard) redirect('/today')
  const board = await loadDevelopmentBoard(admin, profile.org_id, { customerId: searchParams.customer || undefined, development: searchParams.development || undefined }).catch((e) => {
    console.error('[developments] load failed', e)
    return null
  })
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <PageHeader title="Developments" subtitle="Every lot, and where each crew stands on it." />
        {board ? (
          <DevelopmentBoard board={board} customerId={searchParams.customer ?? ''} development={searchParams.development ?? ''} />
        ) : (
          <p className="rounded-ui border border-surface-line bg-surface p-4 text-ui-base text-ink">The board could not be loaded. Try again in a moment.</p>
        )}
      </main>
    </div>
  )
}
