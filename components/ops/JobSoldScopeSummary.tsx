'use client'

import Link from 'next/link'

export type JobSoldScopeLineItem = {
  id: string
  name: string
  description: string | null
  category: string
  quantity: number
  unit: string
  unit_price: number
  line_total: number
  is_adder: boolean
}

export type JobSoldScopeRoofMeasureLf = {
  source: string | null
  ridges_lf: number | null
  valleys_lf: number | null
  hips_lf: number | null
  eaves_lf: number | null
  rakes_lf: number | null
  flashing_lf: number | null
  step_flashing_lf: number | null
  wall_flashing_lf: number | null
}

export type JobSoldScope = {
  total_squares: number | null
  total_squares_source: 'proposal_enriched' | 'project_legacy' | null
  measured_squares: number | null
  waste_percent: number | null
  /** Fallback when proposal has no waste — roof_measurements.suggested_waste_percent */
  measure_suggested_waste_percent?: number | null
  source: 'proposal' | 'project_legacy' | null
  proposal_id: string | null
  proposal_number: string | null
  line_items: JobSoldScopeLineItem[]
  roof_measurement_linear: JobSoldScopeRoofMeasureLf | null
}

const SOLD_SCOPE_LINE_PREVIEW = 14

function safeLines(scope: JobSoldScope): JobSoldScopeLineItem[] {
  return Array.isArray(scope.line_items) ? scope.line_items : []
}

export default function JobSoldScopeSummary({
  scope,
  showSquareMetrics,
  variant,
}: {
  scope: JobSoldScope
  showSquareMetrics: boolean
  variant: 'header' | 'materials'
}) {
  const proposalHref = scope.proposal_id ? `/proposals/${scope.proposal_id}` : null
  const lines = safeLines(scope)
  const overflow = Math.max(0, lines.length - SOLD_SCOPE_LINE_PREVIEW)
  const showLines = variant === 'header' ? lines.slice(0, SOLD_SCOPE_LINE_PREVIEW) : []
  const lineCount = lines.length

  const measureWaste =
    scope.measure_suggested_waste_percent != null && scope.measure_suggested_waste_percent > 0
      ? scope.measure_suggested_waste_percent
      : null

  const hasSquareBlock =
    showSquareMetrics &&
    ((scope.total_squares != null && scope.total_squares > 0) ||
      (scope.measured_squares != null && scope.measured_squares > 0) ||
      (scope.waste_percent != null && scope.waste_percent > 0) ||
      measureWaste != null ||
      scope.total_squares_source === 'project_legacy')

  const materialsLineItemsOnly =
    variant === 'materials' &&
    lineCount > 0 &&
    !hasSquareBlock &&
    Boolean(proposalHref)

  const hideEntirely =
    variant === 'header'
      ? !proposalHref && showLines.length === 0 && !hasSquareBlock
      : !hasSquareBlock && !materialsLineItemsOnly

  if (hideEntirely) {
    return null
  }

  const wrapperClass =
    variant === 'header'
      ? 'mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5'
      : 'mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5'

  return (
    <div className={wrapperClass}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-sky-800">
          {variant === 'materials' ? 'Use for materials' : 'Sold scope'}
        </span>
        {proposalHref && (
          <Link
            href={proposalHref}
            className="text-xs font-medium text-sky-900 underline hover:text-sky-950 shrink-0"
          >
            {scope.proposal_number ? `Proposal ${scope.proposal_number}` : 'View proposal'}
          </Link>
        )}
      </div>

      {hasSquareBlock &&
        scope.total_squares != null &&
        scope.total_squares > 0 &&
        Number.isFinite(Number(scope.total_squares)) && (
          <div className="text-sm text-sky-950 mt-0.5">
            <span className="text-xs font-normal text-sky-800">Total squares with waste: </span>
            <span className="font-semibold tabular-nums">{Number(scope.total_squares).toFixed(1)} sq</span>
          </div>
        )}

      {hasSquareBlock &&
        (() => {
          const proposalWaste =
            scope.waste_percent != null &&
            scope.waste_percent > 0 &&
            Number.isFinite(Number(scope.waste_percent))
              ? Number(scope.waste_percent)
              : null
          const hasMeasuredOrWaste =
            (scope.measured_squares != null && scope.measured_squares > 0) ||
            proposalWaste != null ||
            measureWaste != null
          if (hasMeasuredOrWaste) {
            const measuredPart =
              scope.measured_squares != null &&
              scope.measured_squares > 0 &&
              Number.isFinite(Number(scope.measured_squares))
                ? `${Number(scope.measured_squares).toFixed(1)} measured squares`
                : 'Measured squares unavailable'
            const wastePart =
              proposalWaste != null
                ? `${proposalWaste.toFixed(1)}% waste from proposal design`
                : measureWaste != null
                  ? `${measureWaste.toFixed(1)}% waste (measure estimate)`
                  : ''
            return (
              <div className="text-[11px] text-sky-800 mt-1 leading-snug">
                {wastePart ? `${measuredPart} + ${wastePart}` : measuredPart}
              </div>
            )
          }
          if (scope.total_squares_source === 'project_legacy') {
            return (
              <div className="text-[11px] text-sky-800 mt-0.5">
                Squares stored on the project (not from a linked proposal).
              </div>
            )
          }
          return null
        })()}

      {variant === 'materials' && materialsLineItemsOnly && proposalHref && (
        <p className="text-[11px] text-sky-900 mt-1">
          {lineCount} line item{lineCount === 1 ? '' : 's'} on proposal —{' '}
          <Link href={proposalHref} className="font-medium underline">
            open proposal
          </Link>
          .
        </p>
      )}

      {variant === 'header' && showLines.length > 0 && (
        <>
          <p className="text-[11px] text-sky-800/90 mt-2 border-t border-sky-200/80 pt-2">
            Line items from the accepted proposal — full detail and packet tools live under{' '}
            <span className="font-medium text-sky-900">Details</span>.
          </p>
          <ul className="mt-1.5 space-y-1 text-[11px] text-sky-950">
            {showLines.map((row, idx) => (
              <li key={row.id || `line-${idx}`} className="flex gap-2 justify-between min-w-0">
                <span className="min-w-0 truncate" title={row.description || row.name || ''}>
                  <span className="font-medium">{row.name || 'Item'}</span>
                  {Number(row.quantity) > 0 && (
                    <span className="text-sky-800 font-normal">
                      {' '}
                      · {row.quantity}
                      {row.unit ? ` ${row.unit}` : ''}
                    </span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums">
                  {(Number.isFinite(Number(row.line_total)) ? Number(row.line_total) : 0).toLocaleString('en-US', {
                    style: 'currency',
                    currency: 'USD',
                  })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {variant === 'header' && overflow > 0 && proposalHref && (
        <Link href={proposalHref} className="mt-1.5 inline-block text-[11px] font-medium text-sky-900 underline">
          +{overflow} more on proposal
        </Link>
      )}
      {variant === 'header' && overflow > 0 && !proposalHref && (
        <p className="mt-1.5 text-[11px] text-sky-800">+{overflow} more line items</p>
      )}
    </div>
  )
}
