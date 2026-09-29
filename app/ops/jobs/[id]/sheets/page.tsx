export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'

import { requireAuth } from '@/lib/auth'
import { buildJobRunSheet, toClientRunSheet } from '@/lib/job-run-sheet'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'

import JobSheetsEditor from './JobSheetsEditor'

export default async function JobSheetsPage({ params }: { params: { id: string } }) {
  const { authUser, profile } = await requireAuth()
  const admin = createServiceClient()

  const { canJobBoard, canEditJobs } = await resolveOpsAccess(admin, authUser.id, profile)
  if (!canJobBoard) redirect('/dashboard')

  const sheet = await buildJobRunSheet(admin, profile.org_id, params.id)
  if (!sheet) notFound()

  return (
    <JobSheetsEditor
      initialSheet={toClientRunSheet(sheet)}
      canEdit={canEditJobs}
      scope={sheet.soldScope}
      coverage={sheet.coverage}
      // Same gate as the job page's order list and documents banner.
      showOrder={sheet.jobType === 'roofing'}
    />
  )
}
