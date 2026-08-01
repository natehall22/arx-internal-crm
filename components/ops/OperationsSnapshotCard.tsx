'use client'

import { useState, type ReactNode } from 'react'
import {
  parseProjectReviewStored,
  PROJECT_REVIEW_FIELD_LABELS,
  PROJECT_REVIEW_FIELD_ORDER,
  stripLatestReviewBlockFromOpsNotes,
  type ProjectReviewAnswers,
} from '@/lib/project-review'

/**
 * Same layout as the project page "Operations Snapshot" — project review fields,
 * legacy scope/product, permits, install, and full ops notes history.
 */
export type SnapshotProject = {
  id?: string
  scope_of_work?: string | null
  product_summary?: string | null
  permits_status?: string | null
  install_date?: string | null
  ops_notes?: string | null
  project_review?: unknown
}

function hasAnyAnswerContent(answers: ProjectReviewAnswers | undefined): boolean {
  if (!answers) return false
  return PROJECT_REVIEW_FIELD_ORDER.some((k) => {
    const v = answers[k]
    return typeof v === 'string' && v.trim().length > 0
  })
}

export function hasOperationsSnapshotData(project: SnapshotProject | null | undefined): boolean {
  if (!project) return false
  const stored = parseProjectReviewStored(project.project_review)
  if (stored?.answers && hasAnyAnswerContent(stored.answers)) return true
  return !!(
    project.scope_of_work?.trim() ||
    project.product_summary?.trim() ||
    project.permits_status?.trim() ||
    project.install_date ||
    project.ops_notes?.trim()
  )
}

function buildCollapsedSummary(
  project: SnapshotProject,
  structured: ProjectReviewAnswers | null,
  submittedAt: string | null | undefined
): string {
  const parts: string[] = []
  if (structured) {
    const filled = PROJECT_REVIEW_FIELD_ORDER.filter((k) => structured[k]?.trim()).length
    parts.push(`Project review · ${filled} field${filled === 1 ? '' : 's'}`)
    if (submittedAt) {
      parts.push(
        new Date(submittedAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      )
    }
  } else {
    if (project.scope_of_work?.trim()) parts.push('Scope')
    if (project.product_summary?.trim()) parts.push('Product')
    if (project.permits_status?.trim()) parts.push('Permits')
    if (project.install_date) parts.push('Install date')
    if (project.ops_notes?.trim()) parts.push('Ops notes')
  }
  return parts.join(' · ')
}

export default function OperationsSnapshotCard({
  project,
  headerAction,
  defaultExpanded = false,
}: {
  project: SnapshotProject | null | undefined
  /** e.g. link to project or job */
  headerAction?: ReactNode
  /** Modal / deep-link contexts can start open; job page stays collapsed by default */
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  if (!project || !hasOperationsSnapshotData(project)) return null

  const stored = parseProjectReviewStored(project.project_review)
  const structured = stored?.answers && hasAnyAnswerContent(stored.answers) ? stored.answers : null

  const opsNotesForDisplay =
    structured && stored?.submittedAt
      ? stripLatestReviewBlockFromOpsNotes(project.ops_notes, stored.submittedAt)
      : project.ops_notes?.trim() || null

  const collapsedSummary = buildCollapsedSummary(project, structured, stored?.submittedAt)

  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left hover:bg-gray-50 -m-2 p-2"
        >
          <svg
            className={`mt-1 h-4 w-4 shrink-0 text-gray-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-[#2c2c2a]">Operations Snapshot</h2>
            {!expanded && collapsedSummary ? (
              <p className="mt-1 text-xs text-gray-600">{collapsedSummary}</p>
            ) : null}
          </div>
        </button>
        {headerAction ? <div className="shrink-0 pt-1">{headerAction}</div> : null}
      </div>

      {expanded ? (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {structured && stored && (
            <div className="md:col-span-2 space-y-4 pb-4 border-b border-gray-100">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-[#2c2c2a]">Project review (latest)</h3>
                {stored.submittedAt && (
                  <span className="text-xs text-gray-500">
                    Submitted{' '}
                    {new Date(stored.submittedAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                {PROJECT_REVIEW_FIELD_ORDER.map((key) => {
                  const text = structured[key]?.trim()
                  if (!text) return null
                  const fullWidth =
                    key === 'scopeSummary' ||
                    key === 'tearOffAndDecking' ||
                    key === 'siteConditions' ||
                    key === 'customerExpectations' ||
                    key === 'openItems'
                  return (
                    <div key={key} className={fullWidth ? 'md:col-span-2' : ''}>
                      <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                        {PROJECT_REVIEW_FIELD_LABELS[key]}
                      </span>
                      <p className="mt-1 text-sm text-[#2c2c2a] whitespace-pre-wrap break-words">{text}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {!structured && project.scope_of_work?.trim() && (
            <div className="md:col-span-2">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Scope of Work</span>
              <p className="mt-1 text-sm text-[#2c2c2a] whitespace-pre-wrap break-words">{project.scope_of_work}</p>
            </div>
          )}
          {!structured && project.product_summary?.trim() && (
            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Product</span>
              <p className="mt-1 text-sm text-[#2c2c2a] break-words">{project.product_summary}</p>
            </div>
          )}

          {project.permits_status?.trim() && (
            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Permits (project)</span>
              <p className="mt-1 text-sm text-[#2c2c2a]">{project.permits_status}</p>
            </div>
          )}
          {project.install_date && (
            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Install Date (project)</span>
              <p className="mt-1 text-sm text-[#2c2c2a]">
                {new Date(project.install_date).toLocaleDateString()}
              </p>
            </div>
          )}

          {opsNotesForDisplay && (
            <div className="md:col-span-2">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                {structured ? 'Earlier ops notes' : 'Ops notes (full history)'}
              </span>
              <p className="mt-1 text-sm text-[#2c2c2a] whitespace-pre-wrap break-words">{opsNotesForDisplay}</p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
