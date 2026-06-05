'use client'

import type { PayrollStatementPayload } from '@/lib/payroll-statement'
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
  overrideDrafts?: OverrideDraft
  onOverrideDraftChange?: (jobId: string, role: string, value: string) => void
  onSaveOverride?: (jobId: string, role: string) => void
  savingOverrideKey?: string | null
}

function overrideKey(jobId: string, role: string) {
  return `${jobId}|${role}`
}

export default function PayrollStatementView({
  statement,
  loading,
  error,
  adminMode,
  overrideDrafts = {},
  onOverrideDraftChange,
  onSaveOverride,
  savingOverrideKey,
}: Props) {
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

  const { period, rep, deals, hourly, periodUnits, totals, chargebacks } = statement

  return (
    <div className="space-y-6">
      {totals.hasDeficit && (
        <div
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-900"
          role="alert"
        >
          <p className="font-semibold">Deficit — chargebacks exceed earnings</p>
          <p className="mt-1 text-sm">
            Net payout {formatPayrollMoney(totals.netPayout)} after{' '}
            {formatPayrollMoney(totals.chargebacksApplied)} in chargebacks.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Projected breakdown</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <BreakdownChip label="Commission" value={formatPayrollMoney(totals.grossCommission)} />
          <BreakdownChip label="Hourly" value={formatPayrollMoney(totals.hourlyEarnings)} />
          {totals.periodUnitEarnings > 0 && (
            <BreakdownChip
              label="Sit / sale pay"
              value={formatPayrollMoney(totals.periodUnitEarnings)}
            />
          )}
          <BreakdownChip
            label="Chargebacks"
            value={`−${formatPayrollMoney(totals.chargebacksApplied)}`}
          />
          <BreakdownChip label="Status" value={period.status} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Deals</h2>
        {deals.length === 0 ? (
          <p className="text-sm text-gray-500 rounded-lg border border-dashed p-6 text-center">
            No payout lines for this period yet. Lock the period after jobs are ready, or confirm
            payout lines were generated.
          </p>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">NTP</th>
                  <th className="px-3 py-2 font-medium">Install</th>
                  <th className="px-3 py-2 font-medium text-right">Commissionable</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium text-right">Revenue</th>
                  <th className="px-3 py-2 font-medium text-right">Premier</th>
                  <th className="px-3 py-2 font-medium text-right">Override</th>
                  <th className="px-3 py-2 font-medium text-right">Deal total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {deals.map((d) => {
                  const key = overrideKey(d.jobId, d.role)
                  return (
                    <tr key={`${d.jobId}-${d.role}`} className="text-gray-900">
                      <td className="px-3 py-2">
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
                      <td className="px-3 py-2 tabular-nums">{d.ntpDate || '—'}</td>
                      <td className="px-3 py-2 tabular-nums">{d.installDate || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {d.commissionableAmount != null
                          ? formatPayrollMoney(d.commissionableAmount)
                          : '—'}
                      </td>
                      <td className="px-3 py-2">{formatParticipantRoleLabel(d.role)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatPayrollMoney(d.revenueCommission)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatPayrollMoney(d.premierPricingCommission)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {adminMode && onOverrideDraftChange && onSaveOverride ? (
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="number"
                              step="0.01"
                              className="w-24 rounded border px-2 py-1 text-right text-sm"
                              value={
                                overrideDrafts[key] ??
                                (d.overrideAmount ? String(d.overrideAmount) : '')
                              }
                              onChange={(e) =>
                                onOverrideDraftChange(d.jobId, d.role, e.target.value)
                              }
                            />
                            <button
                              type="button"
                              disabled={savingOverrideKey === key}
                              onClick={() => onSaveOverride(d.jobId, d.role)}
                              className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          formatPayrollMoney(d.overrideAmount)
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {formatPayrollMoney(d.dealTotal)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {periodUnits && periodUnits.total > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Sit &amp; sale pay</h2>
          <div className="rounded-lg border bg-gray-50/50 p-4 text-sm space-y-2">
            {periodUnits.components.map((row) => (
              <Row
                key={row.unitType}
                label={row.label}
                value={`${row.count} × ${formatPayrollMoney(row.rate)} = ${formatPayrollMoney(row.amount)}`}
              />
            ))}
            <Row label="Sit / sale subtotal" value={formatPayrollMoney(periodUnits.total)} bold />
          </div>
        </section>
      )}

      {hourly && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Hourly earnings</h2>
          <div className="rounded-lg border bg-gray-50/50 p-4 text-sm space-y-2">
            <Row
              label="Regular"
              value={`${hourly.regularHours} hrs × ${formatPayrollMoney(hourly.hourlyRate)} = ${formatPayrollMoney(hourly.regularEarnings)}`}
            />
            <Row
              label="Overtime"
              value={`${hourly.overtimeHours} hrs × ${formatPayrollMoney(hourly.hourlyRate * 1.5)} = ${formatPayrollMoney(hourly.overtimeEarnings)}`}
            />
            <Row label="Hourly subtotal" value={formatPayrollMoney(hourly.total)} bold />
            {hourly.notes && (
              <p className="text-gray-600 pt-2 border-t">Notes: {hourly.notes}</p>
            )}
          </div>
        </section>
      )}

      {chargebacks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Chargebacks applied</h2>
          <ul className="text-sm space-y-2 border rounded-lg divide-y">
            {chargebacks.map((c) => (
              <li key={c.chargebackId} className="px-4 py-2 flex justify-between gap-4">
                <span className="text-gray-700">{c.reason || 'Chargeback'}</span>
                <span className="tabular-nums font-medium text-red-700">
                  −{formatPayrollMoney(c.appliedAmount)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="border-t pt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <Row label="Gross commission" value={formatPayrollMoney(totals.grossCommission)} />
        <Row label="Hourly" value={formatPayrollMoney(totals.hourlyEarnings)} />
        {totals.periodUnitEarnings > 0 && (
          <Row label="Sit / sale pay" value={formatPayrollMoney(totals.periodUnitEarnings)} />
        )}
        <Row
          label="Net payout"
          value={formatPayrollMoney(totals.netPayout)}
          bold
        />
      </footer>
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
    <div className="rounded-lg border bg-white px-4 py-3">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${highlight ? 'text-indigo-700' : 'text-gray-900'}`}
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
