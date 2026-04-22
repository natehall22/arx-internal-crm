'use client'

import { memo } from 'react'
import { handoffPreviewForJobBoard } from '@/lib/project-review'
import { hasOperationsSnapshotData } from '@/components/ops/OperationsSnapshotCard'
import type { JobStatus, OpsBoardJob } from '@/lib/ops-board-types'

const priorityConfig: Record<string, { icon: string; color: string }> = {
  urgent: { icon: '🔴', color: 'text-red-600' },
  high: { icon: '🟠', color: 'text-orange-600' },
  normal: { icon: '', color: 'text-gray-600' },
}

function paymentStatusChip(job: OpsBoardJob): { label: string; className: string } | null {
  const saleCents = Math.round((job.sale_amount || 0) * 100)
  if (saleCents <= 0) return null
  const collected = job.collected_cents ?? 0
  if (collected >= saleCents) {
    return { label: 'Paid in full', className: 'bg-emerald-50 text-emerald-800 border border-emerald-200' }
  }
  if (collected > 0) {
    return { label: 'Partially paid', className: 'bg-amber-50 text-amber-800 border border-amber-200' }
  }
  return { label: 'Unpaid', className: 'bg-gray-50 text-gray-700 border border-gray-200' }
}

export interface OpsBoardJobCardProps {
  job: OpsBoardJob
  onNavigateToJob: (jobId: string) => void
  onOpenSnapshot: (job: OpsBoardJob) => void
  onSchedule: (job: OpsBoardJob, mode: 'schedule' | 'reassign') => void
  onStartMaterials: (jobId: string) => void
  onMarkOrdered: (jobId: string) => void
  onJobStatus: (jobId: string, status: JobStatus) => void
}

