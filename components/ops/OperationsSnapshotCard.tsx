import type { ReactNode } from 'react'
import {
  parseProjectReviewStored,
  PROJECT_REVIEW_FIELD_LABELS,
  PROJECT_REVIEW_FIELD_ORDER,
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

export default function OperationsSnapshotCard({
  project,
  headerAction,
}: {
  project: SnapshotProject | null | undefined
  /** e.g. link to project or job */
  headerAction?: ReactNode
}) {
  if (!project || !hasOperationsSnapshotData(project)) return null

  const stored = parseProjectReviewStored(project.project_review)
  const structured = stored?.answers && hasAnyAnswerContent(stored.answers) ? stored.answers : null

  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
      <div className="flex justify-between items-center mb-4 gap-3">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900">Operations Snapshot</h2>
        {headerAction}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        {structured && stored && (
          <div className="md:col-span-2 space-y-4 pb-4 border-b border-gray-100">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">Project review (latest)</h3>
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    <span className="font-medium text-gray-500">{PROJECT_REVIEW_FIELD_LABELS[key]}</span>
                    <p className="mt-1 text-gray-900 whitespace-pre-wrap break-words">{text}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {!structured && project.scope_of_work?.trim() && (
          <div className="md:col-span-2">
            <span className="font-medium text-gray-500">Scope of Work</span>
            <p className="mt-1 text-gray-900 whitespace-pre-wrap break-words">{project.scope_of_work}</p>
          </div>
        )}
        {!structured && project.product_summary?.trim() && (
          <div>
            <span className="font-medium text-gray-500">Product</span>
            <p className="mt-1 text-gray-900 break-words">{project.product_summary}</p>
          </div>
        )}

        {project.permits_status?.trim() && (
          <div>
            <span className="font-medium text-gray-500">Permits (project)</span>
            <p className="mt-1 text-gray-900">{project.permits_status}</p>
          </div>
        )}
        {project.install_date && (
          <div>
            <span className="font-medium text-gray-500">Install Date (project)</span>
            <p className="mt-1 text-gray-900">
              {new Date(project.install_date).toLocaleDateString()}
            </p>
          </div>
        )}

        {project.ops_notes?.trim() && (
          <div className="md:col-span-2">
            <span className="font-medium text-gray-500">Ops notes (full history)</span>
            <p className="mt-1 text-gray-900 whitespace-pre-wrap break-words">{project.ops_notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}
