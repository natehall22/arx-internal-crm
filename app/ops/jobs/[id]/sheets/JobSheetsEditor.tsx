'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import MaterialsOrderCard from '@/components/ops/MaterialsOrderCard'
import {
  RUN_SHEET_FIELD_KEYS,
  type ClientJobRunSheet,
  type RunSheetFieldKey,
} from '@/lib/job-run-sheet'
import type { JobSignedContract } from '@/lib/job-contract'
import type { JobSoldScope } from '@/lib/job-sold-scope'
import type { MaterialsCoverageOverrides } from '@/lib/materials-coverage-overrides'
import { MATERIAL_ORDER_UPDATED_EVENT } from '@/lib/materials-order-overrides'

/**
 * The one place ops edits a job's paperwork. Both one-page PDFs — the crew run sheet and the
 * supplier order sheet — are built from the same assembly (lib/job-run-sheet.ts), so they are
 * edited together here rather than on two pages that each only showed half the picture.
 */

/** PDF accents, so the preview tab reads as the same object as the paper. */
const CREW_ACCENT = '#e6007a'
const SUPPLIER_ACCENT = '#7000e0'
/** Neutral, so "Edited by ops" and Save don't read as belonging to one sheet. */
const ACCENT = '#2b0a3d'

/** Text fields the supplier sheet also prints (see materialOrderFromRunSheet). */
const PRINTS_ON_SUPPLIER: ReadonlySet<RunSheetFieldKey> = new Set<RunSheetFieldKey>(['materials_and_products', 'accessories'])

type Preview = 'crew' | 'supplier'