function OpsBoardJobCardInner({
  job,
  onNavigateToJob,
  onOpenSnapshot,
  onSchedule,
  onStartMaterials,
  onMarkOrdered,
  onJobStatus,
}: OpsBoardJobCardProps) {
  const priority = priorityConfig[job.priority] || priorityConfig.normal
  const handoffPreview = handoffPreviewForJobBoard(job.project ?? null)
  const hasOpsSnapshot = hasOperationsSnapshotData(job.project ?? null)
  const payChip = paymentStatusChip(job)
  const enrichedTotal =
    typeof job.sold_squares === 'number' && job.sold_squares > 0 ? job.sold_squares : null
  const projectLegacyTotal =
    job.project?.sold_roof_squares != null && Number(job.project.sold_roof_squares) > 0
      ? Number(job.project.sold_roof_squares)
      : null
  const displayTotal = enrichedTotal ?? projectLegacyTotal
  const roofSoldSquaresTotal = job.job_type === 'roofing' ? displayTotal : null
  const measuredSquares =
    typeof job.measured_squares === 'number' && job.measured_squares > 0 ? job.measured_squares : null
  const soldWastePercent =
    typeof job.sold_waste_percent === 'number' && job.sold_waste_percent > 0 ? job.sold_waste_percent : null
  const soldSquaresFromMeasure = job.sold_squares_from_measure === true
  // Ridge/valley/flashing LF from the measure tool: job page sold-scope header only, not board cards.

  const needsMaterials = job.materials_status === 'not_ordered'
  const needsCrew = job.scheduled_date && !job.assigned_crew && !job.assigned_sub
  const isPastDue =
    job.scheduled_date &&
    new Date(job.scheduled_date + 'T23:59:59') < new Date() &&
    job.status !== 'complete' &&
    job.status !== 'collected'

  return (
    <div
      className="bg-white rounded-lg border shadow-sm p-3.5 hover:shadow-md cursor-pointer [content-visibility:auto] [contain-intrinsic-size:auto_200px]"
      onClick={() => onNavigateToJob(job.id)}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {priority.icon && <span className="text-sm">{priority.icon}</span>}
          <span className="text-xs font-mono text-gray-400">{job.job_number}</span>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            job.job_type === 'roofing'
              ? 'bg-blue-100 text-blue-700'
              : job.job_type === 'siding'
                ? 'bg-green-100 text-green-700'
                : job.job_type === 'windows'
                  ? 'bg-purple-100 text-purple-700'
                  : 'bg-gray-100 text-gray-700'
          }`}
        >
          {job.job_type}
        </span>
      </div>

      <div className="mb-2.5">
        {job.customer?.name && <div className="font-semibold text-gray-900 truncate">{job.customer.name}</div>}
        <div className="text-xs text-gray-500 truncate">{job.address_text}</div>
      </div>

      {roofSoldSquaresTotal != null && (
        <div className="mb-2.5 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-sky-700">Sold Squares</div>
          <div className="text-sm font-semibold text-sky-900">{roofSoldSquaresTotal.toFixed(1)} sq</div>
          {(measuredSquares || soldWastePercent) && (
            <div className="text-[11px] text-sky-700">
              {measuredSquares ? `${measuredSquares.toFixed(1)} measured` : 'Measured unavailable'}
              {soldWastePercent ? ` + ${soldWastePercent.toFixed(1)}% waste` : ''}
            </div>
          )}
          {!measuredSquares && !soldWastePercent && soldSquaresFromMeasure && (
            <div className="text-[11px] text-sky-700">From measure</div>
          )}
          {!measuredSquares &&
            !soldWastePercent &&
            !soldSquaresFromMeasure &&
            enrichedTotal == null &&
            projectLegacyTotal != null && (
            <div className="text-[11px] text-sky-700">From project record</div>
          )}
        </div>
      )}

      {payChip && (
        <div className="mb-2.5">
          <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${payChip.className}`}>{payChip.label}</span>
        </div>
      )}

      {(needsMaterials || needsCrew || isPastDue) && (
        <div className="flex flex-wrap gap-1 mb-2.5">
          {isPastDue && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 font-medium">Overdue</span>
          )}
          {needsMaterials && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium">Materials needed</span>
          )}
          {needsCrew && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-700 font-medium">No crew</span>
          )}
        </div>
      )}

      {(handoffPreview || hasOpsSnapshot) && (
        <div className="mb-2.5 rounded-md border border-indigo-100 bg-indigo-50/80 px-2.5 py-2">
          {handoffPreview && <p className="text-xs text-gray-700 line-clamp-2 leading-snug">{handoffPreview}</p>}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenSnapshot(job)
            }}
            className={`text-xs font-medium text-indigo-700 hover:text-indigo-900 underline ${handoffPreview ? 'mt-1.5 block' : ''}`}
          >
            Operations snapshot
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {job.assigned_crew && (
            <span
              className="text-xs px-2 py-0.5 rounded-full truncate max-w-[120px]"
              style={{ backgroundColor: `${job.assigned_crew.color}20`, color: job.assigned_crew.color }}
            >
              {job.assigned_crew.name}
            </span>
          )}
          {job.assigned_sub && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 truncate max-w-[120px]">
              Sub: {job.assigned_sub.company_name}
            </span>
          )}
          {!job.assigned_crew && !job.assigned_sub && <span className="text-xs text-gray-400">No crew assigned</span>}
        </div>
        {job.sale_amount && (
          <span className="text-xs font-semibold text-gray-700 shrink-0 ml-2">${job.sale_amount.toLocaleString()}</span>
        )}
      </div>

      {job.scheduled_date && (
        <div className={`text-xs font-medium mb-2.5 ${isPastDue ? 'text-orange-600' : 'text-indigo-600'}`}>
          📅{' '}
          {new Date(job.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            timeZone: 'America/New_York',
          })}
          {isPastDue && ' · overdue'}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 pt-3 border-t" onClick={(e) => e.stopPropagation()}>
        {job.status === 'sold' && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onStartMaterials(job.id)
            }}
            className="flex-1 min-h-[38px] text-xs py-2 px-2 bg-amber-50 text-amber-700 rounded-lg font-medium hover:bg-amber-100 border border-amber-200"
          >
            Start Materials
          </button>
        )}
        {needsMaterials && job.status === 'materials' && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onMarkOrdered(job.id)
            }}
            className="flex-1 min-h-[38px] text-xs py-2 px-2 bg-red-50 text-red-700 rounded-lg font-medium hover:bg-red-100 border border-red-200"
          >
            Mark Ordered
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onSchedule(job, 'schedule')
          }}
          className="flex-1 min-h-[38px] text-xs py-2 px-2 bg-indigo-50 text-indigo-700 rounded-lg font-medium hover:bg-indigo-100 border border-indigo-200"
        >
          {job.scheduled_date ? 'Reschedule' : 'Schedule'}
        </button>
        {(job.scheduled_date || job.assigned_crew || job.assigned_sub) && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSchedule(job, 'reassign')
            }}
            className="flex-1 min-h-[38px] text-xs py-2 px-2 bg-white text-gray-800 rounded-lg font-medium hover:bg-gray-50 border border-gray-300"
          >
            Reassign
          </button>
        )}
        {job.status === 'scheduled' && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onJobStatus(job.id, 'in_progress')
            }}
            className="flex-1 min-h-[38px] text-xs py-2 px-2 bg-green-50 text-green-700 rounded-lg font-medium hover:bg-green-100 border border-green-200"
          >
            Start Job
          </button>
        )}
        {job.status === 'in_progress' && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onJobStatus(job.id, 'complete')
            }}
            className="flex-1 min-h-[38px] text-xs py-2 px-2 bg-green-50 text-green-700 rounded-lg font-medium hover:bg-green-100 border border-green-200"
          >
            Mark Complete
          </button>
        )}
      </div>
    </div>
  )
}

export const OpsBoardJobCard = memo(OpsBoardJobCardInner)
