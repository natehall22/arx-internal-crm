export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'

import { requireAuth } from '@/lib/auth'
import { buildJobRunSheet } from '@/lib/job-run-sheet'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'

import RunSheetEditor from './RunSheetEditor'

export default async function JobRunSheetPage({ params }: { params: { id: string } }) {
  const { authUser, profile } = await requireAuth()
  const admin = createServiceClient()

  const { canJobBoard, canEditJobs } = await resolveOpsAccess(admin, authUser.id, profile)
  if (!canJobBoard) redirect('/dashboard')

  const sheet = await buildJobRunSheet(admin, profile.org_id, params.id)
  if (!sheet) notFound()

  return <RunSheetEditor initialSheet={sheet} canEdit={canEditJobs} />
}
