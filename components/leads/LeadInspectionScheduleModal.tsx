'use client'

import { useCallback, useEffect, useState } from 'react'
import CloseScheduleModal, { type CloseScheduleConfirm } from '@/components/appointments/CloseScheduleModal'

type SchedulingResources = {
  allowed: boolean
  teams: Array<{ id: string; name: string }>
  users: Array<{ id: string; full_name: string; has_calendar?: boolean }>
  inspectionDurationMinutes: number
}

type Props = {
  leadId: string
  open: boolean
  onClose: () => void
  /** After successful booking — e.g. router.refresh */
  onScheduled?: () => void
}

export default function LeadInspectionScheduleModal({
  leadId,
  open,
  onClose,
  onScheduled,
}: Props) {
  const [resources, setResources] = useState<SchedulingResources | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !leadId) return
    let cancelled = false
    setLoadError(null)

    fetch('/api/leads/scheduling-resources')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        setResources({
          allowed: Boolean(data?.allowed),
          teams: Array.isArray(data?.teams) ? data.teams : [],
          users: Array.isArray(data?.users) ? data.users : [],
          inspectionDurationMinutes: typeof data?.inspectionDurationMinutes === 'number' ? data.inspectionDurationMinutes : 60,
        })
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load scheduling options.')
      })

    return () => {
      cancelled = true
    }
  }, [open, leadId])

  const handleConfirm = useCallback(
    async (p: CloseScheduleConfirm) => {
      if (!leadId.trim()) return

      const closerUserId =
        p.useRoundRobin && p.teamId ? `team:${p.teamId}` : p.closerUserId
      const res = await fetch(`/api/leads/${leadId}/schedule-inspection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inspection_scheduled_for: p.scheduledLocal,
          use_round_robin: p.useRoundRobin,
          closer_user_id: closerUserId,
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        alert(
          typeof (data as { error?: string }).error === 'string'
            ? (data as { error: string }).error
            : 'Scheduling failed. Try another slot or contact an admin.'
        )
        return
      }

      onScheduled?.()
      onClose()
    },
    [leadId, onClose, onScheduled]
  )

  if (!open || !leadId) return null

  if (loadError) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-xl shadow-xl max-w-md p-6 space-y-4">
          <p className="text-sm text-gray-800">{loadError}</p>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  if (!resources) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-xl shadow-xl px-6 py-8 text-gray-600 text-sm">Loading…</div>
      </div>
    )
  }

  if (!resources.allowed) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-xl shadow-xl max-w-md p-6 space-y-3">
          <h2 className="font-semibold text-gray-900">Scheduling unavailable</h2>
          <p className="text-sm text-gray-600">
            Your role does not include <strong>Create Appointments</strong> (
            <code className="text-xs bg-gray-100 px-1 rounded">scheduling:create</code>). Ask an admin to assign it via
            role presets or user permissions.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <CloseScheduleModal
      open={open}
      onClose={onClose}
      onConfirm={handleConfirm}
      closeDurationMinutes={resources.inspectionDurationMinutes}
      users={resources.users}
      teams={resources.teams}
      modalTitle="Schedule inspection"
      intro={
        <p>
          Choose a <strong>team</strong> for round-robin assignment (shows how many closers are free per slot),
          or an <strong>individual closer</strong>. Slots use{' '}
          <strong>{resources.inspectionDurationMinutes} min</strong> from Admin → Scheduling.
        </p>
      }
      summaryHint="Inspection will move this lead forward and sync the closer calendar when connected."
      showAvailableCloserCounts
    />
  )
}
