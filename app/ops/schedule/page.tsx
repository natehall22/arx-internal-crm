export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'
import InstallScheduleClient from './InstallScheduleClient'

/**
 * Install Schedule Board — sub-contractor dispatch calendar.
 * View + assignment live on one screen (see InstallScheduleClient) so ops can
 * put a sold job on a sub's calendar in at most 2 clicks.
 *
 * Data (subs / scheduled / unscheduled jobs) is fetched client-side from
 * GET /api/ops/install-schedule — this page only gates access, matching the
 * pattern in app/ops/calendar/page.tsx.
 */
export default async function InstallSchedulePage() {
  const { authUser, profile } = await requireAuth()
  const admin = createServiceClient()
  const { canJobBoard } = await resolveOpsAccess(admin, authUser.id, profile)

  if (!canJobBoard) {
    redirect('/dashboard')
  }

  return <InstallScheduleClient />
}
