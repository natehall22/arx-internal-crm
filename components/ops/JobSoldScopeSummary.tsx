'use client'

import Link from 'next/link'
import { hipRidgeCapFromLinearFt } from '@/lib/hip-ridge-cap-squares'
import { computeRoofSquaresEquation, formatSqPart } from '@/lib/roof-squares-equation'

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
  total_squares_source: 'proposal_enriched' | 'project_legacy' | 'roof_measure_total' | null
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

const ROOF_MEASURE_SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  in_house: 'ARX Measure',
  eagleview: 'EagleView',
  roofr: 'Roofr',
  solo: 'Solo',
  aurora: 'Aurora',
}

function safeLines(scope: JobSoldScope): JobSoldScopeLineItem[] {
  return Array.isArray(scope.line_items) ? scope.line_items : []
}

function safeLinear(scope: JobSoldScope): JobSoldScopeRoofMeasureLf | null {
  const m = scope.roof_measurement_linear
  if (!m || typeof m !== 'object') return null
  return m
}

function formatLf(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
}

function linearMeasureRows(linear: JobSoldScopeRoofMeasureLf): Array<{ label: string; value: number }> {
  const rows: Array<{ label: string; value: number }> = []
  const add = (label: string, value: number | null) => {
    if (value == null || value <= 0) return
    rows.push({ label, value })
  }

  add('Ridge', linear.ridges_lf)
  add('Valley', linear.valleys_lf)
  add('Hip', linear.hips_lf)
  add('Flashing', linear.flashing_lf)
  add('Step flashing', linear.step_flashing_lf)
  add('Wall flashing', linear.wall_flashing_lf)

  return rows
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

  const proposalWastePositive =
    scope.waste_percent != null &&
    scope.waste_percent > 0 &&
    Number.isFinite(Number(scope.waste_percent))

  const hasAnyWastePercent = proposalWastePositive || measureWaste != null

  const linear = safeLinear(scope)
  const hasRoofMeasureLinear =
    showSquareMetrics &&
    linear != null &&
    (() => {
      const m = linear
      return (
        m.ridges_lf != null ||
        m.valleys_lf != null ||
        m.hips_lf != null ||
        m.eaves_lf != null ||
        m.rakes_lf != null ||
        m.flashing_lf != null ||
        m.step_flashing_lf != null ||
        m.wall_flashing_lf != null
      )
    })()

  const hasSquareBlock =
    showSquareMetrics &&
    ((scope.total_squares != null && scope.total_squares > 0) ||
      (scope.measured_squares != null && scope.measured_squares > 0) ||
      (scope.waste_percent != null && scope.waste_percent > 0) ||
      measureWaste != null ||
      scope.total_squares_source === 'project_legacy')

  /** Proposal-linked roofing scope where ops should confirm waste before materials. */
  const showNoWasteFlag =
    showSquareMetrics &&
    Boolean(proposalHref) &&
    (scope.source === 'proposal' || scope.total_squares_source === 'roof_measure_total') &&
    !hasAnyWastePercent

  const materialsLineItemsOnly =
    variant === 'materials' &&
    lineCount > 0 &&
    !hasSquareBlock &&
    !hasRoofMeasureLinear &&
    Boolean(proposalHref)

  const hideEntirely =
    variant === 'header'
      ? !proposalHref && showLines.length === 0 && !hasSquareBlock && !hasRoofMeasureLinear
      : !hasSquareBlock && !hasRoofMeasureLinear && !materialsLineItemsOnly

  if (hideEntirely) {
    return null
  }

  const effectiveWastePercent =
    proposalWastePositive && scope.waste_percent != null
      ? Number(scope.waste_percent)
      : measureWaste != null
        ? measureWaste
        : null

  const equation =
    hasSquareBlock && showSquareMetrics
      ? computeRoofSquaresEquation(
          scope.total_squares_source === 'project_legacy'
            ? {
                totalSquares: scope.total_squares,
                measuredSquares: null,
                wastePercent: null,
              }
            : {
                totalSquares: scope.total_squares,
                measuredSquares: scope.measured_squares,
                wastePercent: effectiveWastePercent,
              }
        )
      : null

  const hipRidgeCap =
    showSquareMetrics && linear != null
      ? hipRidgeCapFromLinearFt({
          ridges_lf: linear.ridges_lf,
          hips_lf: linear.hips_lf,
        })
      : null

  const linearLfSubline =
    hasRoofMeasureLinear && linear
      ? (() => {
          const m = linear
          const srcLabel = m.source
            ? ROOF_MEASURE_SOURCE_LABEL[m.source] || m.source.replace(/_/g, ' ')
            : 'Roof measure'
          const rows = linearMeasureRows(m)
          if (rows.length === 0) return null
          return { srcLabel, rows }
        })()
      : null

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

      {equation != null && (
        <p className="text-sm text-sky-950 mt-0.5 leading-snug tabular-nums">
          <span className="text-xs font-normal text-sky-800">Measure </span>
          <span className="font-semibold">{formatSqPart(equation.measure)}</span>
          <span className="text-xs font-normal text-sky-800"> sq + </span>
          {effectiveWastePercent != null ? (
            <>
              <span className="font-semibold tabular-nums">{effectiveWastePercent.toFixed(1)}</span>
              <span className="text-xs font-normal text-sky-800">% waste </span>
            </>
          ) : (
            <span className="text-xs font-normal text-sky-800">waste </span>
          )}
          <span className="font-semibold">{formatSqPart(equation.waste)}</span>
          <span className="text-xs font-normal text-sky-800"> sq = </span>
          <span className="font-semibold">{equation.total.toFixed(1)}</span>
          <span className="text-xs font-normal text-sky-800"> sq total</span>
        </p>
      )}

      {hipRidgeCap != null && (
        <p className="text-sm text-sky-950 mt-1 leading-snug tabular-nums">
          <span className="text-xs font-normal text-sky-800">(Hip + ridge </span>
          <span className="font-semibold">{hipRidgeCap.combinedLf.toFixed(1)}</span>
          <span className="text-xs font-normal text-sky-800"> LF total = </span>
          <span className="font-semibold">{hipRidgeCap.capSq.toFixed(2)}</span>
          <span className="text-xs font-normal text-sky-800"> sq cap)</span>
        </p>
      )}

      {linearLfSubline != null && (
        <div className="mt-2 rounded border border-sky-200 bg-white/60 px-2 py-1.5">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-sky-700">
            Linear measurements · {linearLfSubline.srcLabel}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
            {linearLfSubline.rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-2 tabular-nums">
                <span className="text-[11px] text-sky-700">{row.label}</span>
                <span className="text-xs font-semibold text-sky-950">{formatLf(row.value)} LF</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showNoWasteFlag && (
        <div
          className="mt-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-950"
          role="status"
        >
          No waste % on file — confirm before materials.
        </div>
      )}

      {scope.total_squares_source === 'roof_measure_total' && (
        <p className="text-[11px] text-sky-700 mt-1">Sold total from roof measure</p>
      )}

      {hasSquareBlock && scope.total_squares_source === 'project_legacy' && (
        <div className="text-[11px] text-sky-800 mt-1">Squares stored on the project (not from a linked proposal).</div>
      )}

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
