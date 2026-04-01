'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Detail, boolDisplay } from '@/components/inspection/close-visit-shared'

type InspectionResult = {
  id: string
  outcome: string
  both_dms_present: boolean | null
  absent_dm_name: string | null
  damage_found: string | null
  roof_slopes: string | null
  homeowner_emotional_state: string | null
  consequence_questions_asked: boolean | null
  insurance_mentioned: boolean | null
  urgency_level: string | null
  notes: string | null
  close_appointment_id: string | null
  briefing_email_sent_at: string | null
  submitted_at: string | null
}

const OUTCOME_LABELS: Record<string, string> = {
  approved: 'Approved — Ready to Close',
  denied: 'Denied',
  follow_up: 'Follow-Up Needed',
  not_home: 'Not Home',
  cancelled: 'Cancelled',
  other: 'Other',
}

const OUTCOME_COLORS: Record<string, string> = {
  approved: 'bg-green-100 text-green-700',
  denied: 'bg-red-100 text-red-700',
  follow_up: 'bg-blue-100 text-blue-700',
  not_home: 'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-gray-100 text-gray-600',
  other: 'bg-gray-100 text-gray-600',
}

type Props = {
  opportunityId: string
  leadId: string | null
  inspectionAppointmentId: string | null
}

export default function InspectionResultReadOnlyCard({
  opportunityId,
  leadId,
  inspectionAppointmentId,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [existing, setExisting] = useState<InspectionResult | null>(null)
  const [readOnlyPhotos, setReadOnlyPhotos] = useState<
    Array<{ id: string; filename: string; url: string | null }>
  >([])

  const feedbackHref =
    leadId && inspectionAppointmentId
      ? `/appointments/feedback?id=${inspectionAppointmentId}&lead_id=${leadId}`
      : leadId
        ? `/appointments/feedback?lead_id=${leadId}`
        : null

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const resultRes = await fetch(`/api/opportunities/${opportunityId}/inspection-result`)
        if (!resultRes.ok) return
        const { result } = await resultRes.json()
        const row = result as InspectionResult | null
        if (cancelled) return
        setExisting(row)

        if (row?.submitted_at && (row.outcome === 'approved' || row.outcome === 'follow_up')) {
          const photosRes = await fetch(`/api/opportunities/${opportunityId}/inspection-photos`)
          if (photosRes.ok) {
            const { photos: submittedPhotos } = await photosRes.json()
            setReadOnlyPhotos(
              Array.isArray(submittedPhotos)
                ? submittedPhotos.map((p: { id: string; filename: string; url: string | null }) => ({
                    id: p.id,
                    filename: p.filename,
                    url: p.url ?? null,
                  }))
                : []
            )
          }
        }
      } catch (e) {
        console.error('InspectionResultReadOnlyCard:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [opportunityId])

  if (loading) {
    return (
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Close visit debrief</h2>
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  if (!existing?.submitted_at) {
    return (
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Close visit debrief</h2>
        <p className="text-sm text-gray-600 mb-4">
          Photos, briefing for the closer, and scheduling the close appointment are completed from{' '}
          <strong>Inspection feedback</strong> when you choose <strong>Moving to Close</strong> (lead or
          appointment link).
        </p>
        {feedbackHref ? (
          <Link
            href={feedbackHref}
            className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700"
          >
            Open inspection feedback
          </Link>
        ) : (
          <p className="text-sm text-amber-700">Link this opportunity to a lead to open the feedback form.</p>
        )}
      </div>
    )
  }

  return (
    <div className="bg-white shadow rounded-lg p-6 mb-6">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Close visit debrief</h2>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span
            className={`px-3 py-1 rounded-full text-sm font-semibold ${
              OUTCOME_COLORS[existing.outcome] || 'bg-gray-100 text-gray-700'
            }`}
          >
            {OUTCOME_LABELS[existing.outcome] ?? existing.outcome}
          </span>
          <span className="text-xs text-gray-400">
            Submitted {new Date(existing.submitted_at).toLocaleString()}
          </span>
        </div>

        {(existing.outcome === 'approved' || existing.outcome === 'follow_up') && (
          <>
            {readOnlyPhotos.length > 0 && (
              <div className="border rounded-lg p-4 bg-gray-50">
                <p className="text-sm font-medium text-gray-800 mb-2">
                  Close visit photos ({readOnlyPhotos.length})
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {readOnlyPhotos.map((p) => (
                    <div
                      key={p.id}
                      className="relative aspect-square rounded-lg overflow-hidden bg-gray-200 border border-gray-200"
                    >
                      {p.url ? (
                        <img src={p.url} alt={p.filename} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-500 p-1 text-center">
                          Preview unavailable
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm border rounded-lg p-4 bg-gray-50">
              <Detail label="Both DMs Present" value={boolDisplay(existing.both_dms_present)} />
              {!existing.both_dms_present && existing.absent_dm_name && (
                <Detail label="Absent DM" value={existing.absent_dm_name} />
              )}
              {existing.damage_found && <Detail label="Damage Found" value={existing.damage_found} />}
              {existing.roof_slopes && <Detail label="Roof Slopes" value={existing.roof_slopes} />}
              {existing.homeowner_emotional_state && (
                <Detail label="Homeowner Mood" value={existing.homeowner_emotional_state} />
              )}
              <Detail label="Consequence Qs" value={boolDisplay(existing.consequence_questions_asked)} />
              <Detail label="Insurance Mentioned" value={boolDisplay(existing.insurance_mentioned)} />
              {existing.urgency_level && (
                <Detail
                  label="Urgency"
                  value={existing.urgency_level.charAt(0).toUpperCase() + existing.urgency_level.slice(1)}
                />
              )}
              {existing.notes && <Detail label="Notes" value={existing.notes} className="col-span-full" />}
            </div>
          </>
        )}

        <div className="flex items-center gap-4 text-xs text-gray-500">
          {existing.close_appointment_id && (
            <span className="text-green-600 font-medium">✓ Close appointment scheduled</span>
          )}
          {existing.briefing_email_sent_at ? (
            <span className="text-green-600 font-medium">✓ Briefing email sent</span>
          ) : (
            <span className="text-gray-400">Briefing email not sent</span>
          )}
        </div>
      </div>
    </div>
  )
}
