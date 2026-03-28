'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import CloseScheduleModal, { type CloseScheduleConfirm } from '@/components/appointments/CloseScheduleModal'

// ─── Types ────────────────────────────────────────────────────────────────────

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

type UploadedPhoto = {
  id: string
  filename: string
  previewUrl: string // blob: URL for new uploads, or signed https URL after hydration
  storagePath?: string
  uploading: boolean
  error?: string
}

type Props = {
  opportunityId: string
  inspectionAppointmentId: string | null
  currentUserRole: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_PHOTOS = 6
const MAX_PHOTOS = 20
const MAX_MP = 2_000_000       // 2 megapixel cap
const TARGET_BYTES = 800_000   // 800 KB soft target

const ROLES_CAN_SUBMIT = new Set([
  'admin', 'owner', 'setter_manager', 'regional_setter_manager',
  'sales_manager', 'regional_manager', 'rep',
])

const OUTCOME_LABELS: Record<string, string> = {
  approved:   'Approved — Ready to Close',
  denied:     'Denied',
  follow_up:  'Follow-Up Needed',
  not_home:   'Not Home',
  cancelled:  'Cancelled',
  other:      'Other',
}

const OUTCOME_COLORS: Record<string, string> = {
  approved:   'bg-green-100 text-green-700',
  denied:     'bg-red-100 text-red-700',
  follow_up:  'bg-blue-100 text-blue-700',
  not_home:   'bg-yellow-100 text-yellow-700',
  cancelled:  'bg-gray-100 text-gray-600',
  other:      'bg-gray-100 text-gray-600',
}

// ─── Compression (Canvas API, no library) ────────────────────────────────────

async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const { width: origW, height: origH } = bitmap

  // Scale down if over 2MP
  let w = origW
  let h = origH
  const px = origW * origH
  if (px > MAX_MP) {
    const scale = Math.sqrt(MAX_MP / px)
    w = Math.round(origW * scale)
    h = Math.round(origH * scale)
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  // Try quality 0.82 first, then 0.65, then 0.5 if still too large
  for (const quality of [0.82, 0.65, 0.5]) {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        quality
      )
    )
    if (blob.size <= TARGET_BYTES || quality === 0.5) return blob
  }
  // Unreachable but TypeScript needs a return
  return new Blob()
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function BoolToggle({
  label,
  value,
  onChange,
  required,
}: {
  label: string
  value: boolean | null
  onChange: (v: boolean) => void
  required?: boolean
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
            value === true
              ? 'bg-green-600 border-green-600 text-white'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
            value === false
              ? 'bg-red-600 border-red-600 text-white'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          No
        </button>
      </div>
    </div>
  )
}

function Detail({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <span className="text-gray-500 text-xs block">{label}</span>
      <span className="text-gray-800 text-sm">{value}</span>
    </div>
  )
}

function boolDisplay(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return v ? 'Yes' : 'No'
}

// ─── Photo Upload Section ─────────────────────────────────────────────────────

