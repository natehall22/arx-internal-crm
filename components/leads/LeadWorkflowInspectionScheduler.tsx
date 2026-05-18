'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import LeadInspectionScheduleModal from '@/components/leads/LeadInspectionScheduleModal'

type Props = {
  leadId: string
  showButton: boolean
}

/** Opens CRM inspection scheduling (team RR + slots) beside the workflow form. */
export default function LeadWorkflowInspectionScheduler({ leadId, showButton }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  if (!showButton) return null

  return (
    <>
      <div className="md:col-span-3 rounded-lg border border-indigo-100 bg-indigo-50/80 px-3 py-3">
        <p className="text-sm text-gray-800 mb-2">
          Use Google-backed availability to assign a{' '}
          <span className="font-medium">team (round-robin)</span> or an individual closer.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Schedule inspection (pick slot)
        </button>
      </div>

      <LeadInspectionScheduleModal
        leadId={leadId}
        open={open}
        onClose={() => setOpen(false)}
        onScheduled={() => router.refresh()}
      />
    </>
  )
}
