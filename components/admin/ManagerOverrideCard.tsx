'use client'

/**
 * The manager override, shown as what it actually pays rather than as a rate sitting on
 * a plan: for each production lane, which manager earns it, at what percent, from when,
 * and how many active direct reports currently roll up to them.
 *
 * Read-only by design. Every write goes through the assign/end/cancel flow the page
 * already owns, so there is exactly one write path (`/api/admin/comp-plan-overlays`).
 */

import {
  summarizeManagerOverrides,
  type ManagerAssignmentInput,
  type OverlayAssignmentInput,
  type OverlayLane,
  type OverlayVersionInput,
  type OverrideSummaryRow,
} from '@/lib/management-override-admin'

const INK = '#2c2c2a'

const LANE_LABELS: Record<OverlayLane, string> = {
  setter: 'Setter production',
  closer: 'Closer production',
}

const STATUS_STYLES: Record<OverrideSummaryRow['status'], { label: string; className: string }> = {
  current: { label: 'In effect', className: 'bg-emerald-200 text-emerald-900' },
  ending: { label: 'Ending', className: 'bg-amber-200 text-amber-900' },
  scheduled: { label: 'Scheduled', className: 'bg-sky-200 text-sky-900' },
  historical: { label: 'Ended', className: 'bg-gray-200 text-gray-900' },
}

type Props = {
  assignments: OverlayAssignmentInput[]
  versions: OverlayVersionInput[]
  managerAssignments: ManagerAssignmentInput[]
  users: Array<{ id: string; full_name: string }>
  today: string
  hasActiveOverlayPlan: boolean
  onAssign: () => void
  onCreateOverlayPlan: () => void
}

export default function ManagerOverrideCard({
  assignments,
  versions,
  managerAssignments,
  users,
  today,
  hasActiveOverlayPlan,
  onAssign,
  onCreateOverlayPlan,
}: Props) {
  const rows = summarizeManagerOverrides({
    assignments,
    versions,
    managerAssignments,
    userNamesById: new Map(users.map((user) => [user.id, user.full_name])),
    activeUserIds: new Set(users.map((user) => user.id)),
    today,
  })

  const lanes: OverlayLane[] = ['setter', 'closer']
  const payingToday = rows.filter((row) => row.status === 'current' || row.status === 'ending')

  return (
    <section className="mb-6 bg-white rounded-xl shadow-sm border p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: INK }}>
            Manager override
          </h2>
          <p className="mt-2 max-w-3xl text-sm" style={{ color: INK }}>
            Paid on top of a manager&apos;s own primary plan, as a percent of the commissionable
            base on every job produced by their active direct reports <em>and</em> by themselves,
            in the lane shown. It is set per manager and per lane — not as an org-wide rate — and
            each change is effective-dated, so past jobs keep the percent that was in force on
            their sale date.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!hasActiveOverlayPlan && (
            <button
              type="button"
              onClick={onCreateOverlayPlan}
              className="px-4 py-2 border border-purple-300 text-purple-800 bg-white rounded-lg hover:bg-purple-50 font-medium text-sm"
            >
              + Create overlay plan
            </button>
          )}
          <button
            type="button"
            onClick={onAssign}
            disabled={!hasActiveOverlayPlan}
            className="px-4 py-2 bg-purple-700 text-white rounded-lg hover:bg-purple-800 disabled:opacity-50 font-medium text-sm"
          >
            Set or change override
          </button>
        </div>
      </div>

      {payingToday.length === 0 && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold" style={{ color: '#7c4a03' }}>
            No manager override is being paid right now.
          </p>
          <p className="mt-1 text-sm" style={{ color: '#7c4a03' }}>
            {hasActiveOverlayPlan
              ? 'An overlay plan exists but nobody holds an assignment, so every job pays $0 on this line.'
              : 'There is no active management overlay plan yet, so no manager can hold an override and every job pays $0 on this line.'}
          </p>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
        {lanes.map((lane) => {
          const laneRows = rows.filter((row) => row.lane === lane)
          return (
            <div key={lane} className="rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: INK }}>
                {LANE_LABELS[lane]}
              </h3>
              {laneRows.length === 0 ? (
                <p className="mt-2 text-sm" style={{ color: INK }}>
                  Nobody earns an override on {lane === 'setter' ? 'setter' : 'closer'} production.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {laneRows.map((row) => {
                    const status = STATUS_STYLES[row.status]
                    return (
                      <li key={`${row.assignmentId}-${row.status}`} className="border-b last:border-0 pb-3 last:pb-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold" style={{ color: INK }}>
                            {row.managerName}
                          </span>
                          <span
                            className={`px-2 py-0.5 text-xs font-semibold rounded-full ${status.className}`}
                          >
                            {status.label}
                          </span>
                          <span className="text-lg font-semibold tabular-nums" style={{ color: INK }}>
                            {row.ratePercent === null ? 'no rate set' : `${row.ratePercent.toFixed(2)}%`}
                          </span>
                        </div>
                        <p className="mt-1 text-sm" style={{ color: INK }}>
                          {row.effectiveFrom} → {row.effectiveTo || 'ongoing'} · {row.planName}
                        </p>
                        <p className="mt-1 text-sm" style={{ color: INK }}>
                          {row.reportCount === 0
                            ? 'No active direct reports — pays only on their own production.'
                            : `${row.reportCount} active direct report${row.reportCount === 1 ? '' : 's'} roll up, plus their own production.`}
                        </p>
                        {row.ratePercent === null && (
                          <p className="mt-1 text-sm font-semibold" style={{ color: '#7c4a03' }}>
                            This assignment has no rate version on that date, so it pays nothing.
                            Re-assign it with a rate.
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      <p className="mt-4 text-sm" style={{ color: INK }}>
        Changes start no earlier than tomorrow and never rewrite an earlier sale. An explicit
        per-job override row still outranks this, including a deliberate $0. End or cancel an
        override from the table below.
      </p>
    </section>
  )
}
