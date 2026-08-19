'use client'

import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'

import {
  RUN_SHEET_FIELD_KEYS,
  type JobRunSheetData,
  type RunSheetFieldKey,
} from '@/lib/job-run-sheet'

/** Matches the PDF accent so the on-screen sheet and the printed one read as the same object. */
const ACCENT = '#e6007a'

type Props = {
  initialSheet: JobRunSheetData
  canEdit: boolean
}

type Drafts = Partial<Record<RunSheetFieldKey, string>>

const MULTILINE_ROWS: Record<RunSheetFieldKey, number> = {
  schedule_note: 2,
  scope_of_work: 3,
  materials_and_products: 3,
  tear_off_and_decking: 2,
  accessories: 3,
  add_ons_sold: 4,
  heads_up: 8,
}

export default function RunSheetEditor({ initialSheet, canEdit }: Props) {
  const [sheet, setSheet] = useState(initialSheet)
  const [drafts, setDrafts] = useState<Drafts>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Bumped after every save so the embedded PDF re-fetches instead of showing a stale render. */
  const [previewKey, setPreviewKey] = useState(0)

  const pdfUrl = `/api/ops/jobs/${sheet.jobId}/run-sheet/pdf`
  const previewUrl = `${pdfUrl}?v=${previewKey}#toolbar=0&navpanes=0`

  const dirtyKeys = useMemo(
    () =>
      RUN_SHEET_FIELD_KEYS.filter((key) => {
        const draft = drafts[key]
        if (draft === undefined) return false
        return draft.trim() !== (sheet.fields[key].value ?? '').trim()
      }),
    [drafts, sheet]
  )

  const valueFor = useCallback(
    (key: RunSheetFieldKey) => drafts[key] ?? sheet.fields[key].value ?? '',
    [drafts, sheet]
  )

  const applyPatch = useCallback(
    async (patch: Partial<Record<RunSheetFieldKey, string | null>>, clearKeys: RunSheetFieldKey[]) => {
      setSaving(true)
      setError(null)
      try {
        const res = await fetch(`/api/ops/jobs/${sheet.jobId}/run-sheet`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error || 'Save failed')

        setSheet(json.sheet)
        setDrafts((prev) => {
          const next = { ...prev }
          for (const key of clearKeys) delete next[key]
          return next
        })
        setPreviewKey((k) => k + 1)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed')
      } finally {
        setSaving(false)
      }
    },
    [sheet.jobId]
  )

  const handleSave = useCallback(() => {
    if (dirtyKeys.length === 0) return
    const patch: Partial<Record<RunSheetFieldKey, string | null>> = {}
    for (const key of dirtyKeys) {
      const draft = (drafts[key] ?? '').trim()
      patch[key] = draft === '' ? null : draft
    }
    void applyPatch(patch, dirtyKeys)
  }, [dirtyKeys, drafts, applyPatch])

  const handleReset = useCallback(
    (key: RunSheetFieldKey) => {
      void applyPatch({ [key]: null }, [key])
    },
    [applyPatch]
  )

  return (
    <div className="min-h-screen bg-[#f6f5f2]">
      {/* Loud header — this page should never be mistaken for the normal job tabs. */}
      <div style={{ backgroundColor: ACCENT }} className="text-white">
        <div className="mx-auto max-w-[1400px] px-6 py-5">
          <Link
            href={`/ops/jobs/${sheet.jobId}`}
            className="text-sm font-medium text-white/90 underline-offset-2 hover:underline"
          >
            ← Back to job {sheet.jobNumber}
          </Link>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Job Run Sheet</h1>
              <p className="text-sm text-white/90">{sheet.address}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-[#fff100] px-4 py-2 text-sm font-extrabold uppercase tracking-wide text-[#c40068] hover:bg-[#ffe600]"
              >
                Open / Print PDF
              </a>
              <a
                href={`${pdfUrl}?download=1`}
                className="rounded-lg border border-white/70 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
              >
                Download to email
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Editor */}
          <div>
            <div className="mb-4 rounded-lg border border-[#d6d4ce] bg-white p-4">
              <h2 className="text-base font-semibold text-[#2c2c2a]">Edit the sheet</h2>
              <p className="mt-1 text-sm text-[#57574f]">
                Every box below is pre-filled from the CRM. Type over anything that needs to change
                for this job — your edit is what prints. Clear a box (or hit{' '}
                <span className="font-medium">Reset</span>) to go back to the CRM value.
              </p>
              {!canEdit && (
                <p className="mt-2 rounded-md bg-[#fff4d6] px-3 py-2 text-sm text-[#2c2c2a]">
                  You can view and print this sheet, but you do not have permission to edit it.
                </p>
              )}
            </div>

            <div className="space-y-4">
              {RUN_SHEET_FIELD_KEYS.map((key) => {
                const field = sheet.fields[key]
                const isDirty = dirtyKeys.includes(key)
                return (
                  <div key={key} className="rounded-lg border border-[#d6d4ce] bg-white p-4">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <label
                        htmlFor={`run-sheet-${key}`}
                        className="text-sm font-semibold text-[#2c2c2a]"
                      >
                        {field.label}
                      </label>
                      {field.edited && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
                          style={{ backgroundColor: ACCENT }}
                        >
                          Edited by ops
                        </span>
                      )}
                      {isDirty && (
                        <span className="rounded-full bg-[#fff4d6] px-2 py-0.5 text-[11px] font-semibold text-[#7a5b00]">
                          Unsaved
                        </span>
                      )}
                      {field.edited && canEdit && (
                        <button
                          type="button"
                          onClick={() => handleReset(key)}
                          disabled={saving}
                          className="ml-auto text-xs font-medium text-[#57574f] underline underline-offset-2 hover:text-[#2c2c2a] disabled:opacity-50"
                        >
                          Reset to CRM value
                        </button>
                      )}
                    </div>
                    <p className="mb-2 text-xs text-[#6b6b66]">{field.source}</p>
                    <textarea
                      id={`run-sheet-${key}`}
                      rows={MULTILINE_ROWS[key]}
                      disabled={!canEdit || saving}
                      value={valueFor(key)}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder={
                        field.computed
                          ? undefined
                          : 'Nothing in the CRM for this — type it in if the crew needs it.'
                      }
                      className="w-full rounded-md border border-[#c9c7c0] px-3 py-2 text-sm text-[#2c2c2a] placeholder:text-[#8a8a82] focus:border-[#e6007a] focus:outline-none focus:ring-1 focus:ring-[#e6007a] disabled:bg-[#f2f1ee]"
                    />
                    {field.edited && field.computed && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-[#57574f]">
                          Show the CRM value you replaced
                        </summary>
                        <pre className="mt-1 whitespace-pre-wrap rounded bg-[#f2f1ee] p-2 text-xs text-[#2c2c2a]">
                          {field.computed}
                        </pre>
                      </details>
                    )}
                  </div>
                )
              })}
            </div>

            {error && (
              <p className="mt-4 rounded-md bg-[#ffe5e5] px-3 py-2 text-sm text-[#8a1f1f]">{error}</p>
            )}

            {canEdit && (
              <div className="sticky bottom-4 mt-4 flex items-center gap-3 rounded-lg border border-[#d6d4ce] bg-white p-3 shadow-sm">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || dirtyKeys.length === 0}
                  className="rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  style={{ backgroundColor: ACCENT }}
                >
                  {saving
                    ? 'Saving…'
                    : dirtyKeys.length === 0
                      ? 'Saved'
                      : `Save ${dirtyKeys.length} change${dirtyKeys.length === 1 ? '' : 's'}`}
                </button>
                <span className="text-xs text-[#6b6b66]">
                  {sheet.overridesUpdatedAt
                    ? `Last edited ${new Date(sheet.overridesUpdatedAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}`
                    : 'No ops edits yet — the sheet is straight from the CRM.'}
                </span>
              </div>
            )}
          </div>

          {/* Live PDF preview — the actual artifact, not a lookalike. */}
          <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#2c2c2a]">Preview — this is what prints</h2>
              <button
                type="button"
                onClick={() => setPreviewKey((k) => k + 1)}
                className="text-xs font-medium text-[#57574f] underline underline-offset-2 hover:text-[#2c2c2a]"
              >
                Refresh
              </button>
            </div>
            <iframe
              key={previewKey}
              src={previewUrl}
              title={`Run sheet preview for job ${sheet.jobNumber}`}
              className="h-[900px] w-full rounded-lg border border-[#d6d4ce] bg-white lg:h-[calc(100%-2rem)]"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
