'use client'

import Link from 'next/link'
import { useState } from 'react'

import CloseOutAppointments from '@/components/ops/CloseOutAppointments'
import FixPayPlanButton from '@/components/ops/FixPayPlanButton'
import type { DataHealthReport } from '@/lib/data-health'
import { buildNeedsView, TOP_N, type NeedsFilter } from '@/lib/needs-you-view'

const AREA_LABEL: Record<string, string> = {
  money: 'Money',
  credit: 'Sale credit',
  ops: 'Ops',
  sales: 'Sales',
}

const LINK = 'inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center rounded-lg bg-[#2b0a3d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3d1257]'

/**
 * "Needs you": one card per job with all its issues (what holds pay on an open job first), pay-plan items as one card at the
 * top, past appointments as one card; top 10 with "Show all", filter by type. The server decides WHICH rows reach this
 * component (lib/data-health.ts needsYouAudience); this only lays them out.
 */
export default function NeedsYouList({ report, canFixPayPlans = false, audience = 'owner' }: { report: DataHealthReport; canFixPayPlans?: boolean; audience?: 'owner' | 'ops' }) {
  const [filter, setFilter] = useState<NeedsFilter>('all')
  const [showAllJobs, setShowAllJobs] = useState(false)
  const [showAllAppts, setShowAllAppts] = useState(false)
  const view = buildNeedsView(report, filter)
  const jobs = showAllJobs ? view.jobs : view.jobs.slice(0, TOP_N)
  const appts = showAllAppts ? view.appointments : view.appointments.slice(0, TOP_N)
  const chip = (f: NeedsFilter, label: string, n: number) => (
    <button
      key={f}
      type="button"
      onClick={() => {
        setFilter(f)
        setShowAllJobs(false)
        setShowAllAppts(false)
      }}
      aria-pressed={filter === f}
      className={`inline-flex min-h-[44px] items-center rounded-full border px-4 text-sm font-semibold ${filter === f ? 'border-[#2c2c2a] bg-[#2c2c2a] text-white' : 'border-gray-300 bg-white text-[#2c2c2a]'}`}
    >
      {label} ({n})
    </button>
  )
  const nothing = view.plans.length === 0 && view.ended.length === 0 && view.jobs.length === 0 && view.appointments.length === 0

  return (
    <section className="bg-white rounded-xl shadow-sm border p-4 sm:p-6 mb-6" aria-labelledby="needs-you-heading">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 id="needs-you-heading" className="text-lg font-semibold text-[#2c2c2a]">
          Needs you
        </h2>
        <span className="text-sm font-medium text-[#2c2c2a]">{report.count === 0 ? 'All clear' : `${report.count} to fix`}</span>
      </div>
      <p className="text-sm text-[#57574f] mb-3">
        {audience === 'owner' ? 'Jobs with missing or conflicting info. Payroll won’t pay a job marked “Holds pay” until it’s fixed.' : 'Jobs and appointments with missing info.'}
      </p>

      {report.count === 0 ? (
        <p className="text-sm text-[#2c2c2a]">Nothing needs you right now.</p>
      ) : (
        <>
          {audience === 'owner' && (
            <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter by type">
              {chip('all', 'All', view.counts.all)}
              {chip('money', 'Money', view.counts.money)}
              {chip('ops', 'Ops', view.counts.ops)}
            </div>
          )}

          {nothing ? <p className="text-sm text-[#2c2c2a]">Nothing of that type.</p> : null}

          {view.ended.length > 0 && (
            <div className="mb-3 rounded-lg border border-gray-200 p-3" data-card="ended-plans">
              <p className="text-sm font-semibold text-[#2c2c2a]">
                <span className="mr-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold">Money</span>
                {view.ended.length} {view.ended.length === 1 ? 'person has' : 'people have'} no pay plan because theirs was ended
                <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">Paid nothing</span>
              </p>
              <p className="mt-1 text-sm text-[#57574f] break-words">{view.ended.map((p) => `${p.name} (${p.roleLabel}, ended ${p.endedOn})`).join('; ')}</p>
              <Link href="/admin/comp-plans" className={`${LINK} mt-2`}>Assign a plan</Link>
            </div>
          )}

          {view.plans.length > 0 && (
            <div className="mb-3 rounded-lg border border-gray-200 p-3" data-card="pay-plans">
              <p className="text-sm font-semibold text-[#2c2c2a]">
                <span className="mr-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold">Money</span>
                Pay plans
                <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">Paid nothing</span>
              </p>
              <ul className="mt-2 divide-y divide-gray-200">
                {view.plans.map((gap) => (
                  <li key={`plan-${gap.role}`} className="py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm text-[#2c2c2a]">
                      <span className="font-semibold">{gap.people.length} {gap.people.length === 1 ? 'person has' : 'people have'} no pay plan</span>
                      <span className="block text-[#57574f] break-words">{gap.roleLabel}: {gap.people.map((p) => p.name).join(', ')}</span>
                    </span>
                    {gap.suggestion && canFixPayPlans ? (
                      <FixPayPlanButton role={gap.role} compPlanId={gap.suggestion.id} label={`Use ${gap.suggestion.name} (${gap.suggestion.ratePercent}%) for all ${gap.roleLabel}s`} />
                    ) : (
                      <Link href="/admin/comp-plans" className={LINK}>Choose a plan</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view.jobs.length > 0 && (
            <ul className="space-y-3" data-card="jobs">
              {jobs.map(({ job, openHolds }) => (
                <li key={job.jobId} className={`rounded-lg border p-3 ${openHolds ? 'border-red-300' : 'border-gray-200'}`} data-job={job.jobNumber}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Link href={`/ops/jobs/${job.jobId}`} className="inline-flex min-h-[44px] items-center font-semibold text-[#2c2c2a] underline underline-offset-2">
                      Job {job.jobNumber}
                    </Link>
                    {job.addressText && <span className="text-sm text-[#57574f] break-words">{job.addressText}</span>}
                  </div>
                  <ul className="mt-1.5 space-y-1.5">
                    {job.problems.map((p) => (
                      <li key={p.code} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-sm text-[#2c2c2a]">
                          <span className="mr-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-[#2c2c2a]">{AREA_LABEL[p.area] ?? p.area}</span>
                          {p.message}
                          {p.blocksPay && <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">Holds pay</span>}
                        </span>
                        <Link href={p.fixHref} className={LINK}>{p.fixLabel}</Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {view.jobs.length > TOP_N && (
            <button type="button" aria-expanded={showAllJobs} onClick={() => setShowAllJobs((v) => !v)} className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-[#2b0a3d] underline underline-offset-2">
              {showAllJobs ? 'Show fewer jobs' : `Show all (${view.jobs.length})`}
            </button>
          )}

          {view.appointments.length > 0 && (
            <div className="mt-3 rounded-lg border border-gray-200 p-3" data-card="appointments">
              <p className="text-sm font-semibold text-[#2c2c2a]">
                <span className="mr-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold">Ops</span>
                {view.appointments.length} past appointment{view.appointments.length === 1 ? '' : 's'} with no outcome logged
              </p>
              <ul className="mt-2 divide-y divide-gray-200">
                {appts.map((appt) => (
                  <li key={appt.appointmentId} className="py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm text-[#2c2c2a]">
                      {appt.problems[0]?.message}
                      {appt.addressText && <span className="ml-1 text-[#57574f]">· {appt.addressText}</span>}
                    </span>
                    {appt.problems[0] && <Link href={appt.problems[0].fixHref} className={LINK}>{appt.problems[0].fixLabel}</Link>}
                  </li>
                ))}
              </ul>
              {view.appointments.length > TOP_N && (
                <button type="button" aria-expanded={showAllAppts} onClick={() => setShowAllAppts((v) => !v)} className="mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-[#2b0a3d] underline underline-offset-2">
                  {showAllAppts ? 'Show fewer' : `Show all (${view.appointments.length})`}
                </button>
              )}
            </div>
          )}
        </>
      )}
      {audience === 'owner' && (report.hiddenOldAppointments ?? 0) > 0 && <CloseOutAppointments hidden={report.hiddenOldAppointments ?? 0} />}
    </section>
  )
}
