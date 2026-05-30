'use client'

import { useMemo, useState } from 'react'
import type { PayrollStatementDealRow, PayrollStatementPayload } from '@/lib/payroll-statement'
import {
  formatPayrollMoney,
  formatParticipantRoleLabel,
  holdStatusClass,
  holdStatusLabel,
} from '@/lib/payroll-format'

type OverrideDraft = Record<string, string>

type Props = {
  statement: PayrollStatementPayload | null
  loading?: boolean
  error?: string | null
  adminMode?: boolean
  readOnly?: boolean
  overrideDrafts?: OverrideDraft
  premierDrafts?: OverrideDraft
  percentDrafts?: OverrideDraft
  onOverrideDraftChange?: (jobId: string, role: string, value: string) => void
  onPremierDraftChange?: (jobId: string, role: string, value: string) => void
  onPercentDraftChange?: (jobId: string, role: string, value: string) => void
  onSaveOverride?: (jobId: string, role: string) => void
  savingOverrideKey?: string | null
}

function lineKey(jobId: string, role: string) {
  return `${jobId}|${role}`
}

export default function PayrollStatementView({
  statement,
  loading,
  error,
  adminMode,
  readOnly = false,
  overrideDrafts = {},
  premierDrafts = {},
  percentDrafts = {},
  onOverrideDraftChange,
  onPremierDraftChange,
  onPercentDraftChange,
  onSaveOverride,
  savingOverrideKey,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const canEditDeals =
    adminMode && !readOnly && onOverrideDraftChange && onSaveOverride

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const customerByJobId = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of statement?.deals ?? []) {
      if (d.customerName) m.set(d.jobId, d.customerName)
    }
    return m
  }, [statement?.deals])

  if (loading) {
    return <p className="text-sm text-gray-500 py-8 text-center">Loading statement…</p>
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    )
  }
  if (!statement) {
    return (
      <p className="text-sm text-gray-500 py-8 text-center">
        Select a period to view the commission statement.
      </p>
    )
  }

  const {
    period,
    rep,
    deals,
    hourly,
    totals,
    chargebacks,
    mode,
    dataFreshnessNote,
    statementCalculatedAt,
    projectedBreakdown,
  } = statement

  const modeBanner =
    mode === 'final'
      ? { title: 'Official statement', className: 'border-indigo-200 bg-indigo-50 text-indigo-900' }
      : { title: 'Estimated statement', className: 'border-amber-200 bg-amber-50 text-amber-900' }

  const showGrossNet = mode === 'final'

  return (
    <div className="space-y-6">
      <div className={`rounded-lg border px-4 py-3 ${modeBanner.className}`}>
        <p className="font-semibold">{modeBanner.title}</p>
        <p className="mt-1 text-sm">{dataFreshnessNote}</p>
        <p className="mt-1 text-xs opacity-80">
          Calculated {new Date(statementCalculatedAt).toLocaleString()}
        </p>
      </div>

      {totals.hasDeficit && (
        <div
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-900"
          role="alert"
        >
          <p className="font-semibold">Deficit — chargebacks exceed earnings</p>
          <p className="mt-1 text-sm">
            Net payout {formatPayrollMoney(totals.netPayout)} after{' '}
            {formatPayrollMoney(totals.chargebacksApplied)} in chargebacks applied this period
            (see{' '}
            <a href="#statement-chargebacks" className="font-medium underline">
              chargebacks below
            </a>
            ).
          </p>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Period" value={period.label} />
        <SummaryCard label="Pay date" value={period.payDate} />
        <SummaryCard label="Rep" value={rep.name} />
        <SummaryCard
          label="Net payout"
          value={formatPayrollMoney(totals.netPayout)}
          highlight
        />
      </div>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          {mode === 'final' ? 'Pay breakdown' : 'Projected breakdown'}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          {projectedBreakdown.map((item) => (
            <BreakdownChip
              key={item.key}
              label={item.label}
              value={formatPayrollMoney(item.amount)}
            />
          ))}
          {hourly && (
            <BreakdownChip label="Hourly pay" value={formatPayrollMoney(totals.hourlyEarnings)} />
          )}
          {totals.chargebacksApplied > 0 && (
            <BreakdownChip
              label="Chargebacks"
              value={`−${formatPayrollMoney(totals.chargebacksApplied)}`}
            />
          )}
          <BreakdownChip label="Net payout" value={formatPayrollMoney(totals.netPayout)} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Deals</h2>
        <p className="text-xs text-gray-500 mb-3">
          Tap a row to see how each amount was calculated. One row per role you earned on the job.
        </p>
        {deals.length === 0 ? (
          <p className="text-sm text-gray-500 rounded-lg border border-dashed p-6 text-center">
            {mode === 'estimated'
              ? 'No eligible deals in this period window for this rep yet.'
              : 'No payout lines for this period yet. Lock the period after jobs are ready, or confirm payout lines were generated.'}
          </p>
        ) : (
          <div className="overflow-x-auto border rounded-lg -mx-1 sm:mx-0">
            <table className="min-w-[640px] w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-2 py-2 w-8" aria-label="Expand" />
                  <th className="px-3 py-2 font-medium sticky left-0 bg-gray-50 z-10 min-w-[140px]">
                    Customer
                  </th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  {showGrossNet ? (
                    <>
                      <th className="px-3 py-2 font-medium text-right">Gross</th>
                      <th className="px-3 py-2 font-medium text-right">Net</th>
                    </>
                  ) : (
                    <th className="px-3 py-2 font-medium text-right">Estimated pay</th>
                  )}
                  {adminMode && (
                    <>
                      <th className="px-3 py-2 font-medium text-right">Premier</th>
                      <th className="px-3 py-2 font-medium text-right">Override $</th>
                      {canEditDeals && (
                        <th className="px-3 py-2 font-medium text-right">Override %</th>
                      )}
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y">
                {deals.map((d) => {
                  const key = lineKey(d.jobId, d.role)
                  const isOpen = expanded.has(key)
                  return (
                    <DealRows
                      key={key}
                      deal={d}
                      dealKey={key}
                      isOpen={isOpen}
                      onToggle={() => toggleExpanded(key)}
                      showGrossNet={showGrossNet}
                      adminMode={Boolean(adminMode)}
                      canEditDeals={Boolean(canEditDeals)}
                      overrideDrafts={overrideDrafts}
                      premierDrafts={premierDrafts}
                      percentDrafts={percentDrafts}
                      onOverrideDraftChange={onOverrideDraftChange}
                      onPremierDraftChange={onPremierDraftChange}
                      onPercentDraftChange={onPercentDraftChange}
                      onSaveOverride={onSaveOverride}
                      savingOverrideKey={savingOverrideKey}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {hourly && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Hourly earnings</h2>
          <div className="rounded-lg border bg-gray-50/50 p-4 text-sm space-y-2">
            <Row
              label="Regular pay"
              value={`${hourly.regularHours} hrs × ${formatPayrollMoney(hourly.hourlyRate)} = ${formatPayrollMoney(hourly.regularEarnings)}`}
            />
            <Row
              label="Overtime pay"
              value={`${hourly.overtimeHours} hrs × ${formatPayrollMoney(hourly.hourlyRate * 1.5)} (1.5×) = ${formatPayrollMoney(hourly.overtimeEarnings)}`}
            />
            <Row label="Hourly subtotal" value={formatPayrollMoney(hourly.total)} bold />
            {hourly.notes && (
              <p className="text-gray-600 pt-2 border-t">Notes: {hourly.notes}</p>
            )}
          </div>
        </section>
      )}

      {chargebacks.length > 0 && (
        <section id="statement-chargebacks">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Chargebacks applied</h2>
          <ul className="text-sm space-y-2 border rounded-lg divide-y">
            {chargebacks.map((c) => (
              <li key={c.chargebackId} className="px-4 py-3 flex flex-col sm:flex-row sm:justify-between gap-2">
                <div>
                  <p className="font-medium text-gray-900">{c.reason || 'Chargeback'}</p>
                  {c.jobId && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      Job: {customerByJobId.get(c.jobId) || c.jobId}
                    </p>
                  )}
                </div>
                <span className="tabular-nums font-medium text-red-700 shrink-0">
                  −{formatPayrollMoney(c.appliedAmount)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="border-t pt-4 grid gap-2 sm:grid-cols-3 text-sm">
        <Row label="Gross commission" value={formatPayrollMoney(totals.grossCommission)} />
        <Row label="Hourly" value={formatPayrollMoney(totals.hourlyEarnings)} />
        <Row label="Net payout" value={formatPayrollMoney(totals.netPayout)} bold />
      </footer>
    </div>
  )
}

function DealRows({
  deal: d,
  dealKey,
  isOpen,
  onToggle,
  showGrossNet,
  adminMode,
  canEditDeals,
  overrideDrafts,
  premierDrafts,
  percentDrafts,
  onOverrideDraftChange,
  onPremierDraftChange,
  onPercentDraftChange,
  onSaveOverride,
  savingOverrideKey,
}: {
  deal: PayrollStatementDealRow
  dealKey: string
  isOpen: boolean
  onToggle: () => void
  showGrossNet: boolean
  adminMode: boolean
  canEditDeals: boolean
  overrideDrafts: OverrideDraft
  premierDrafts: OverrideDraft
  percentDrafts: OverrideDraft
  onOverrideDraftChange?: (jobId: string, role: string, value: string) => void
  onPremierDraftChange?: (jobId: string, role: string, value: string) => void
  onPercentDraftChange?: (jobId: string, role: string, value: string) => void
  onSaveOverride?: (jobId: string, role: string) => void
  savingOverrideKey?: string | null
}) {
  const colSpan =
    4 + (showGrossNet ? 2 : 1) + (adminMode ? (canEditDeals ? 3 : 2) : 0)

  return (
    <>
      <tr className="text-gray-900 hover:bg-gray-50/80">
        <td className="px-2 py-2 align-middle">
          <button
            type="button"
            onClick={onToggle}
            className="p-1 rounded hover:bg-gray-200 text-gray-600"
            aria-expanded={isOpen}
            aria-label={isOpen ? 'Hide calculation' : 'Show how calculated'}
          >
            <span className="inline-block transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : undefined }}>
              ▶
            </span>
          </button>
        </td>
        <td
          className="px-3 py-2 sticky left-0 bg-white z-[1] cursor-pointer"
          onClick={onToggle}
        >
          <div className="font-medium">{d.customerName || '—'}</div>
          <div className="text-xs text-gray-500">{d.jobNumber}</div>
        </td>
        <td className="px-3 py-2">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${holdStatusClass(d.holdStatus)}`}
          >
            {holdStatusLabel(d.holdStatus)}
          </span>
        </td>
        <td className="px-3 py-2 whitespace-nowrap">{formatParticipantRoleLabel(d.role)}</td>
        {showGrossNet ? (
          <>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatPayrollMoney(d.grossAmount)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums font-medium">
              {formatPayrollMoney(d.dealTotal)}
            </td>
          </>
        ) : (
          <td className="px-3 py-2 text-right tabular-nums font-medium">
            {formatPayrollMoney(d.dealTotal)}
          </td>
        )}
        {adminMode && (
          <>
            <td className="px-3 py-2 text-right tabular-nums">
              {canEditDeals && onPremierDraftChange ? (
                <input
                  type="number"
                  step="0.01"
                  className="w-20 rounded border px-2 py-1 text-right text-sm"
                  value={
                    premierDrafts[dealKey] ??
                    (d.premierPricingCommission ? String(d.premierPricingCommission) : '')
                  }
                  onChange={(e) => onPremierDraftChange(d.jobId, d.role, e.target.value)}
                />
              ) : (
                formatPayrollMoney(d.premierPricingCommission)
              )}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {canEditDeals ? (
                <div className="flex items-center justify-end gap-1">
                  <input
                    type="number"
                    step="0.01"
                    className="w-20 rounded border px-2 py-1 text-right text-sm"
                    value={
                      overrideDrafts[dealKey] ??
                      (d.overrideAmount ? String(d.overrideAmount) : '')
                    }
                    onChange={(e) => onOverrideDraftChange!(d.jobId, d.role, e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={savingOverrideKey === dealKey}
                    onClick={() => onSaveOverride!(d.jobId, d.role)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50 shrink-0"
                  >
                    Save
                  </button>
                </div>
              ) : (
                formatPayrollMoney(d.overrideAmount)
              )}
            </td>
            {canEditDeals && onPercentDraftChange && (
              <td className="px-3 py-2 text-right tabular-nums">
                <input
                  type="number"
                  step="0.01"
                  className="w-16 rounded border px-2 py-1 text-right text-sm"
                  placeholder="%"
                  value={percentDrafts[dealKey] ?? ''}
                  onChange={(e) => onPercentDraftChange(d.jobId, d.role, e.target.value)}
                />
              </td>
            )}
          </>
        )}
      </tr>
      {isOpen && (
        <tr className="bg-indigo-50/40">
          <td colSpan={colSpan} className="px-4 py-3 text-sm">
            <CalculationPanel deal={d} />
          </td>
        </tr>
      )}
    </>
  )
}

function CalculationPanel({ deal }: { deal: PayrollStatementDealRow }) {
  return (
    <div className="space-y-3 max-w-2xl">
      <p className="font-medium text-gray-900">How this amount was calculated</p>
      {deal.planName && (
        <p className="text-gray-700">
          Plan: <span className="font-medium">{deal.planName}</span>
        </p>
      )}
      {deal.commissionableAmount != null && (
        <p className="text-gray-600 text-xs">
          Commissionable base: {formatPayrollMoney(deal.commissionableAmount)}
          {deal.installDate && ` · Install completed ${deal.installDate}`}
        </p>
      )}
      {deal.calculationNotes.length > 0 && (
        <ul className="list-disc pl-5 text-gray-700 space-y-1">
          {deal.calculationNotes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      )}
      {deal.lineComponents.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Pay components
          </p>
          <ul className="space-y-1">
            {deal.lineComponents.map((c) => (
              <li key={c.key} className="flex justify-between gap-4 tabular-nums">
                <span className="text-gray-700">{c.label}</span>
                <span className="font-medium">{formatPayrollMoney(c.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-gray-500 border-t pt-2">
        Line total: {formatPayrollMoney(deal.dealTotal)}
        {deal.grossAmount !== deal.dealTotal &&
          ` (gross ${formatPayrollMoney(deal.grossAmount)} before line-level chargebacks)`}
      </p>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="rounded-lg border bg-white px-3 py-3 sm:px-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p
        className={`mt-1 text-base sm:text-lg font-semibold tabular-nums ${highlight ? 'text-indigo-700' : 'text-gray-900'}`}
      >
        {value}
      </p>
    </div>
  )
}

function BreakdownChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  )
}

function Row({
  label,
  value,
  bold,
}: {
  label: string
  value: string
  bold?: boolean
}) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? 'font-semibold text-gray-900' : ''}`}>
      <span className="text-gray-600">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