type Props = {
  initialSheet: ClientJobRunSheet
  canEdit: boolean
  /** Null when the job has no measurement or sold scope — nothing to order yet. */
  scope: JobSoldScope | null
  coverage: MaterialsCoverageOverrides
  /** Roofing jobs only, same gate as the job page's order list. */
  showOrder: boolean
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

export default function JobSheetsEditor({ initialSheet, canEdit, scope, coverage, showOrder }: Props) {
  const [sheet, setSheet] = useState(initialSheet)
  const [drafts, setDrafts] = useState<Drafts>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Bumped after every save so the embedded PDF re-fetches instead of showing a stale render. */
  const [previewKey, setPreviewKey] = useState(0)

  const [preview, setPreview] = useState<Preview>('crew')

  const crewPdfUrl = `/api/ops/jobs/${sheet.jobId}/run-sheet/pdf`
  const supplierPdfUrl = `/api/ops/jobs/${sheet.jobId}/material-order/pdf`
  const previewUrl = `${preview === 'crew' ? crewPdfUrl : supplierPdfUrl}?v=${previewKey}#toolbar=0&navpanes=0`

  // Quantity saves come from MaterialsOrderCard; refresh whichever sheet is showing.
  useEffect(() => {
    const onUpdated = (e: Event) => {
      if ((e as CustomEvent<{ jobId?: string }>).detail?.jobId === sheet.jobId) setPreviewKey((k) => k + 1)
    }
    window.addEventListener(MATERIAL_ORDER_UPDATED_EVENT, onUpdated)
    return () => window.removeEventListener(MATERIAL_ORDER_UPDATED_EVENT, onUpdated)
  }, [sheet.jobId])

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
      <div className="bg-[#2b0a3d] text-white">
        <div className="mx-auto max-w-[1400px] px-6 py-5">
          <Link
            href={`/ops/jobs/${sheet.jobId}`}
            className="text-sm font-medium text-white/90 underline-offset-2 hover:underline"
          >
            ← Back to job {sheet.jobNumber}
          </Link>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Job sheets</h1>
              <p className="text-sm text-white/90">{sheet.address}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SheetButtons label="Crew run sheet" pdfUrl={crewPdfUrl} color={CREW_ACCENT} />
              {showOrder && (
                <SheetButtons label="Supplier order sheet" pdfUrl={supplierPdfUrl} color={SUPPLIER_ACCENT} />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Editor */}
          <div>
            <div className="mb-4 rounded-lg border border-[#d6d4ce] bg-white p-4">
              <h2 className="text-base font-semibold text-[#2c2c2a]">Edit both sheets here</h2>
              <p className="mt-1 text-sm text-[#2c2c2a]">
                Each box fills in from the job. Change it here and only the printed sheet changes —
                the job stays as it is. <span className="font-medium">Reset</span> puts a box back to
                what the job says. Order quantities are further down.
              </p>
              {!canEdit && (
                <p className="mt-2 rounded-md bg-[#fff4d6] px-3 py-2 text-sm text-[#2c2c2a]">
                  You can view and print this sheet, but you do not have permission to edit it.
                </p>
              )}
            </div>

            <SignedContractPanel contracts={sheet.signedContracts} />

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
                      <PrintsOn crew supplier={PRINTS_ON_SUPPLIER.has(key)} />
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
                          Reset
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
                          : 'Nothing on the job for this — type it in if the crew needs it.'
                      }
                      className="w-full rounded-md border border-[#c9c7c0] px-3 py-2 text-sm text-[#2c2c2a] placeholder:text-[#8a8a82] focus:border-[#2b0a3d] focus:outline-none focus:ring-1 focus:ring-[#2b0a3d] disabled:bg-[#f2f1ee]"
                    />
                    {field.edited && field.computed && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-[#57574f]">
                          Show what the job says
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
                <span className="text-xs text-[#2c2c2a]">
                  {/* There is no Edit button — the boxes are the editor. Say so, or a greyed
                      "Saved" reads as "this page is read-only". */}
                  {dirtyKeys.length === 0 && (
                    <span className="block font-semibold">Tap any box above to edit it.</span>
                  )}
                  {sheet.overridesUpdatedAt
                    ? `Last edited ${new Date(sheet.overridesUpdatedAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}`
                    : 'No edits yet — this is straight from the job.'}
                </span>
              </div>
            )}
            {showOrder && (
              <div className="mt-8">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-[#2c2c2a]">Order quantities</h2>
                  <PrintsOn supplier />
                </div>
                {scope ? (
                  <MaterialsOrderCard
                    scope={scope}
                    jobId={sheet.jobId}
                    coverageOverrides={coverage}
                    showSheetLink={false}
                  />
                ) : (
                  <p className="rounded-lg border border-[#d6d4ce] bg-white p-4 text-sm text-[#2c2c2a]">
                    No measurement or sold scope on this job yet, so there is nothing to order. Add a
                    roof measure to the job, then come back.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Live PDF preview — the actual artifact, not a lookalike. */}
          <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1" role="tablist" aria-label="Which sheet to preview">
                <PreviewTab active={preview === 'crew'} color={CREW_ACCENT} onClick={() => setPreview('crew')}>
                  Crew run sheet
                </PreviewTab>
                {showOrder && (
                  <PreviewTab
                    active={preview === 'supplier'}
                    color={SUPPLIER_ACCENT}
                    onClick={() => setPreview('supplier')}
                  >
                    Supplier order sheet
                  </PreviewTab>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPreviewKey((k) => k + 1)}
                className="text-xs font-medium text-[#57574f] underline underline-offset-2 hover:text-[#2c2c2a]"
              >
                Refresh
              </button>
            </div>
            <iframe
              key={`${preview}-${previewKey}`}
              src={previewUrl}
              title={`${preview === 'crew' ? 'Crew run sheet' : 'Supplier order sheet'} preview for job ${sheet.jobNumber}`}
              className="h-[900px] w-full rounded-lg border border-[#d6d4ce] bg-white lg:h-[calc(100%-2rem)]"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function SheetButtons({ label, pdfUrl, color }: { label: string; pdfUrl: string; color: string }) {
  return (
    <div className="flex items-center gap-1 rounded-lg p-1" style={{ backgroundColor: color }}>
      <span className="px-2 text-xs font-bold uppercase tracking-wide text-white">{label}</span>
      <a
        href={pdfUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md bg-[#fff100] px-3 py-1.5 text-sm font-extrabold uppercase tracking-wide text-[#2c2c2a] hover:bg-[#ffe600]"
      >
        Open / Print
      </a>
      <a
        href={`${pdfUrl}?download=1`}
        className="rounded-md border border-white/70 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/10"
      >
        Download
      </a>
    </div>
  )
}

function PrintsOn({ crew = false, supplier = false }: { crew?: boolean; supplier?: boolean }) {
  return (
    <>
      {crew && (
        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: CREW_ACCENT }}>
          Crew
        </span>
      )}
      {supplier && (
        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: SUPPLIER_ACCENT }}>
          Supplier
        </span>
      )}
    </>
  )
}

function PreviewTab({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean
  color: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="rounded-md px-3 py-1.5 text-sm font-semibold"
      style={active ? { backgroundColor: color, color: '#fff' } : { color: '#2c2c2a', backgroundColor: '#e9e7e2' }}
    >
      {children}
    </button>
  )
}

/**
 * What the customer signed, beside the boxes, so ops copies from it instead of hunting for the
 * contract. Reference only: the notes routinely carry deductibles and payment terms, so nothing
 * here prints unless someone types it into a box.
 */
function SignedContractPanel({ contracts }: { contracts: JobSignedContract[] }) {
  if (contracts.length === 0) {
    return (
      <p className="mb-4 rounded-lg border border-[#d6d4ce] bg-white p-4 text-sm text-[#2c2c2a]">
        No signed contract found for this job.
      </p>
    )
  }

  return (
    <details open className="mb-4 rounded-lg border border-[#d6d4ce] bg-white p-4">
      <summary className="cursor-pointer text-base font-semibold text-[#2c2c2a]">
        From the signed contract
      </summary>
      <p className="mt-1 text-sm text-[#2c2c2a]">
        For reference — this does not print. Copy anything the crew or supplier needs into a box
        below. The product and extra items already fill in when the job has nothing better.
      </p>
      {contracts.map((c) => (
        <div key={c.id} className="mt-3 border-t border-[#e9e7e2] pt-3 text-sm text-[#2c2c2a]">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold">
              {c.agreementType === 'repair' ? 'Repair agreement' : 'Installation agreement'}
              {c.signedAt
                ? ` · signed ${new Date(c.signedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}`
                : ''}
            </span>
            {c.pdfUrl && (
              <a
                href={c.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-[#3d0080] underline underline-offset-2"
              >
                Open contract PDF
              </a>
            )}
          </div>
          <dl className="space-y-2">
            <ContractLine label="Product" value={c.roofingMaterial} />
            <ContractLine label="Other scope" value={c.scopeOther} />
            <ContractLine label="Additional products" value={c.additionalProducts} />
            <ContractLine label="Exclusions" value={c.exclusions} />
          </dl>
          {/* Collapsed: notes run to thousands of characters and would bury the boxes below. */}
          {c.notes && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[#2c2c2a]">
                Notes (may include payment terms)
              </summary>
              <p className="mt-1 whitespace-pre-wrap">{c.notes}</p>
            </details>
          )}
        </div>
      ))}
    </details>
  )
}

function ContractLine({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-[#2c2c2a]">{label}</dt>
      <dd className="whitespace-pre-wrap">{value}</dd>
    </div>
  )
}
