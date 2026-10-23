'use client'

import JobFileWorkspaceCard from '@/components/ops/JobFileWorkspaceCard'

/** Files tab: the existing job file workspace (documents, photos, cost attachments) on the job's deal. */
export default function FilesPanel(props: { jobId: string; userRole: string; canSeeFinancials: boolean; jobStatus: string; customerEmail: string | null }) {
  return (
    <JobFileWorkspaceCard
      jobId={props.jobId}
      userRole={props.userRole}
      canSeeJobFinancialAmounts={props.canSeeFinancials}
      jobStatus={props.jobStatus}
      customerEmail={props.customerEmail}
    />
  )
}