function PhotoUploadSection({
  opportunityId,
  photos,
  onPhotosChange,
}: {
  opportunityId: string
  photos: UploadedPhoto[]
  onPhotosChange: (photos: UploadedPhoto[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadedCount = photos.filter((p) => p.storagePath && !p.uploading).length
  const uploadingCount = photos.filter((p) => p.uploading).length
  const canAddMore = photos.length < MAX_PHOTOS

  async function handleFiles(files: FileList) {
    const remaining = MAX_PHOTOS - photos.length
    const toProcess = Array.from(files).slice(0, remaining)

    // Create placeholder entries immediately so thumbnails appear
    const placeholders: UploadedPhoto[] = toProcess.map((f) => ({
      id: crypto.randomUUID(),
      filename: f.name,
      previewUrl: URL.createObjectURL(f),
      uploading: true,
    }))
    onPhotosChange([...photos, ...placeholders])

    // Compress + upload each in parallel
    await Promise.all(
      toProcess.map(async (file, i) => {
        const placeholder = placeholders[i]
        try {
          const compressed = await compressImage(file)
          const fd = new FormData()
          fd.append('file', compressed, file.name.replace(/\.[^.]+$/, '.jpg'))

          const res = await fetch(`/api/opportunities/${opportunityId}/inspection-photos`, {
            method: 'POST',
            body: fd,
          })

          if (!res.ok) {
            const d = await res.json()
            onPhotosChange((prev) =>
              prev.map((p) =>
                p.id === placeholder.id
                  ? { ...p, uploading: false, error: d.error || 'Upload failed' }
                  : p
              )
            )
            return
          }

          const { photo } = await res.json()
          onPhotosChange((prev) =>
            prev.map((p) =>
              p.id === placeholder.id
                ? { ...p, id: photo.id, storagePath: photo.storage_path, uploading: false }
                : p
            )
          )
        } catch {
          onPhotosChange((prev) =>
            prev.map((p) =>
              p.id === placeholder.id
                ? { ...p, uploading: false, error: 'Upload failed' }
                : p
            )
          )
        }
      })
    )
  }

  async function removePhoto(photo: UploadedPhoto) {
    // If already uploaded to server, delete it
    if (photo.storagePath) {
      await fetch(`/api/opportunities/${opportunityId}/inspection-photos/${photo.id}`, {
        method: 'DELETE',
      }).catch(() => {/* non-fatal */})
    }
    if (photo.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(photo.previewUrl)
    }
    onPhotosChange(photos.filter((p) => p.id !== photo.id))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-gray-700">
          Inspection Photos
          <span className="text-red-500 ml-0.5">*</span>
          <span className="text-gray-400 font-normal ml-1">
            (min {MIN_PHOTOS}, max {MAX_PHOTOS})
          </span>
        </label>
        <span className={`text-xs font-semibold ${
          uploadedCount >= MIN_PHOTOS ? 'text-green-600' : 'text-amber-600'
        }`}>
          {uploadedCount} / {MIN_PHOTOS} required
        </span>
      </div>

      {/* Thumbnail grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
          {photos.map((photo) => (
            <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
              {photo.previewUrl ? (
                <img
                  src={photo.previewUrl}
                  alt={photo.filename}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center p-1 text-center text-[10px] text-gray-500 leading-tight">
                  No preview
                </div>
              )}
              {photo.uploading && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {photo.error && (
                <div className="absolute inset-0 bg-red-500/70 flex items-center justify-center p-1">
                  <span className="text-white text-xs text-center leading-tight">Failed</span>
                </div>
              )}
              {!photo.uploading && (
                <button
                  type="button"
                  onClick={() => removePhoto(photo)}
                  className="absolute top-1 right-1 w-5 h-5 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center text-xs leading-none"
                  aria-label="Remove photo"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload button */}
      {canAddMore && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploadingCount > 0}
            className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploadingCount > 0
              ? `Uploading ${uploadingCount} photo${uploadingCount > 1 ? 's' : ''}…`
              : `+ Add photos${photos.length > 0 ? ` (${MAX_PHOTOS - photos.length} remaining)` : ''}`}
          </button>
        </>
      )}

      {uploadedCount < MIN_PHOTOS && photos.length > 0 && uploadingCount === 0 && (
        <p className="text-xs text-amber-600 mt-2">
          Add {MIN_PHOTOS - uploadedCount} more photo{MIN_PHOTOS - uploadedCount > 1 ? 's' : ''} to continue.
        </p>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function InspectionResultForm({ opportunityId, inspectionAppointmentId, currentUserRole }: Props) {
  const [existing, setExisting] = useState<InspectionResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)

  // Step 1
  const [outcome, setOutcome] = useState('')

  // Step 2 — briefing
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

  // Step 3 — schedule close
  const [closeScheduled, setCloseScheduled] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [closeDurationMinutes, setCloseDurationMinutes] = useState(60)
  const [users, setUsers] = useState<Array<{ id: string; full_name: string; has_calendar?: boolean }>>([])
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([])

  // Step 4
  const [emailSent, setEmailSent] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  /** Shown on read-only submitted view (upload UI is only in the Briefing step before submit). */
  const [readOnlyPhotos, setReadOnlyPhotos] = useState<
    Array<{ id: string; filename: string; url: string | null }>
  >([])

  const needsBriefing = outcome === 'approved' || outcome === 'follow_up'
  const needsCloseSchedule = outcome === 'approved'
  const uploadedPhotoCount = photos.filter((p) => p.storagePath && !p.uploading).length
  const photosReady = uploadedPhotoCount >= MIN_PHOTOS

  const handlePhotosChange = useCallback((updated: UploadedPhoto[]) => {
    setPhotos(updated)
  }, [])

  useEffect(() => {
    async function load() {
      try {
        const [resultRes, apptRes, canvassRes] = await Promise.all([
          fetch(`/api/opportunities/${opportunityId}/inspection-result`),
          fetch('/api/admin/appointment-types'),
          fetch('/api/canvass/data'),
        ])

        if (resultRes.ok) {
          const { result } = await resultRes.json()
          if (result) {
            setExisting(result)
            setEmailSent(!!result.briefing_email_sent_at)
            // Only treat as submitted when submitted_at is explicitly set by a final submit —
            // intermediate patches (close_appointment_id link) do not stamp submitted_at.
            const isSubmitted = !!result.submitted_at
            setSubmitted(isSubmitted)

            if (!isSubmitted) {
              setReadOnlyPhotos([])
              // Hydrate existing photos so a page refresh doesn't clear upload state
              const photosRes = await fetch(`/api/opportunities/${opportunityId}/inspection-photos`)
              if (photosRes.ok) {
                const { photos: existingPhotos } = await photosRes.json()
                if (existingPhotos?.length) {
                  setPhotos(
                    existingPhotos.map((p: { id: string; filename: string; url: string | null; storage_path: string }) => ({
                      id: p.id,
                      filename: p.filename,
                      previewUrl: p.url ?? '',
                      storagePath: p.storage_path,
                      uploading: false,
                    }))
                  )
                }
              }
            } else if (result.outcome === 'approved' || result.outcome === 'follow_up') {
              setPhotos([])
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
            } else {
              setReadOnlyPhotos([])
            }
          } else {
            setExisting(null)
            setSubmitted(false)
            setReadOnlyPhotos([])
            setPhotos([])
          }
        }

        if (apptRes.ok) {
          const apptData = await apptRes.json()
          const rows: any[] = apptData.appointmentTypes || []
          const closeRow = rows.find(
            (r: any) => r.category === 'close' && r.active !== false &&
              (r.name?.toLowerCase() === 'close' || r.name?.toLowerCase().includes('close'))
          ) || rows.find((r: any) => r.category === 'close' && r.active !== false)
          if (closeRow) setCloseDurationMinutes(closeRow.duration_minutes || 60)
        }

        if (canvassRes.ok) {
          const cd = await canvassRes.json()
          setUsers(cd.users || [])
          setTeams(cd.teams || [])
        }
      } catch (err) {
        console.error('InspectionResultForm load error:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [opportunityId])

  if (!ROLES_CAN_SUBMIT.has(currentUserRole)) return null

  if (loading) {
    return (
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Inspection Result</h2>
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  // Read-only view after submission
  if (existing && existing.submitted_at) {
    return (
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Inspection Result</h2>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${OUTCOME_COLORS[existing.outcome] || 'bg-gray-100 text-gray-700'}`}>
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
                  <p className="text-sm font-medium text-gray-800 mb-2">Inspection photos ({readOnlyPhotos.length})</p>
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
                  <Detail label="Urgency" value={existing.urgency_level.charAt(0).toUpperCase() + existing.urgency_level.slice(1)} />
                )}
                {existing.notes && <Detail label="Notes" value={existing.notes} className="col-span-full" />}
              </div>
            </>
          )}

          <div className="flex items-center gap-4 text-xs text-gray-500">
            {existing.close_appointment_id && (
              <span className="text-green-600 font-medium">✓ Close appointment scheduled</span>
            )}
            {existing.briefing_email_sent_at
              ? <span className="text-green-600 font-medium">✓ Briefing email sent</span>
              : <span className="text-gray-400">Briefing email not sent</span>
            }
          </div>
        </div>
      </div>
    )
  }

  // Step progress labels
  const steps = [
    'Outcome',
    ...(needsBriefing ? ['Briefing'] : []),
    ...(needsCloseSchedule ? ['Schedule Close'] : []),
    'Submit',
  ]
  // Map visual step index to current step state
  const currentStepIndex = (() => {
    if (step === 1) return 0
    if (step === 2 && needsBriefing) return 1
    if (step === 3 && needsCloseSchedule) return needsBriefing ? 2 : 1
    return steps.length - 1
  })()

  async function saveAndAdvance(sendEmail = false) {
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = { outcome, send_email: sendEmail, final_submit: true }
      if (needsBriefing) {
        payload.both_dms_present = bothDMs
        payload.absent_dm_name = absentDMName || null
        payload.damage_found = damageFound || null
        payload.roof_slopes = roofSlopes || null
        payload.homeowner_emotional_state = homeownerMood || null
        payload.consequence_questions_asked = consequenceQs
        payload.insurance_mentioned = insuranceMentioned
        payload.urgency_level = urgencyLevel || null
        payload.notes = notes || null
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

      const { result } = await res.json()
      setExisting(result)
      if (sendEmail) setEmailSent(true)
      setSubmitted(true)
    } catch {
      setError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  async function handleScheduleClose(confirm: CloseScheduleConfirm) {
    if (!inspectionAppointmentId) {
      setScheduleError('No inspection appointment found — cannot schedule close.')
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

      // Intermediate patch — links close_appointment_id only; no final_submit flag
      // so submitted_at is not stamped and the form stays editable.
      if (closeData.close_appointment_id) {
        await fetch(`/api/opportunities/${opportunityId}/inspection-result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outcome,
            close_appointment_id: closeData.close_appointment_id,
          }),
        })
      }

      setCloseScheduled(true)
      setShowModal(false)
      setStep(4)
    } catch {
      setScheduleError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  function buildBriefingNotes(): string {
    const lines: string[] = [`Outcome: ${OUTCOME_LABELS[outcome] ?? outcome}`]
    if (needsBriefing) {
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
    }
    return lines.join('\n')
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

  return (
    <div className="bg-white shadow rounded-lg p-6 mb-6">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Inspection Result</h2>

      {/* Step progress */}
      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2 flex-shrink-0">
            <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold border-2 ${
              i < currentStepIndex
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : i === currentStepIndex
                ? 'border-indigo-600 text-indigo-600'
                : 'border-gray-300 text-gray-400'
            }`}>
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
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Step 1: Outcome ── */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-gray-700 mb-3">What was the inspection outcome?</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Object.entries(OUTCOME_LABELS).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setOutcome(value)}
                className={`p-3 rounded-lg border-2 text-sm font-medium text-left transition-colors ${
                  outcome === value
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex justify-end pt-2">
            <button
              type="button"
              disabled={!outcome}
              onClick={() => {
                if (needsBriefing) setStep(2)
                else setStep(4)
              }}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Briefing ── */}
      {step === 2 && needsBriefing && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${OUTCOME_COLORS[outcome]}`}>
              {OUTCOME_LABELS[outcome]}
            </span>
          </div>

          <p className="text-xs text-gray-500 -mt-2 mb-1">
            Upload at least {MIN_PHOTOS} inspection photos here (no separate window — use Add photos below).
          </p>

          <PhotoUploadSection
            opportunityId={opportunityId}
            photos={photos}
            onPhotosChange={handlePhotosChange}
          />

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
              placeholder="e.g. Missing shingles on south face, hail damage throughout, damaged flashing at chimney"
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
              placeholder="e.g. 6/12 main, 8/12 south face, 4/12 garage"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Homeowner's Emotional State <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={homeownerMood}
              onChange={(e) => setHomeownerMood(e.target.value)}
              placeholder="e.g. excited, skeptical, stressed, cooperative"
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
              placeholder="Any other details the closer should know"
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => setStep(1)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              ← Back
            </button>
            <button
              type="button"
              onClick={() => {
                const validationError = validateBriefing()
                if (validationError) { setError(validationError); return }
                setError(null)
                setStep(needsCloseSchedule ? 3 : 4)
              }}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Schedule Close ── */}
      {step === 3 && needsCloseSchedule && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Schedule the close appointment. Briefing notes and photo count will be added to the calendar event.
          </p>

          {scheduleError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {scheduleError}
            </div>
          )}

          {!inspectionAppointmentId && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              No inspection appointment linked to this opportunity. You can skip and submit without scheduling.
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
              Schedule Close Appointment
            </button>
          )}

          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => setStep(2)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              ← Back
            </button>
            <button
              type="button"
              onClick={() => setStep(4)}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700"
            >
              {closeScheduled ? 'Next' : 'Skip & Continue →'}
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

      {/* ── Step 4: Submit ── */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="p-4 bg-gray-50 border rounded-lg text-sm space-y-1">
            <p className="font-semibold text-gray-800 mb-2">Ready to submit</p>
            <p>
              <span className="text-gray-500">Outcome: </span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${OUTCOME_COLORS[outcome]}`}>
                {OUTCOME_LABELS[outcome]}
              </span>
            </p>
            {needsBriefing && (
              <p className="text-gray-500 text-xs">
                Briefing complete — {uploadedPhotoCount} photo{uploadedPhotoCount !== 1 ? 's' : ''} uploaded
              </p>
            )}
            {closeScheduled && (
              <p className="text-green-600 text-xs font-medium">✓ Close appointment scheduled</p>
            )}
          </div>

          {submitted ? (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 font-medium">
              ✓ Inspection result submitted.{emailSent ? ' Briefing email with photos sent to closer.' : ''}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => saveAndAdvance(true)}
                className="w-full py-3 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Submitting…' : 'Submit & Send Briefing Email'}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => saveAndAdvance(false)}
                className="w-full py-2 border border-gray-300 text-sm text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Submit Without Email
              </button>
            </div>
          )}

          {!submitted && (
            <button
              type="button"
              onClick={() => {
                if (needsCloseSchedule) setStep(3)
                else if (needsBriefing) setStep(2)
                else setStep(1)
              }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              ← Back
            </button>
          )}
        </div>
      )}
    </div>
  )
}
