import Link from 'next/link'

import type { DataHealthReport } from '@/lib/data-health'
import FixPayPlanButton from '@/components/ops/FixPayPlanButton'

const AREA_LABEL: Record<string, string> = {
  money: 'Money',
  credit: 'Sale credit',
  ops: 'Ops',
  sales: 'Sales',
}

/** How many past-due appointments to list before collapsing to a count. */
const APPOINTMENT_ROWS_SHOWN = 15

/**
 * "Needs you" — every job or appointment with a missing or conflicting input,
 * each with a one-tap fix link. Plain list, no filters: if it's here, someone
 * has to do something. Built from lib/data-health.ts (the same check the
 * morning email and payroll use).
 */
export default function NeedsYouList({ report, canFixPayPlans = false, audience = 'owner' }: { report: DataHealthReport; canFixPayPlans?: boolean; audience?: 'owner' | 'ops' }) {
  const payPlans = report.payPlans ?? []
  const extraAppointments = Math.max(0, report.appointments.length - APPOINTMENT_ROWS_SHOWN)
  return (
    <section className="bg-white rounded-xl shadow-sm border p-4 sm:p-6 mb-6" aria-labelledby="needs-you-heading">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 id="needs-you-heading" className="text-lg font-semibold text-[#2c2c2a]">
          Needs you
        </h2>
        <span className="text-sm font-medium text-[#2c2c2a]">
          {report.count === 0 ? 'All clear' : `${report.count} to fix`}
        </span>
      </div>
      <p className="text-sm text-[#57574f] mb-4">
        {audience === 'owner' ? 'Jobs with missing or conflicting info. Payroll won\u2019t pay a job marked \u201CHolds pay\u201D until it\u2019s fixed.' : 'Jobs and appointments with missing info.'}
      </p>

      {report.count === 0 ? (
        <p className="text-sm text-[#2c2c2a]">Nothing needs you right now.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {payPlans.map((gap) => (
            <li key={`plan-${gap.role}`} className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-[#2c2c2a]">
                <span className="mr-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-[#2c2c2a]">Money</span>
                <span className="font-semibold">{gap.people.length} {gap.people.length === 1 ? 'person has' : 'people have'} no pay plan</span>
                <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">Paid nothing</span>
                <span className="block text-[#57574f] break-words">{gap.roleLabel}: {gap.people.map((p) => p.name).join(', ')}</span>
              </span>
              {gap.suggestion && canFixPayPlans ? (
                <FixPayPlanButton role={gap.role} compPlanId={gap.suggestion.id} label={`Use ${gap.suggestion.name} (${gap.suggestion.ratePercent}%) for all ${gap.roleLabel}s`} />
              ) : (
                <Link href="/admin/comp-plans" className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center rounded-lg bg-[#2b0a3d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3d1257]">
                  Choose a plan
                </Link>
              )}
            </li>
          ))}
          {report.jobs.map((job) => (
            <li key={job.jobId} className="py-3">
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
                      <span className="mr-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-[#2c2c2a]">
                        {AREA_LABEL[p.area] ?? p.area}
                      </span>
                      {p.message}
                      {p.blocksPay && (
                        <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">Holds pay</span>
                      )}
                    </span>
                    <Link
                      href={p.fixHref}
                      className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center rounded-lg bg-[#2b0a3d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3d1257]"
                    >
                      {p.fixLabel}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {report.appointments.slice(0, APPOINTMENT_ROWS_SHOWN).map((appt) => (
            <li key={appt.appointmentId} className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-[#2c2c2a]">
                <span className="mr-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-[#2c2c2a]">Sales</span>
                {appt.problems[0]?.message}
                {appt.addressText && <span className="ml-1 text-[#57574f]">· {appt.addressText}</span>}
              </span>
              {appt.problems[0] && (
                <Link
                  href={appt.problems[0].fixHref}
                  className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center rounded-lg bg-[#2b0a3d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3d1257]"
                >
                  {appt.problems[0].fixLabel}
                </Link>
              )}
            </li>
          ))}
          {extraAppointments > 0 && (
            <li className="py-3 text-sm text-[#2c2c2a]">
              …and {extraAppointments} more past appointments with no outcome.
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
