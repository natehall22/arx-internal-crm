'use client'

import { useState, useEffect, useRef } from 'react'
import CloseScheduleModal, { type CloseScheduleConfirm } from '@/components/appointments/CloseScheduleModal'
import {
  BoolToggle,
  CloseVisitPhotoUpload,
  MIN_PHOTOS,
  type UploadedPhoto,
  canSubmitCloseVisitDebrief,
} from '@/components/inspection/close-visit-shared'

const OUTCOME = 'approved' as const
const OUTCOME_LABEL = 'Approved — Ready to Close'

type InspectionResult = {
  id: string
  outcome: string
  submitted_at: string | null
}

type Props = {
  opportunityId: string
  inspectionAppointmentId: string | null
  /** Optional; if null, role is loaded from /api/canvass/data */
  currentUserRole: string | null
  closeDurationMinutes: number
  users: Array<{ id: string; full_name: string; has_calendar?: boolean }>
  teams: Array<{ id: string; name: string }>
  onComplete: () => void
  onFinishLater: () => void
}

export default function CloseVisitDebriefWizard({
  opportunityId,
  inspectionAppointmentId,
  currentUserRole,
  closeDurationMinutes,
  users,
  teams,
  onComplete,
  onFinishLater,
}: Props) {
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const [resolvedRole, setResolvedRole] = useState<string | null>(currentUserRole)
  useEffect(() => {
    setResolvedRole(currentUserRole)
  }, [currentUserRole])

  useEffect(() => {
    if (currentUserRole !== null) return
    let cancelled = false
    fetch('/api/canvass/data')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        if (typeof d.currentUserRole === 'string') setResolvedRole(d.currentUserRole)
        else setResolvedRole('')
      })
      .catch(() => {
        if (!cancelled) setResolvedRole('')
      })
    return () => {
      cancelled = true
    }
  }, [currentUserRole])

  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)

  const [bothDMs, setBothDMs] = useState<boolean | null>(null)
  const [absentDMName, setAbsentDMName] = useState('')
  const [damageFound, setDamageFound] = useState('')
  const [roofSlopes, setRoofSlopes] = useState('')
  const [homeownerMood, setHomeownerMood] = useState('')
  const [consequenceQs, setConsequenceQs] = useState<boolean | null>(null)
  const [insuranceMentioned, setInsuranceMentioned] = useState<boolean | null>(null)
  const [urgencyLevel, setUrgencyLevel] = useState<'low' | 'medium' | 'high' | ''>('')
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<UploadedPhoto[]>([])

  const [closeScheduled, setCloseScheduled] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const uploadedPhotoCount = photos.filter((p) => p.storagePath && !p.uploading).length
  const photosReady = uploadedPhotoCount >= MIN_PHOTOS

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const resultRes = await fetch(`/api/opportunities/${opportunityId}/inspection-result`)
        if (resultRes.ok) {
          const { result } = await resultRes.json()
          const row = result as InspectionResult | null
          if (row?.submitted_at) {
            if (!cancelled) onCompleteRef.current()
            return
          }
          const photosRes = await fetch(`/api/opportunities/${opportunityId}/inspection-photos`)
          if (photosRes.ok) {
            const { photos: existingPhotos } = await photosRes.json()
            if (existingPhotos?.length) {
              setPhotos(
                existingPhotos.map(
                  (p: { id: string; filename: string; url: string | null; storage_path: string }) => ({
                    id: p.id,
                    filename: p.filename,
                    previewUrl: p.url ?? '',
                    storagePath: p.storage_path,
                    uploading: false,
                  })
                )
              )
            }
          }
        }
      } catch (err) {
        console.error('CloseVisitDebriefWizard load:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [opportunityId])

  const roleKnown = resolvedRole !== null
  const maySubmit = canSubmitCloseVisitDebrief(resolvedRole)

  if (loading || !roleKnown) {
    return (
      <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500 text-sm">
        Loading debrief…
      </div>
    )
  }

  if (!maySubmit) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-900">
        Your role cannot submit the close visit debrief. Ask an admin or use Finish later to return — inspection
        feedback is already saved.
        <div className="mt-4">
          <button
            type="button"
            onClick={onFinishLater}
            className="text-indigo-600 font-medium hover:underline"
          >
            Finish later
          </button>
        </div>
      </div>
    )
  }

  function validateBriefing(): string | null {
    if (bothDMs === null) return 'Were both decision makers present?'
    if (!bothDMs && !absentDMName.trim()) return 'Enter the name of the absent decision maker'
    if (!damageFound.trim()) return 'Describe the damage found'
    if (!roofSlopes.trim()) return 'Enter the roof slopes'
    if (!photosReady) return `Upload at least ${MIN_PHOTOS} photos before continuing`
    if (!homeownerMood.trim()) return "Describe the homeowner's emotional state"
    if (consequenceQs === null) return 'Were consequence questions asked?'
    if (insuranceMentioned === null) return 'Was insurance discussed?'
    if (!urgencyLevel) return 'Select an urgency level'
    return null
  }

  function buildBriefingNotes(): string {
    const lines: string[] = [`Outcome: ${OUTCOME_LABEL}`]
    if (bothDMs !== null) lines.push(`Both DMs Present: ${bothDMs ? 'Yes' : 'No'}`)
    if (!bothDMs && absentDMName) lines.push(`Absent DM: ${absentDMName}`)
    if (damageFound) lines.push(`Damage Found: ${damageFound}`)
    if (roofSlopes) lines.push(`Roof Slopes: ${roofSlopes}`)
    if (homeownerMood) lines.push(`Homeowner Mood: ${homeownerMood}`)
    if (consequenceQs !== null) lines.push(`Consequence Qs: ${consequenceQs ? 'Yes' : 'No'}`)
    if (insuranceMentioned !== null) lines.push(`Insurance Mentioned: ${insuranceMentioned ? 'Yes' : 'No'}`)
    if (urgencyLevel) lines.push(`Urgency: ${urgencyLevel.charAt(0).toUpperCase() + urgencyLevel.slice(1)}`)
    if (notes) lines.push(`Notes: ${notes}`)
    lines.push(`Photos Uploaded: ${uploadedPhotoCount}`)
    return lines.join('\n')
  }

  async function saveAndAdvance(sendEmail: boolean) {
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        outcome: OUTCOME,
        send_email: sendEmail,
        final_submit: true,
        both_dms_present: bothDMs,
        absent_dm_name: absentDMName || null,
        damage_found: damageFound || null,
        roof_slopes: roofSlopes || null,
        homeowner_emotional_state: homeownerMood || null,
        consequence_questions_asked: consequenceQs,
        insurance_mentioned: insuranceMentioned,
        urgency_level: urgencyLevel || null,
        notes: notes || null,
      }

      const res = await fetch(`/api/opportunities/${opportunityId}/inspection-result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const d = await res.json()
        setError(d.error || 'Failed to save')
        return
      }

      setSubmitted(true)
      onComplete()
    } catch {
      setError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  async function handleScheduleClose(confirm: CloseScheduleConfirm) {
    if (!inspectionAppointmentId) {
      setScheduleError('No linked inspection appointment — cannot schedule close.')
      return
    }
    setScheduleError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/inspections/schedule-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_appointment_id: inspectionAppointmentId,
          scheduled_for: confirm.scheduledLocal,
          use_round_robin: confirm.useRoundRobin,
          team_id: confirm.teamId,
          closer_user_id: confirm.closerUserId,
          notes: buildBriefingNotes(),
        }),
      })

      if (!res.ok) {
        const d = await res.json()
        setScheduleError(d.error || 'Failed to schedule close')
        return
      }

      const closeData = await res.json()

      if (closeData.close_appointment_id) {
        await fetch(`/api/opportunities/${opportunityId}/inspection-result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outcome: OUTCOME,
            close_appointment_id: closeData.close_appointment_id,
          }),
        })
      }

      setCloseScheduled(true)
      setShowModal(false)
      setStep(3)
    } catch {
      setScheduleError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  const steps = ['Briefing', 'Schedule close', 'Submit']
  const currentStepIndex = step - 1

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Close visit debrief</h2>
          <p className="text-sm text-gray-500 mt-1">
            You marked this inspection as <span className="font-medium text-gray-700">Moving to Close</span>. Add
            photos and briefing for the closer, then schedule the close appointment.
          </p>
        </div>
        <button
          type="button"
          onClick={onFinishLater}
          className="text-sm text-gray-500 hover:text-gray-800 underline shrink-0"
        >
          Finish later
        </button>
      </div>

      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2 flex-shrink-0">
            <div
              className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold border-2 ${
                i < currentStepIndex
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : i === currentStepIndex
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-gray-300 text-gray-400'
              }`}
            >
              {i < currentStepIndex ? '✓' : i + 1}
            </div>
            <span className={`text-xs font-medium ${i === currentStepIndex ? 'text-indigo-600' : 'text-gray-400'}`}>
              {label}
            </span>
            {i < steps.length - 1 && <div className="w-6 h-px bg-gray-200" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <p className="text-xs text-gray-500 -mt-1 mb-1">
            Upload at least {MIN_PHOTOS} photos (roof / site). Use Add photos below.
          </p>

          <CloseVisitPhotoUpload opportunityId={opportunityId} photos={photos} onPhotosChange={setPhotos} />

          <BoolToggle label="Were both decision makers present?" value={bothDMs} onChange={setBothDMs} required />

          {bothDMs === false && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Absent DM Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={absentDMName}
                onChange={(e) => setAbsentDMName(e.target.value)}
                placeholder="e.g. John Smith"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Damage Found <span className="text-red-500">*</span>
            </label>
            <textarea
              value={damageFound}
              onChange={(e) => setDamageFound(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Roof Slopes <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={roofSlopes}
              onChange={(e) => setRoofSlopes(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Homeowner&apos;s Emotional State <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={homeownerMood}
              onChange={(e) => setHomeownerMood(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <BoolToggle label="Were consequence questions asked?" value={consequenceQs} onChange={setConsequenceQs} required />
          <BoolToggle label="Was insurance discussed?" value={insuranceMentioned} onChange={setInsuranceMentioned} required />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Urgency Level <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-3">
              {(['low', 'medium', 'high'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setUrgencyLevel(level)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium capitalize transition-colors ${
                    urgencyLevel === level
                      ? level === 'high'
                        ? 'bg-red-600 border-red-600 text-white'
                        : level === 'medium'
                          ? 'bg-amber-500 border-amber-500 text-white'
                          : 'bg-green-600 border-green-600 text-white'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Additional Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => {
                const validationError = validateBriefing()
                if (validationError) {
                  setError(validationError)
                  return
                }
                setError(null)
                setStep(2)
              }}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Schedule the close appointment. Briefing notes and photo count are added to the calendar flow.
          </p>

          {scheduleError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{scheduleError}</div>
          )}

          {!inspectionAppointmentId && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              No linked inspection visit to schedule the close from. You can still submit the debrief without
              scheduling.
            </div>
          )}

          {closeScheduled ? (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 font-medium">
              ✓ Close appointment scheduled successfully.
            </div>
          ) : (
            <button
              type="button"
              disabled={!inspectionAppointmentId}
              onClick={() => setShowModal(true)}
              className="w-full py-3 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Schedule close appointment
            </button>
          )}

          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => setStep(1)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              ← Back
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700"
            >
              {closeScheduled ? 'Next' : 'Skip & continue →'}
            </button>
          </div>

          <CloseScheduleModal
            open={showModal}
            onClose={() => setShowModal(false)}
            onConfirm={handleScheduleClose}
            closeDurationMinutes={closeDurationMinutes}
            users={users}
            teams={teams}
          />
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="p-4 bg-gray-50 border rounded-lg text-sm space-y-1">
            <p className="font-semibold text-gray-800 mb-2">Ready to submit</p>
            <p>
              <span className="text-gray-500">Outcome: </span>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                {OUTCOME_LABEL}
              </span>
            </p>
            <p className="text-gray-500 text-xs">
              Briefing complete — {uploadedPhotoCount} photo{uploadedPhotoCount !== 1 ? 's' : ''} uploaded
            </p>
            {closeScheduled && (
              <p className="text-green-600 text-xs font-medium">✓ Close appointment scheduled</p>
            )}
          </div>

          {!submitted && (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => saveAndAdvance(true)}
                className="w-full py-3 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Submitting…' : 'Submit & send briefing email'}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => saveAndAdvance(false)}
                className="w-full py-2 border border-gray-300 text-sm text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Submit without email
              </button>
            </div>
          )}

          <button type="button" onClick={() => setStep(2)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
            ← Back
          </button>
        </div>
      )}
    </div>
  )
}
