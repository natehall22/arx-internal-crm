'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import LeadInspectionScheduleModal from '@/components/leads/LeadInspectionScheduleModal'

type Props = {
  leadId: string
  canScheduleInspection: boolean
  hasActiveInspectionSlot: boolean
  missingFields: string[]
  activeInspectionLabel?: string | null
}

/** Opens CRM inspection scheduling (team RR + slots) beside the workflow form. */
export default function LeadWorkflowInspectionScheduler({
  leadId,
  canScheduleInspection,
  hasActiveInspectionSlot,
  missingFields,
  activeInspectionLabel,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const readyToSchedule = canScheduleInspection && !hasActiveInspectionSlot && missingFields.length === 0
  const disabledReason = !canScheduleInspection
    ? 'Your role does not include Create Appointments. Ask an admin to add scheduling access.'
    : hasActiveInspectionSlot
      ? `This lead already has an active inspection${activeInspectionLabel ? ` for ${activeInspectionLabel}` : ''}.`
      : missingFields.length > 0
        ? `Save ${missingFields.join(', ')} before scheduling.`
        : null

  return (
    <>
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/80 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-indigo-950">Schedule inspection</h3>
            <p className="mt-1 text-sm text-indigo-950/80">
              Use pooled availability to assign a <span className="font-medium">team round-robin</span> or pick an
              individual closer without double-booking CRM slots.
            </p>
            {disabledReason && (
              <p className="mt-2 text-sm font-medium text-amber-800">{disabledReason}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={!readyToSchedule}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
          >
            Pick available slot
          </button>
        </div>
        <p className="mt-3 text-xs text-indigo-950/70">
          Manual date entry below is a manager fallback and does not run round-robin selection.
        </p>
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
