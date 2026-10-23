/**
 * How "Needs you" is laid out: one card per JOB (all its issues), pay-plan items as ONE card at the top, past appointments
 * as one card, jobs ordered so what holds pay on an OPEN job comes first, filterable by type. Pure — the component only renders it.
 */
import type { AppointmentHealth, DataHealthReport, HealthArea, JobHealth } from '@/lib/data-health'

export type NeedsFilter = 'all' | 'money' | 'ops'

/** Money = what the customer owes / what gets paid (incl. sale credit). Ops = how the work runs (incl. appointment outcomes). */
export const filterOfArea = (area: HealthArea): Exclude<NeedsFilter, 'all'> => (area === 'money' || area === 'credit' ? 'money' : 'ops')

const CLOSED_STATUSES = new Set(['collected', 'cancelled'])

export type JobCard = { job: JobHealth; holdsPay: boolean; openHolds: boolean }

export type NeedsView = {
  plans: NonNullable<DataHealthReport['payPlans']>
  /** People whose plan was ended and not replaced (paid nothing until someone assigns one). */
  ended: NonNullable<DataHealthReport['endedPlans']>
  jobs: JobCard[]
  appointments: AppointmentHealth[]
  counts: { all: number; money: number; ops: number }
}

/** The job's problems that belong to the filter (all of them for 'all'). */
function visibleProblems(job: JobHealth, filter: NeedsFilter) {
  return filter === 'all' ? job.problems : job.problems.filter((p) => filterOfArea(p.area) === filter)
}

export function buildNeedsView(report: DataHealthReport, filter: NeedsFilter): NeedsView {
  const plans = report.payPlans ?? []
  const ended = report.endedPlans ?? []
  const jobs: JobCard[] = report.jobs
    .map((j) => ({ ...j, problems: visibleProblems(j, filter) }))
    .filter((j) => j.problems.length > 0)
    .map((job) => {
      const holdsPay = job.problems.some((p) => p.blocksPay)
      return { job, holdsPay, openHolds: holdsPay && !CLOSED_STATUSES.has(job.status) }
    })
    .sort(
      (a, b) =>
        Number(b.openHolds) - Number(a.openHolds) ||
        Number(b.holdsPay) - Number(a.holdsPay) ||
        b.job.problems.length - a.job.problems.length ||
        a.job.jobNumber.localeCompare(b.job.jobNumber, undefined, { numeric: true })
    )
  // Appointments are operational; pay plans are money.
  const appointments = filter === 'money' ? [] : report.appointments
  const moneyJobs = report.jobs.filter((j) => j.problems.some((p) => filterOfArea(p.area) === 'money')).length
  const opsJobs = report.jobs.filter((j) => j.problems.some((p) => filterOfArea(p.area) === 'ops')).length
  const planCount = plans.length
  return {
    plans: filter === 'ops' ? [] : plans,
    ended: filter === 'ops' ? [] : ended,
    jobs,
    appointments,
    counts: {
      all: report.count,
      money: moneyJobs + planCount + (ended.length > 0 ? 1 : 0),
      ops: opsJobs + report.appointments.length,
    },
  }
}

export const TOP_N = 10
