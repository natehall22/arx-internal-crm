'use client'

import RecordAIContextHelper from '@/components/RecordAIContextHelper'

export default function OpsJobAIContextLayout({
  jobId,
  children,
}: {
  jobId: string
  children: React.ReactNode
}) {
  return (
    <>
      <RecordAIContextHelper context={{ type: 'job', id: jobId }} />
      {children}
    </>
  )
}
