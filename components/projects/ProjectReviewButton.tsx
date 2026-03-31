'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  emptyProjectReviewAnswers,
  type ProjectReviewAnswers,
  type ProjectReviewStored,
} from '@/lib/project-review'

type Props = {
  projectId: string
  /** When set, a matching job note is created on submit */
  jobId: string | null
  initialReview: ProjectReviewStored | null
}

export default function ProjectReviewButton({ projectId, jobId, initialReview }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const parsed = initialReview
  const [answers, setAnswers] = useState<ProjectReviewAnswers>(() =>
    parsed?.answers ? { ...emptyProjectReviewAnswers(), ...parsed.answers } : emptyProjectReviewAnswers()
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (key: keyof ProjectReviewAnswers, value: string) => {
    setAnswers((a) => ({ ...a, [key]: value }))
  }

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Save failed')
        return
      }
      router.refresh()
      if (data.jobNoteSkippedReason) {
        setError(data.jobNoteSkippedReason)
        return
      }
      setOpen(false)
    } catch {
      setError('Network error — try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-white border border-indigo-600 text-indigo-700 hover:bg-indigo-50"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
          />
        </svg>
        Project review
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div
            className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col"
            role="dialog"
            aria-labelledby="project-review-title"
          >
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-start gap-4">
              <div>
                <h2 id="project-review-title" className="text-lg font-semibold text-gray-900">
                  Project review
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Capture what was sold and site realities so ops and install are aligned.
                  {jobId
                    ? ' This is saved to the project and posted as a note on the job.'
                    : ' This is saved to the project; when a job exists, it will also post to the job.'}
                </p>
                {parsed?.submittedAt && (
                  <p className="text-xs text-gray-400 mt-2">
                    Last submitted{' '}
                    {new Date(parsed.submittedAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4 text-sm">
              {error && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 text-sm">
                  {error}
                </div>
              )}

              <Field
                label="What was sold (scope)"
                hint="Contract line items, warranty tier, exclusions, change orders."
                value={answers.scopeSummary}
                onChange={(v) => update('scopeSummary', v)}
              />
              <Field
                label="Materials & products"
                hint="Shingle brand / line, color, underlayment, ventilation package."
                value={answers.materialsAndProducts}
                onChange={(v) => update('materialsAndProducts', v)}
              />
              <Field
                label="Tear-off, layers & decking"
                hint="Layers removed, decking repairs, rotten wood expectations."
                value={answers.tearOffAndDecking}
                onChange={(v) => update('tearOffAndDecking', v)}
              />
              <Field
                label="Accessories"
                hint="Gutters, drip edge, skylights, chimney, flashings."
                value={answers.accessories}
                onChange={(v) => update('accessories', v)}
              />
              <Field
                label="Site / access / safety"
                hint="Steep areas, two-story, tight lot, dogs, gate codes, parking."
                value={answers.siteConditions}
                onChange={(v) => update('siteConditions', v)}
              />
              <Field
                label="Permits & HOA"
                hint="Permit status, HOA approval, restrictions."
                value={answers.permitsAndHoa}
                onChange={(v) => update('permitsAndHoa', v)}
              />
              <Field
                label="Customer expectations"
                hint="What the homeowner was told about timeline, crew, cleanup."
                value={answers.customerExpectations}
                onChange={(v) => update('customerExpectations', v)}
              />
              <Field
                label="Financing"
                hint="Lender or in-house program, term, payment schedule, promos, and what the homeowner agreed to."
                value={answers.financing}
                onChange={(v) => update('financing', v)}
              />
              <Field
                label="Open questions / handoff"
                hint="Anything ops must resolve before or during install."
                value={answers.openItems}
                onChange={(v) => update('openItems', v)}
              />
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 bg-gray-50 rounded-b-xl">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save & hand off'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block font-medium text-gray-900">{label}</label>
      <p className="text-xs text-gray-500 mb-1">{hint}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
      />
    </div>
  )
}
